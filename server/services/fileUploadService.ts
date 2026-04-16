/**
 * Canonical file upload service.
 *
 * Owns the 3-step upload lifecycle (request → direct PUT → finalize),
 * tenant-scoped file DTOs, and the read/delete paths for both R2-backed
 * and legacy local-disk rows.
 *
 * Phase 1 scope: job note attachments. The entityType field is already a
 * discriminator so client notes, technician docs, contracts, invoice PDFs,
 * and quote PDFs can plug in without schema changes — they just need a
 * tenant-scoped ownership check and an object-key builder.
 *
 * Non-negotiables enforced here:
 *   - mime + size validation on the server (client values are not trusted)
 *   - tenant ownership of the target entity before issuing an upload URL
 *   - sanitized filenames
 *   - short signed-URL expiry (defaults in R2StorageProvider)
 */

import { and, eq, lt } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "../db";
import {
  files,
  invoices,
  jobNotes,
  jobs,
  jobExpenses,
  jobNoteAttachments,
  clientNotes,
  clientLocations,
  noteAttachments,
  clientFiles,
  contractFiles,
  technicianFiles,
  recurringJobTemplates,
  users,
} from "@shared/schema";
import type { FileCategory, FileRecord, FileStatus } from "@shared/schema";
import { createError } from "../middleware/errorHandler";
import { getR2Provider, isR2Configured } from "./storage/R2StorageProvider";

// ---------------------------------------------------------------------------
// Reliability constants (Phase 1 hardening, 2026-04-12)
// ---------------------------------------------------------------------------

/** Pending uploads older than this are considered abandoned. */
export const ORPHAN_THRESHOLD_MINUTES = 15;

/** Absolute tolerance (in bytes) when comparing declared vs stored size. */
const SIZE_MATCH_TOLERANCE_BYTES = 0;

// ---------------------------------------------------------------------------
// Limits + allow-list
// ---------------------------------------------------------------------------

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20 MB

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PDF_MIME_TYPES = new Set(["application/pdf"]);
const ALLOWED_MIME_TYPES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

/**
 * Server-assigned category. Never sourced from the client.
 *
 *   - Note entities (job_note, client_note) categorize by mime
 *     (note_image / note_pdf) so gallery UIs can filter.
 *   - Document entities carry their entityType as the category, regardless
 *     of mime — a client PDF is still a `client_document`.
 */
function resolveCategory(entityType: FileEntityType, mimeType: string): FileCategory {
  switch (entityType) {
    case "job_note":
    case "client_note":
      if (IMAGE_MIME_TYPES.has(mimeType)) return "note_image";
      if (PDF_MIME_TYPES.has(mimeType)) return "note_pdf";
      return "other";
    case "client_document":
      return "client_document";
    case "contract_document":
      return "contract_document";
    case "technician_document":
      return "technician_document";
    case "invoice_email_attachment":
      return "other";
    case "job_expense_receipt":
      return "job_expense_receipt";
    default: {
      const _exhaustive: never = entityType;
      return "other";
    }
  }
}

function validateMimeAndSize(mimeType: string, sizeBytes: number): void {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw createError(400, `Unsupported file type: ${mimeType}`);
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw createError(400, "sizeBytes must be a positive integer");
  }
  const limit = IMAGE_MIME_TYPES.has(mimeType) ? MAX_IMAGE_BYTES : MAX_PDF_BYTES;
  if (sizeBytes > limit) {
    throw createError(
      413,
      `File too large (${sizeBytes} bytes). Max for ${mimeType} is ${limit} bytes.`,
    );
  }
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export interface FileDTO {
  id: string;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  status: FileStatus;
  storageProvider: string;
  createdAt: string;
}

export function toFileDTO(row: FileRecord): FileDTO {
  return {
    id: row.id,
    filename: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.size,
    status: row.status as FileStatus,
    storageProvider: row.storageProvider,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Filename sanitation + key builder
// ---------------------------------------------------------------------------

/** Strip path separators, control chars, and clamp length. */
function sanitizeFilename(name: string): string {
  const stripped = name
    .replace(/[\/\\\r\n\t\0]/g, "_")
    .replace(/[^A-Za-z0-9._ \-()]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 180);
  return stripped || "file";
}

// ---------------------------------------------------------------------------
// Entity adapters (Phase 2, 2026-04-12)
//
// Every new file-owning entity plugs in through this map: resolver +
// key builder + attachment insert. Nothing else in the pipeline cares
// which entity is being attached — `requestUpload` / `finalizeUpload` /
// `deleteFile` branch purely on `entityType`.
// ---------------------------------------------------------------------------

export type FileEntityType =
  | "job_note"
  | "client_note"
  | "client_document"
  | "contract_document"
  | "technician_document"
  // 2026-04-13 (Commit C): transient image attachments for invoice send flow.
  // No persistent join table — the file is referenced by id from the send
  // payload at send time only.
  | "invoice_email_attachment"
  // 2026-04-14 Phase 1 cleanup: receipts owned 1:1 by a job_expense row.
  // No join table — the adapter writes back to jobExpenses.receiptFileId
  // (same ownership pattern as invoice_email_attachment, but persistent).
  | "job_expense_receipt";

/** Context returned by a resolver. Carries whatever the key builder needs. */
type EntityContext = Record<string, string> & { tenantId: string };

interface EntityAdapter {
  /**
   * Validate tenant ownership of the target entity and return any fields
   * needed by the object-key builder. Throws 404 if missing.
   */
  resolve(companyId: string, entityId: string): Promise<EntityContext>;
  /**
   * Build the R2 object key from the resolver context. Every key MUST begin
   * with `tenants/{tenantId}/` so bucket-level policy stays tenant-scoped.
   */
  buildObjectKey(ctx: EntityContext, fileId: string, filename: string): string;
  /**
   * Insert (idempotent) the join row linking this entityId to this fileId.
   * Called only after the file row is marked `uploaded`.
   */
  ensureAttachment(
    companyId: string,
    userId: string,
    entityId: string,
    fileId: string,
  ): Promise<void>;
  /** Delete any attachment rows pointing at this fileId. Used on fileDelete. */
  detachByFileId(companyId: string, fileId: string): Promise<void>;
}

async function resolveJobNote(companyId: string, noteId: string): Promise<EntityContext> {
  const [note] = await db
    .select({ id: jobNotes.id, jobId: jobNotes.jobId })
    .from(jobNotes)
    .where(and(eq(jobNotes.id, noteId), eq(jobNotes.companyId, companyId)))
    .limit(1);
  if (!note) throw createError(404, "Note not found");
  // Defensive tenant check on the parent job.
  const [job] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.id, note.jobId), eq(jobs.companyId, companyId)))
    .limit(1);
  if (!job) throw createError(404, "Job not found");
  return { tenantId: companyId, jobId: note.jobId, noteId: note.id };
}

async function resolveClientNote(companyId: string, noteId: string): Promise<EntityContext> {
  const [note] = await db
    .select({
      id: clientNotes.id,
      locationId: clientNotes.locationId,
      clientId: clientNotes.clientId,
    })
    .from(clientNotes)
    .where(and(eq(clientNotes.id, noteId), eq(clientNotes.companyId, companyId)))
    .limit(1);
  if (!note) throw createError(404, "Client note not found");
  // clientNotes.locationId is the canonical tenant-scoped parent.
  const parentId = note.locationId ?? note.clientId;
  if (!parentId) {
    // Customer-company-level notes use customerCompanyId; fall back to a
    // synthetic key rather than a missing-parent 404 — the note itself
    // already proved tenant membership.
    return { tenantId: companyId, clientId: "_unscoped_", noteId: note.id };
  }
  const [loc] = await db
    .select({ id: clientLocations.id })
    .from(clientLocations)
    .where(and(eq(clientLocations.id, parentId), eq(clientLocations.companyId, companyId)))
    .limit(1);
  if (!loc) throw createError(404, "Client location not found");
  return { tenantId: companyId, clientId: parentId, noteId: note.id };
}

async function resolveClientLocation(
  companyId: string,
  clientId: string,
): Promise<EntityContext> {
  const [loc] = await db
    .select({ id: clientLocations.id })
    .from(clientLocations)
    .where(and(eq(clientLocations.id, clientId), eq(clientLocations.companyId, companyId)))
    .limit(1);
  if (!loc) throw createError(404, "Client not found");
  return { tenantId: companyId, clientId: loc.id };
}

async function resolveContract(companyId: string, contractId: string): Promise<EntityContext> {
  const [row] = await db
    .select({ id: recurringJobTemplates.id })
    .from(recurringJobTemplates)
    .where(
      and(
        eq(recurringJobTemplates.id, contractId),
        eq(recurringJobTemplates.companyId, companyId),
      ),
    )
    .limit(1);
  if (!row) throw createError(404, "Contract not found");
  return { tenantId: companyId, contractId: row.id };
}

async function resolveInvoiceForEmail(companyId: string, invoiceId: string): Promise<EntityContext> {
  const [row] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
    .limit(1);
  if (!row) throw createError(404, "Invoice not found");
  return { tenantId: companyId, invoiceId: row.id };
}

async function resolveJobExpense(companyId: string, expenseId: string): Promise<EntityContext> {
  const [row] = await db
    .select({ id: jobExpenses.id, jobId: jobExpenses.jobId })
    .from(jobExpenses)
    .where(and(eq(jobExpenses.id, expenseId), eq(jobExpenses.companyId, companyId)))
    .limit(1);
  if (!row) throw createError(404, "Job expense not found");
  return { tenantId: companyId, jobId: row.jobId, expenseId: row.id };
}

async function resolveTechnician(companyId: string, technicianId: string): Promise<EntityContext> {
  const [u] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(and(eq(users.id, technicianId), eq(users.companyId, companyId)))
    .limit(1);
  if (!u) throw createError(404, "Technician not found");
  // Role check is advisory — keep historical rows valid if a role changes.
  return { tenantId: companyId, technicianId: u.id };
}

const ENTITY_ADAPTERS: Record<FileEntityType, EntityAdapter> = {
  job_note: {
    resolve: resolveJobNote,
    buildObjectKey: (ctx, fileId, filename) =>
      `tenants/${ctx.tenantId}/jobs/${ctx.jobId}/notes/${ctx.noteId}/${fileId}/${sanitizeFilename(filename)}`,
    ensureAttachment: async (companyId, userId, noteId, fileId) => {
      const [existing] = await db
        .select({ id: jobNoteAttachments.id })
        .from(jobNoteAttachments)
        .where(
          and(
            eq(jobNoteAttachments.companyId, companyId),
            eq(jobNoteAttachments.noteId, noteId),
            eq(jobNoteAttachments.fileId, fileId),
          ),
        )
        .limit(1);
      if (existing) return;
      await db.insert(jobNoteAttachments).values({ companyId, noteId, fileId, createdBy: userId });
    },
    detachByFileId: async (companyId, fileId) => {
      await db
        .delete(jobNoteAttachments)
        .where(
          and(eq(jobNoteAttachments.companyId, companyId), eq(jobNoteAttachments.fileId, fileId)),
        );
    },
  },
  client_note: {
    resolve: resolveClientNote,
    buildObjectKey: (ctx, fileId, filename) =>
      `tenants/${ctx.tenantId}/clients/${ctx.clientId}/notes/${ctx.noteId}/${fileId}/${sanitizeFilename(filename)}`,
    ensureAttachment: async (companyId, userId, noteId, fileId) => {
      const [existing] = await db
        .select({ id: noteAttachments.id })
        .from(noteAttachments)
        .where(
          and(
            eq(noteAttachments.companyId, companyId),
            eq(noteAttachments.noteId, noteId),
            eq(noteAttachments.fileId, fileId),
          ),
        )
        .limit(1);
      if (existing) return;
      await db.insert(noteAttachments).values({ companyId, noteId, fileId, createdBy: userId });
    },
    detachByFileId: async (companyId, fileId) => {
      await db
        .delete(noteAttachments)
        .where(and(eq(noteAttachments.companyId, companyId), eq(noteAttachments.fileId, fileId)));
    },
  },
  client_document: {
    resolve: resolveClientLocation,
    buildObjectKey: (ctx, fileId, filename) =>
      `tenants/${ctx.tenantId}/clients/${ctx.clientId}/documents/${fileId}/${sanitizeFilename(filename)}`,
    ensureAttachment: async (companyId, userId, clientId, fileId) => {
      const [existing] = await db
        .select({ id: clientFiles.id })
        .from(clientFiles)
        .where(
          and(
            eq(clientFiles.companyId, companyId),
            eq(clientFiles.clientId, clientId),
            eq(clientFiles.fileId, fileId),
          ),
        )
        .limit(1);
      if (existing) return;
      await db.insert(clientFiles).values({ companyId, clientId, fileId, createdBy: userId });
    },
    detachByFileId: async (companyId, fileId) => {
      await db
        .delete(clientFiles)
        .where(and(eq(clientFiles.companyId, companyId), eq(clientFiles.fileId, fileId)));
    },
  },
  contract_document: {
    resolve: resolveContract,
    buildObjectKey: (ctx, fileId, filename) =>
      `tenants/${ctx.tenantId}/contracts/${ctx.contractId}/${fileId}/${sanitizeFilename(filename)}`,
    ensureAttachment: async (companyId, userId, contractId, fileId) => {
      const [existing] = await db
        .select({ id: contractFiles.id })
        .from(contractFiles)
        .where(
          and(
            eq(contractFiles.companyId, companyId),
            eq(contractFiles.contractId, contractId),
            eq(contractFiles.fileId, fileId),
          ),
        )
        .limit(1);
      if (existing) return;
      await db.insert(contractFiles).values({ companyId, contractId, fileId, createdBy: userId });
    },
    detachByFileId: async (companyId, fileId) => {
      await db
        .delete(contractFiles)
        .where(and(eq(contractFiles.companyId, companyId), eq(contractFiles.fileId, fileId)));
    },
  },
  invoice_email_attachment: {
    resolve: resolveInvoiceForEmail,
    buildObjectKey: (ctx, fileId, filename) =>
      `tenants/${ctx.tenantId}/invoices/${ctx.invoiceId}/email-attachments/${fileId}/${sanitizeFilename(filename)}`,
    // Transient attachments are not joined into a persistent table — the
    // file row itself is the record of its existence, and the send payload
    // references it by id. `ensureAttachment` is a no-op.
    ensureAttachment: async () => {},
    detachByFileId: async () => {},
  },
  job_expense_receipt: {
    resolve: resolveJobExpense,
    buildObjectKey: (ctx, fileId, filename) =>
      `tenants/${ctx.tenantId}/jobs/${ctx.jobId}/expenses/${ctx.expenseId}/${fileId}/${sanitizeFilename(filename)}`,
    ensureAttachment: async (companyId, _userId, expenseId, fileId) => {
      // 1:1 link lives on the owning row — write-back the canonical FK.
      await db
        .update(jobExpenses)
        .set({ receiptFileId: fileId, updatedAt: new Date() })
        .where(and(eq(jobExpenses.id, expenseId), eq(jobExpenses.companyId, companyId)));
    },
    detachByFileId: async (companyId, fileId) => {
      await db
        .update(jobExpenses)
        .set({ receiptFileId: null, updatedAt: new Date() })
        .where(and(eq(jobExpenses.receiptFileId, fileId), eq(jobExpenses.companyId, companyId)));
    },
  },
  technician_document: {
    resolve: resolveTechnician,
    buildObjectKey: (ctx, fileId, filename) =>
      `tenants/${ctx.tenantId}/technicians/${ctx.technicianId}/${fileId}/${sanitizeFilename(filename)}`,
    ensureAttachment: async (companyId, userId, technicianId, fileId) => {
      const [existing] = await db
        .select({ id: technicianFiles.id })
        .from(technicianFiles)
        .where(
          and(
            eq(technicianFiles.companyId, companyId),
            eq(technicianFiles.technicianId, technicianId),
            eq(technicianFiles.fileId, fileId),
          ),
        )
        .limit(1);
      if (existing) return;
      await db
        .insert(technicianFiles)
        .values({ companyId, technicianId, fileId, createdBy: userId });
    },
    detachByFileId: async (companyId, fileId) => {
      await db
        .delete(technicianFiles)
        .where(and(eq(technicianFiles.companyId, companyId), eq(technicianFiles.fileId, fileId)));
    },
  },
};

function getAdapter(entityType: FileEntityType): EntityAdapter {
  const adapter = ENTITY_ADAPTERS[entityType];
  if (!adapter) throw createError(400, `Unsupported entityType: ${entityType}`);
  return adapter;
}

// ---------------------------------------------------------------------------
// 3-step upload lifecycle
// ---------------------------------------------------------------------------

export interface RequestUploadInput {
  companyId: string;
  userId: string;
  entityType: FileEntityType;
  entityId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface RequestUploadResult {
  fileId: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  objectKey: string;
  expiresInSeconds: number;
}

export async function requestUpload(input: RequestUploadInput): Promise<RequestUploadResult> {
  if (!isR2Configured()) {
    throw createError(503, "File storage is not configured");
  }
  const adapter = getAdapter(input.entityType);

  validateMimeAndSize(input.mimeType, input.sizeBytes);
  const ctx = await adapter.resolve(input.companyId, input.entityId);

  const provider = getR2Provider();
  const fileId = randomUUID();
  const bucket = provider.defaultBucket;
  const objectKey = adapter.buildObjectKey(ctx, fileId, input.filename);

  await db.insert(files).values({
    id: fileId,
    companyId: input.companyId,
    storageProvider: "r2",
    bucket,
    storageKey: objectKey,
    originalName: input.filename,
    mimeType: input.mimeType,
    size: input.sizeBytes,
    status: "pending_upload",
    category: resolveCategory(input.entityType, input.mimeType),
    createdBy: input.userId,
  });

  const presigned = await provider.createPresignedUpload({
    bucket,
    objectKey,
    mimeType: input.mimeType,
    maxSizeBytes: input.sizeBytes,
  });

  return {
    fileId,
    uploadUrl: presigned.url,
    requiredHeaders: presigned.requiredHeaders,
    objectKey,
    expiresInSeconds: presigned.expiresInSeconds,
  };
}

export interface FinalizeUploadInput {
  companyId: string;
  userId: string;
  fileId: string;
  /** For job_note: the noteId this file should be attached to. */
  entityType: FileEntityType;
  entityId: string;
}

export async function finalizeUpload(input: FinalizeUploadInput): Promise<FileDTO> {
  const file = await loadFileForTenant(input.companyId, input.fileId);
  const adapter = getAdapter(input.entityType);

  // Idempotency — finalizing an already-finalized file is a no-op aside
  // from (re-)ensuring the attachment row exists.
  if (file.status === "uploaded") {
    await adapter.ensureAttachment(input.companyId, input.userId, input.entityId, file.id);
    return toFileDTO(file);
  }

  // Reject terminal / wrong-state rows up front. These do NOT transition
  // to "failed" — they're already in a known, non-pending state and we
  // must not rewrite them.
  if (file.status !== "pending_upload") {
    throw createError(409, `Cannot finalize file in status=${file.status}`);
  }
  if (file.storageProvider !== "r2") {
    throw createError(400, "Only r2-provider files can be finalized through this endpoint");
  }
  if (!file.bucket) {
    await markFailed(input.companyId, file.id);
    throw createError(500, "File row missing bucket");
  }

  // Validate target entity BEFORE we touch R2 so a bogus entityId never
  // triggers any network I/O.
  await adapter.resolve(input.companyId, input.entityId);

  // From this point on, any exception or unexpected state flips the row
  // to `failed` so it never lingers as pending_upload. We rethrow so the
  // caller sees the real reason.
  try {
    const provider = getR2Provider();
    const head = await provider.headObject(file.bucket, file.storageKey);
    if (!head.exists) {
      await markFailed(input.companyId, file.id);
      throw createError(400, "Uploaded object not found in storage");
    }

    // Size validation — the client declared `file.size`; R2 has `head.sizeBytes`.
    // If R2 didn't return a size (unusual but possible), we skip this check
    // rather than fail the upload. If it did, any mismatch beyond the
    // tolerance aborts the finalize.
    const declaredSize = file.size ?? 0;
    if (
      typeof head.sizeBytes === "number" &&
      declaredSize > 0 &&
      Math.abs(head.sizeBytes - declaredSize) > SIZE_MATCH_TOLERANCE_BYTES
    ) {
      await markFailed(input.companyId, file.id);
      throw createError(
        400,
        `Uploaded size (${head.sizeBytes}) does not match declared size (${declaredSize})`,
      );
    }

    const [updated] = await db
      .update(files)
      .set({
        status: "uploaded",
        size: head.sizeBytes ?? file.size,
        updatedAt: new Date(),
      })
      .where(and(eq(files.id, file.id), eq(files.companyId, input.companyId)))
      .returning();

    // Attach AFTER the file row is marked uploaded. Failure here (e.g. a
    // concurrent entity delete) is recoverable: the file row is valid and
    // the caller gets the usual DB error; we do NOT flip to failed because
    // the blob is intact.
    await adapter.ensureAttachment(input.companyId, input.userId, input.entityId, file.id);

    return toFileDTO(updated);
  } catch (err) {
    // We only mark `failed` for errors we raised against this row. A generic
    // DB error from the UPDATE above means the row may still be pending;
    // we flip it to failed defensively — better to force a re-upload than
    // leak a ghost pending row. markFailed is idempotent.
    await markFailed(input.companyId, file.id).catch(() => undefined);
    throw err;
  }
}

async function markFailed(companyId: string, fileId: string): Promise<void> {
  await db
    .update(files)
    .set({ status: "failed", updatedAt: new Date() })
    .where(
      and(
        eq(files.id, fileId),
        eq(files.companyId, companyId),
        eq(files.status, "pending_upload"),
      ),
    );
}

// ---------------------------------------------------------------------------
// Read path
// ---------------------------------------------------------------------------

export interface AccessUrlResult {
  url: string;
  expiresInSeconds: number;
  storageProvider: string;
}

/**
 * Return a short-lived read URL for a file. For R2 rows we issue a signed
 * download URL; legacy local rows continue to use the existing in-process
 * streaming endpoint (`GET /api/files/:fileId`) — we just return that
 * relative path so the UI can treat both shapes uniformly.
 */
export async function getFileAccessUrl(
  companyId: string,
  fileId: string,
): Promise<AccessUrlResult> {
  const file = await loadFileForTenant(companyId, fileId);
  if (file.status !== "uploaded") {
    throw createError(409, `File is not ready (status=${file.status})`);
  }

  if (file.storageProvider === "r2") {
    if (!file.bucket) throw createError(500, "File row missing bucket");
    const provider = getR2Provider();
    const signed = await provider.createPresignedDownload({
      bucket: file.bucket,
      objectKey: file.storageKey,
      filename: file.originalName ?? undefined,
    });
    return {
      url: signed.url,
      expiresInSeconds: signed.expiresInSeconds,
      storageProvider: "r2",
    };
  }

  // Legacy disk fallback — the existing /api/files/:fileId GET endpoint
  // handles tenant-scoped disk streaming. We don't pre-sign; we just point
  // the client at the in-process route.
  return {
    url: `/api/files/${file.id}`,
    expiresInSeconds: 0,
    storageProvider: "local",
  };
}

const FILE_SELECTION = {
  id: files.id,
  companyId: files.companyId,
  storageProvider: files.storageProvider,
  bucket: files.bucket,
  storageKey: files.storageKey,
  originalName: files.originalName,
  mimeType: files.mimeType,
  size: files.size,
  status: files.status,
  category: files.category,
  createdAt: files.createdAt,
  updatedAt: files.updatedAt,
  createdBy: files.createdBy,
};

/** List files attached to a job note. Tenant-scoped, uploaded-only. */
export async function listJobNoteFiles(
  companyId: string,
  noteId: string,
): Promise<FileDTO[]> {
  await getAdapter("job_note").resolve(companyId, noteId);
  const rows = await db
    .select(FILE_SELECTION)
    .from(jobNoteAttachments)
    .innerJoin(files, eq(jobNoteAttachments.fileId, files.id))
    .where(
      and(
        eq(jobNoteAttachments.companyId, companyId),
        eq(jobNoteAttachments.noteId, noteId),
        eq(files.status, "uploaded"),
      ),
    );
  return rows.map((r) => toFileDTO(r as FileRecord));
}

/** List files attached to a client note. Tenant-scoped, uploaded-only. */
export async function listClientNoteFiles(
  companyId: string,
  noteId: string,
): Promise<FileDTO[]> {
  await getAdapter("client_note").resolve(companyId, noteId);
  const rows = await db
    .select(FILE_SELECTION)
    .from(noteAttachments)
    .innerJoin(files, eq(noteAttachments.fileId, files.id))
    .where(
      and(
        eq(noteAttachments.companyId, companyId),
        eq(noteAttachments.noteId, noteId),
        eq(files.status, "uploaded"),
      ),
    );
  return rows.map((r) => toFileDTO(r as FileRecord));
}

/** List documents attached directly to a client location. */
export async function listClientFiles(
  companyId: string,
  clientId: string,
): Promise<FileDTO[]> {
  await getAdapter("client_document").resolve(companyId, clientId);
  const rows = await db
    .select(FILE_SELECTION)
    .from(clientFiles)
    .innerJoin(files, eq(clientFiles.fileId, files.id))
    .where(
      and(
        eq(clientFiles.companyId, companyId),
        eq(clientFiles.clientId, clientId),
        eq(files.status, "uploaded"),
      ),
    );
  return rows.map((r) => toFileDTO(r as FileRecord));
}

/** List files attached to a contract. */
export async function listContractFiles(
  companyId: string,
  contractId: string,
): Promise<FileDTO[]> {
  await getAdapter("contract_document").resolve(companyId, contractId);
  const rows = await db
    .select(FILE_SELECTION)
    .from(contractFiles)
    .innerJoin(files, eq(contractFiles.fileId, files.id))
    .where(
      and(
        eq(contractFiles.companyId, companyId),
        eq(contractFiles.contractId, contractId),
        eq(files.status, "uploaded"),
      ),
    );
  return rows.map((r) => toFileDTO(r as FileRecord));
}

/** List files attached to a technician. */
export async function listTechnicianFiles(
  companyId: string,
  technicianId: string,
): Promise<FileDTO[]> {
  await getAdapter("technician_document").resolve(companyId, technicianId);
  const rows = await db
    .select(FILE_SELECTION)
    .from(technicianFiles)
    .innerJoin(files, eq(technicianFiles.fileId, files.id))
    .where(
      and(
        eq(technicianFiles.companyId, companyId),
        eq(technicianFiles.technicianId, technicianId),
        eq(files.status, "uploaded"),
      ),
    );
  return rows.map((r) => toFileDTO(r as FileRecord));
}

// ---------------------------------------------------------------------------
// Orphan cleanup — sweep pending_upload rows older than the threshold.
// ---------------------------------------------------------------------------

export interface SweepOrphansResult {
  scanned: number;
  failed: number;
  objectDeleteAttempts: number;
}

/**
 * Find `pending_upload` rows older than `ORPHAN_THRESHOLD_MINUTES` and
 * mark them `failed`. For R2 rows we also fire a best-effort deleteObject
 * so abandoned blobs do not accumulate. DB state is authoritative — any
 * delete error is swallowed.
 *
 * Called on an interval from server bootstrap. Also exported for manual
 * invocation (e.g. a future admin endpoint). No external cron.
 */
export async function sweepOrphanedUploads(): Promise<SweepOrphansResult> {
  const cutoff = new Date(Date.now() - ORPHAN_THRESHOLD_MINUTES * 60 * 1000);
  const stale = await db
    .select()
    .from(files)
    .where(and(eq(files.status, "pending_upload"), lt(files.createdAt, cutoff)));

  if (stale.length === 0) {
    return { scanned: 0, failed: 0, objectDeleteAttempts: 0 };
  }

  let failed = 0;
  let deleteAttempts = 0;
  for (const row of stale) {
    // Flip the row atomically — if something else raced us to 'uploaded'
    // between the SELECT and the UPDATE, the WHERE guard prevents us from
    // stomping a legitimate finalize.
    const result = await db
      .update(files)
      .set({ status: "failed", updatedAt: new Date() })
      .where(
        and(
          eq(files.id, row.id),
          eq(files.companyId, row.companyId),
          eq(files.status, "pending_upload"),
        ),
      )
      .returning({ id: files.id });
    if (result.length === 0) continue;
    failed += 1;

    if (row.storageProvider === "r2" && row.bucket) {
      deleteAttempts += 1;
      try {
        await getR2Provider().deleteObject(row.bucket, row.storageKey);
      } catch {
        // Best-effort. DB state is authoritative.
      }
    }
  }
  return { scanned: stale.length, failed, objectDeleteAttempts: deleteAttempts };
}

/**
 * Start the orphan sweeper on an interval. Returns the interval handle so
 * callers can clear it during shutdown. Safe to invoke once from bootstrap.
 */
export function startOrphanSweeper(): NodeJS.Timeout {
  // Run every ORPHAN_THRESHOLD_MINUTES — no need to be more aggressive.
  const intervalMs = ORPHAN_THRESHOLD_MINUTES * 60 * 1000;
  return setInterval(() => {
    sweepOrphanedUploads().catch((err) => {
      // Log and keep going — one bad tick must not stop the sweeper.
      // eslint-disable-next-line no-console
      console.error("[fileUploads] orphan sweep failed:", err);
    });
  }, intervalMs).unref();
}

// ---------------------------------------------------------------------------
// Delete path — soft-delete metadata, best-effort remove the R2 object.
// ---------------------------------------------------------------------------

export async function deleteFile(companyId: string, fileId: string): Promise<void> {
  const file = await loadFileForTenant(companyId, fileId);
  if (file.status === "deleted") return;

  await db
    .update(files)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(and(eq(files.id, fileId), eq(files.companyId, companyId)));

  // Remove join rows so the attachment disappears from listings immediately.
  // We ask every adapter to detach — a file can only live in one join table
  // by our insertion rules, so the non-matching deletes are no-ops.
  for (const adapter of Object.values(ENTITY_ADAPTERS)) {
    await adapter.detachByFileId(companyId, fileId);
  }

  // Best-effort blob removal for R2 rows. If it fails, the soft-delete is
  // still authoritative — a later janitor can clean up orphans.
  if (file.storageProvider === "r2" && file.bucket) {
    try {
      await getR2Provider().deleteObject(file.bucket, file.storageKey);
    } catch {
      // swallow: DB state remains correct.
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * 2026-04-13 (Commit C): fetch an uploaded file's raw bytes from the backing
 * provider. Tenant-scoped and status-gated. Used by the email dispatch
 * service to attach user-selected images to outbound mail without
 * round-tripping through a presigned URL.
 *
 * Returns `{ buffer, filename, mimeType }`. Throws:
 *   - 404 if the file doesn't belong to the tenant,
 *   - 409 if it's not in `uploaded` state,
 *   - 500 on legacy-local rows (unsupported until local provider lands).
 */
export async function getFileBufferForTenant(
  companyId: string,
  fileId: string,
): Promise<{ buffer: Buffer; filename: string; mimeType: string; sizeBytes: number | null }> {
  const file = await loadFileForTenant(companyId, fileId);
  if (file.status !== "uploaded") {
    throw createError(409, `File is not ready (status=${file.status})`);
  }
  if (file.storageProvider !== "r2") {
    throw createError(500, "Legacy local files cannot be attached to email");
  }
  if (!file.bucket) throw createError(500, "File row missing bucket");

  const buffer = await getR2Provider().getObjectBuffer(file.bucket, file.storageKey);
  return {
    buffer,
    filename: file.originalName ?? `attachment-${file.id.slice(0, 8)}`,
    mimeType: file.mimeType ?? "application/octet-stream",
    sizeBytes: file.size ?? null,
  };
}

async function loadFileForTenant(companyId: string, fileId: string): Promise<FileRecord> {
  const [row] = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.companyId, companyId)))
    .limit(1);
  if (!row) throw createError(404, "File not found");
  return row;
}
