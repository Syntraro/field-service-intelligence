import { db } from "../db";
import { and, eq, desc, inArray } from "drizzle-orm";
import { jobNotes, jobs, users, jobNoteAttachments, files, jobEquipment } from "@shared/schema";
import { BaseRepository, clampLimit } from "./base";
import { resolveTechnicianName } from "../lib/resolveTechnicianName";
import { activeJobFilter } from "./jobFilters";

/**
 * Job Notes repository - handles all job note database operations.
 * Ensures tenant isolation via companyId scoping.
 */
export class JobNotesRepository extends BaseRepository {
  /**
   * List notes for a job
   */
  async listJobNotes(companyId: string, jobId: string, limit = 100) {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");
    const safeLimit = clampLimit(limit, 500);

    // Verify job exists and belongs to company
    const [job] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId), activeJobFilter()));

    if (!job) {
      throw this.notFoundError("Job");
    }

    // Get notes with user information
    const rows = await db
      .select({
        id: jobNotes.id,
        jobId: jobNotes.jobId,
        equipmentId: jobNotes.equipmentId,
        noteText: jobNotes.noteText,
        createdAt: jobNotes.createdAt,
        updatedAt: jobNotes.updatedAt,
        user: {
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(jobNotes)
      .leftJoin(users, eq(jobNotes.userId, users.id))
      .where(and(eq(jobNotes.companyId, companyId), eq(jobNotes.jobId, jobId)))
      .orderBy(desc(jobNotes.createdAt))
      .limit(safeLimit);

    // Load attachments for all notes in one query
    const noteIds = rows.map((r) => r.id);
    const allAttachments = noteIds.length > 0
      ? await db
          .select({
            id: jobNoteAttachments.id,
            noteId: jobNoteAttachments.noteId,
            fileId: jobNoteAttachments.fileId,
            originalName: files.originalName,
            mimeType: files.mimeType,
            size: files.size,
            storageProvider: files.storageProvider,
            status: files.status,
          })
          .from(jobNoteAttachments)
          .innerJoin(files, eq(jobNoteAttachments.fileId, files.id))
          .where(and(
            eq(jobNoteAttachments.companyId, companyId),
            inArray(jobNoteAttachments.noteId, noteIds),
            // Only surface fully-finalized files. `failed` / `deleted` /
            // `pending_upload` rows never appear in attachment listings.
            eq(files.status, "uploaded"),
          ))
      : [];

    // Group attachments by noteId
    const attachmentsByNote = new Map<string, typeof allAttachments>();
    for (const att of allAttachments) {
      const list = attachmentsByNote.get(att.noteId) ?? [];
      list.push(att);
      attachmentsByNote.set(att.noteId, list);
    }

    // Phase 4 Step B4: add pre-resolved userName from canonical utility
    return rows.map((row) => ({
      ...row,
      userName: row.user ? resolveTechnicianName(row.user) : "Unknown",
      attachments: attachmentsByNote.get(row.id) ?? [],
    }));
  }

  /**
   * Create a job note with optional equipment linkage.
   * If equipmentId is provided, it is validated against the job's equipment
   * (via job_equipment junction) to prevent cross-job equipment linking.
   *
   * idempotencyKey: when supplied (offline replay path), the server checks for
   * an existing note with the same (companyId, idempotencyKey) before inserting.
   * If one exists it is returned as-is — no duplicate is created. A racing
   * duplicate insert is caught via the unique index and resolved the same way.
   */
  async createJobNote(
    companyId: string,
    jobId: string,
    userId: string,
    noteText: string,
    equipmentId?: string | null,
    idempotencyKey?: string | null,
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");
    this.validateUUID(userId, "userId");

    // Fast-path: if the client already has an idempotency key, check for an
    // existing note before doing any further validation or insert.
    if (idempotencyKey) {
      const [existing] = await db
        .select({
          id: jobNotes.id,
          jobId: jobNotes.jobId,
          equipmentId: jobNotes.equipmentId,
          noteText: jobNotes.noteText,
          createdAt: jobNotes.createdAt,
          updatedAt: jobNotes.updatedAt,
          user: {
            id: users.id,
            email: users.email,
            fullName: users.fullName,
            firstName: users.firstName,
            lastName: users.lastName,
          },
        })
        .from(jobNotes)
        .leftJoin(users, eq(jobNotes.userId, users.id))
        .where(
          and(
            eq(jobNotes.companyId, companyId),
            eq(jobNotes.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) return existing;
    }

    // Verify job exists and belongs to company
    const [job] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId), activeJobFilter()));

    if (!job) {
      throw this.notFoundError("Job");
    }

    // Validate equipmentId belongs to this job (via job_equipment junction)
    if (equipmentId) {
      this.validateUUID(equipmentId, "equipmentId");
      const [linked] = await db
        .select({ id: jobEquipment.id })
        .from(jobEquipment)
        .where(
          and(
            eq(jobEquipment.companyId, companyId),
            eq(jobEquipment.jobId, jobId),
            eq(jobEquipment.equipmentId, equipmentId),
          )
        )
        .limit(1);
      if (!linked) {
        throw this.validationError("Equipment is not linked to this job");
      }
    }

    let noteId: string;
    try {
      const [note] = await db
        .insert(jobNotes)
        .values({
          companyId,
          jobId,
          userId,
          noteText,
          equipmentId: equipmentId ?? null,
          idempotencyKey: idempotencyKey ?? null,
        })
        .returning({ id: jobNotes.id });
      noteId = note.id;
    } catch (err: any) {
      // Unique violation on (company_id, idempotency_key) — a concurrent replay
      // beat us to the insert. Fetch and return the winner.
      if (err?.code === "23505" && idempotencyKey) {
        const [existing] = await db
          .select({
            id: jobNotes.id,
            jobId: jobNotes.jobId,
            equipmentId: jobNotes.equipmentId,
            noteText: jobNotes.noteText,
            createdAt: jobNotes.createdAt,
            updatedAt: jobNotes.updatedAt,
            user: {
              id: users.id,
              email: users.email,
              fullName: users.fullName,
              firstName: users.firstName,
              lastName: users.lastName,
            },
          })
          .from(jobNotes)
          .leftJoin(users, eq(jobNotes.userId, users.id))
          .where(
            and(
              eq(jobNotes.companyId, companyId),
              eq(jobNotes.idempotencyKey, idempotencyKey),
            ),
          )
          .limit(1);
        if (existing) return existing;
      }
      throw err;
    }

    // Get note with user information
    const [noteWithUser] = await db
      .select({
        id: jobNotes.id,
        jobId: jobNotes.jobId,
        equipmentId: jobNotes.equipmentId,
        noteText: jobNotes.noteText,
        createdAt: jobNotes.createdAt,
        updatedAt: jobNotes.updatedAt,
        user: {
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(jobNotes)
      .leftJoin(users, eq(jobNotes.userId, users.id))
      .where(eq(jobNotes.id, noteId));

    return noteWithUser;
  }

  /**
   * Transaction variant for system-generated notes (e.g. visit-completion
   * outcomes, status-change audit trails). Skips the per-call job lookup
   * and the equipment-linkage validation — callers that write system
   * notes already hold the canonical job context inside a transaction.
   *
   * 2026-04-20: added to eliminate the last raw `tx.insert(jobNotes)`
   * write in `jobLifecycleOrchestrator.completeVisit`. Routes through
   * the canonical `jobNotes` column set so any future additions to the
   * table (or per-tenant default stamping) only need to land here.
   */
  async createSystemNoteTx(
    tx: any,
    companyId: string,
    jobId: string,
    userId: string,
    noteText: string,
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");
    this.validateUUID(userId, "userId");
    const [row] = await tx
      .insert(jobNotes)
      .values({
        companyId,
        jobId,
        userId,
        noteText,
      })
      .returning();
    return row;
  }

  /**
   * Update a job note
   * Only the author can update their own notes
   */
  async updateJobNote(
    companyId: string,
    noteId: string,
    userId: string,
    noteText: string
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(noteId, "noteId");
    this.validateUUID(userId, "userId");

    // Verify note exists, belongs to company, and user is the author
    const [existing] = await db
      .select()
      .from(jobNotes)
      .where(
        and(
          eq(jobNotes.id, noteId),
          eq(jobNotes.companyId, companyId),
          eq(jobNotes.userId, userId)
        )
      );

    if (!existing) {
      throw this.notFoundError("Note");
    }

    const [updated] = await db
      .update(jobNotes)
      .set({
        noteText,
        updatedAt: new Date(),
      })
      .where(eq(jobNotes.id, noteId))
      .returning();

    // Get note with user information
    const [noteWithUser] = await db
      .select({
        id: jobNotes.id,
        jobId: jobNotes.jobId,
        noteText: jobNotes.noteText,
        createdAt: jobNotes.createdAt,
        updatedAt: jobNotes.updatedAt,
        user: {
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(jobNotes)
      .leftJoin(users, eq(jobNotes.userId, users.id))
      .where(eq(jobNotes.id, updated.id));

    return noteWithUser;
  }

  /**
   * Delete a job note (hard delete)
   * Only the author can delete their own notes
   * TODO: [IMPROVEMENT] Consider soft delete with deletedAt
   */
  async deleteJobNote(companyId: string, noteId: string, userId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(noteId, "noteId");
    this.validateUUID(userId, "userId");

    // Verify note exists, belongs to company, and user is the author
    const [existing] = await db
      .select()
      .from(jobNotes)
      .where(
        and(
          eq(jobNotes.id, noteId),
          eq(jobNotes.companyId, companyId),
          eq(jobNotes.userId, userId)
        )
      );

    if (!existing) {
      throw this.notFoundError("Note");
    }

    // 2026-04-13 — canonical cleanup. Files are 1:1 with attachments; fetch
    // each attached fileId BEFORE the FK cascade wipes the join rows, then
    // delegate to `deleteFile` (soft-delete file row + best-effort R2
    // deletion). `deleteFile` is idempotent, so repeated deletes don't
    // crash. We tolerate individual-file failures — the note delete below
    // is still authoritative.
    const attachedFiles = await db
      .select({ fileId: jobNoteAttachments.fileId })
      .from(jobNoteAttachments)
      .where(
        and(
          eq(jobNoteAttachments.noteId, noteId),
          eq(jobNoteAttachments.companyId, companyId),
        ),
      );
    if (attachedFiles.length > 0) {
      const { deleteFile } = await import("../services/fileUploadService");
      for (const row of attachedFiles) {
        if (row.fileId) {
          await deleteFile(companyId, row.fileId).catch(() => {});
        }
      }
    }

    await db.delete(jobNotes).where(eq(jobNotes.id, noteId));

    return { success: true };
  }
}

export const jobNotesRepository = new JobNotesRepository();
