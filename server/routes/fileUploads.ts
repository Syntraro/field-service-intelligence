/**
 * Canonical file upload routes.
 *
 * Thin controllers — all policy + blob I/O lives in
 * server/services/fileUploadService.ts. This module only parses input,
 * enforces auth, and maps service results to JSON.
 *
 * Mounted at / (see server/routes/index.ts):
 *   POST   /api/files/upload-request
 *   POST   /api/files/:fileId/finalize
 *   POST   /api/files/:fileId/access-url
 *   DELETE /api/files/:fileId
 *   GET    /api/notes/:noteId/files
 */

import { Router, type Response } from "express";
import { z } from "zod";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";
import { validateSchema } from "../utils/validationHelpers";
import {
  deleteFile,
  finalizeUpload,
  getFileAccessUrl,
  listClientFiles,
  listClientNoteFiles,
  listContractFiles,
  listJobNoteFiles,
  listTechnicianFiles,
  requestUpload,
} from "../services/fileUploadService";

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

// 2026-04-12 Phase 2: entityType now covers every file-owning entity. Each
// value maps to an adapter inside fileUploadService; routes stay thin.
// 2026-05-02 (Audit #2 PR 3C): `quote_note` added so the canonical
// `EntityNoteDialog` can stage + upload attachments for quote notes the
// same way it does for job/client notes. The adapter writes through to
// `quote_note_attachments` (added in PR 3A).
const ENTITY_TYPES = [
  "job_note",
  "quote_note",
  "client_note",
  "client_document",
  "contract_document",
  "technician_document",
  // 2026-04-14 Phase 1 cleanup: receipts migrated off legacy /api/uploads.
  "job_expense_receipt",
] as const;

const uploadRequestSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string().min(1),
  filename: z.string().min(1).max(255),
  mimeType: z.enum(ALLOWED_MIME),
  sizeBytes: z.number().int().positive(),
});

const finalizeSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string().min(1),
});

export const fileUploadsRouter = Router();

/**
 * 2026-04-14 hardening: convert auth-missing crash paths from 500
 * ("Internal server error" with no stack) into explicit 401/403 JSON
 * responses so production visibility is clear, and surround the
 * canonical upload service calls with structured logging so the next
 * Render-only failure surfaces the exact entity + stage that threw.
 *
 * The non-null assertions on `req.companyId` / `req.user` were the
 * single biggest hidden 500 vector — if the global auth binding failed
 * for any reason (subdomain cookie issue, out-of-order middleware,
 * impersonation edge case), the assertion would throw a TypeError
 * deep in the service layer with no context.
 */
function requireAuthedTenant(req: AuthedRequest): { companyId: string; userId: string } {
  const companyId = req.companyId;
  const userId = req.user?.id;
  if (!userId) throw createError(401, "Not authenticated");
  if (!companyId) throw createError(403, "Tenant context missing");
  return { companyId, userId };
}

function logUploadError(stage: string, ctx: Record<string, unknown>, err: unknown) {
  const e = err as any;
  console.error(
    `[fileUploads] stage=${stage} failed`,
    JSON.stringify({
      ...ctx,
      message: e?.message ?? String(err),
      status: e?.statusCode ?? e?.status ?? null,
      name: e?.name ?? null,
    }),
  );
}

fileUploadsRouter.post(
  "/files/upload-request",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId, userId } = requireAuthedTenant(req);
    const data = validateSchema(uploadRequestSchema, req.body);
    try {
      const result = await requestUpload({
        companyId,
        userId,
        entityType: data.entityType,
        entityId: data.entityId,
        filename: data.filename,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
      });
      res.status(201).json(result);
    } catch (err) {
      logUploadError("upload-request", {
        companyId,
        userId,
        entityType: data.entityType,
        entityId: data.entityId,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
      }, err);
      throw err;
    }
  }),
);

fileUploadsRouter.post(
  "/files/:fileId/finalize",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId, userId } = requireAuthedTenant(req);
    const data = validateSchema(finalizeSchema, req.body);
    try {
      const dto = await finalizeUpload({
        companyId,
        userId,
        fileId: req.params.fileId,
        entityType: data.entityType,
        entityId: data.entityId,
      });
      res.status(200).json(dto);
    } catch (err) {
      logUploadError("finalize", {
        companyId,
        userId,
        fileId: req.params.fileId,
        entityType: data.entityType,
        entityId: data.entityId,
      }, err);
      throw err;
    }
  }),
);

fileUploadsRouter.post(
  "/files/:fileId/access-url",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const result = await getFileAccessUrl(req.companyId!, req.params.fileId);
    res.json(result);
  }),
);

fileUploadsRouter.delete(
  "/files/:fileId",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    await deleteFile(req.companyId!, req.params.fileId);
    res.json({ success: true });
  }),
);

export const jobNoteFilesRouter = Router();

// Job-note files are still listed at /api/notes/:noteId/files to preserve
// the Phase 1 URL. Client-note files live at /api/client-notes/:id/files
// so the two note types don't collide on a single path.
jobNoteFilesRouter.get(
  "/notes/:noteId/files",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const dtos = await listJobNoteFiles(req.companyId!, req.params.noteId);
    res.json(dtos);
  }),
);

jobNoteFilesRouter.get(
  "/client-notes/:noteId/files",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const dtos = await listClientNoteFiles(req.companyId!, req.params.noteId);
    res.json(dtos);
  }),
);

jobNoteFilesRouter.get(
  "/clients/:clientId/files",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const dtos = await listClientFiles(req.companyId!, req.params.clientId);
    res.json(dtos);
  }),
);

jobNoteFilesRouter.get(
  "/contracts/:contractId/files",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const dtos = await listContractFiles(req.companyId!, req.params.contractId);
    res.json(dtos);
  }),
);

jobNoteFilesRouter.get(
  "/technicians/:technicianId/files",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const dtos = await listTechnicianFiles(req.companyId!, req.params.technicianId);
    res.json(dtos);
  }),
);
