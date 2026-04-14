import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { jobNoteAttachments, files, jobNotes } from "@shared/schema";
import { BaseRepository } from "./base";

/**
 * JobNoteAttachmentRepository — manages the job_note↔file join table.
 * Mirrors NoteAttachmentRepository but scoped to job notes.
 */
export class JobNoteAttachmentRepository extends BaseRepository {
  /** List all attachments for a job note with file metadata. */
  async listByNote(companyId: string, noteId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(noteId, "noteId");
    return db
      .select({
        id: jobNoteAttachments.id,
        noteId: jobNoteAttachments.noteId,
        fileId: jobNoteAttachments.fileId,
        createdAt: jobNoteAttachments.createdAt,
        originalName: files.originalName,
        mimeType: files.mimeType,
        size: files.size,
      })
      .from(jobNoteAttachments)
      .innerJoin(files, eq(jobNoteAttachments.fileId, files.id))
      .where(
        and(eq(jobNoteAttachments.noteId, noteId), eq(jobNoteAttachments.companyId, companyId))
      );
  }

  /** Attach a file to a job note. Verifies both belong to tenant. */
  async attach(companyId: string, userId: string, noteId: string, fileId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(noteId, "noteId");
    this.validateUUID(fileId, "fileId");

    // Verify note ownership
    const [note] = await db
      .select({ id: jobNotes.id })
      .from(jobNotes)
      .where(and(eq(jobNotes.id, noteId), eq(jobNotes.companyId, companyId)))
      .limit(1);
    if (!note) throw this.notFoundError("Job Note");

    // Verify file ownership
    const [file] = await db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.companyId, companyId)))
      .limit(1);
    if (!file) throw this.notFoundError("File");

    const [row] = await db
      .insert(jobNoteAttachments)
      .values({ companyId, noteId, fileId, createdBy: userId })
      .returning();
    return row;
  }

  /**
   * Remove a single attachment link. Since files are 1:1 with attachments,
   * detaching is also the trigger to soft-delete the underlying file row
   * and best-effort remove the R2 blob (2026-04-13 — canonical cleanup).
   * `deleteFile` is idempotent; a repeat call on a missing / already-
   * deleted file is a no-op.
   */
  async detach(companyId: string, attachmentId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(attachmentId, "attachmentId");
    const [row] = await db
      .delete(jobNoteAttachments)
      .where(and(eq(jobNoteAttachments.id, attachmentId), eq(jobNoteAttachments.companyId, companyId)))
      .returning();
    if (row?.fileId) {
      // Dynamic import avoids any import cycle between storage repos and
      // the file service (the service already imports this repo's schema).
      const { deleteFile } = await import("../services/fileUploadService");
      await deleteFile(companyId, row.fileId).catch(() => {});
    }
    return row ?? null;
  }
}

export const jobNoteAttachmentRepository = new JobNoteAttachmentRepository();
