import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { noteAttachments, files, clientNotes } from "@shared/schema";
import { BaseRepository } from "./base";

/**
 * NoteAttachmentRepository — manages the note↔file join table.
 */
export class NoteAttachmentRepository extends BaseRepository {
  /** List all attachments for a note with file metadata. */
  async listByNote(companyId: string, noteId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(noteId, "noteId");
    return db
      .select({
        id: noteAttachments.id,
        noteId: noteAttachments.noteId,
        fileId: noteAttachments.fileId,
        createdAt: noteAttachments.createdAt,
        originalName: files.originalName,
        mimeType: files.mimeType,
        size: files.size,
        // 2026-04-12 Phase 2: expose provider + status so AttachmentView
        // can branch on r2 vs legacy local reads. Excludes failed/deleted.
        storageProvider: files.storageProvider,
        status: files.status,
      })
      .from(noteAttachments)
      .innerJoin(files, eq(noteAttachments.fileId, files.id))
      .where(
        and(
          eq(noteAttachments.noteId, noteId),
          eq(noteAttachments.companyId, companyId),
          eq(files.status, "uploaded"),
        ),
      );
  }

  /** Attach a file to a note. Verifies both belong to tenant. */
  async attach(companyId: string, userId: string, noteId: string, fileId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(noteId, "noteId");
    this.validateUUID(fileId, "fileId");

    // Verify note ownership
    const [note] = await db
      .select({ id: clientNotes.id })
      .from(clientNotes)
      .where(and(eq(clientNotes.id, noteId), eq(clientNotes.companyId, companyId)))
      .limit(1);
    if (!note) throw this.notFoundError("Note");

    // Verify file ownership
    const [file] = await db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.companyId, companyId)))
      .limit(1);
    if (!file) throw this.notFoundError("File");

    const [row] = await db
      .insert(noteAttachments)
      .values({ companyId, noteId, fileId, createdBy: userId })
      .returning();
    return row;
  }

  /**
   * Remove a single attachment link. 2026-04-13: since files are 1:1 with
   * attachments in this codebase, detaching also soft-deletes the file row
   * and best-effort removes the R2 blob via `deleteFile` (idempotent).
   */
  async detach(companyId: string, attachmentId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(attachmentId, "attachmentId");
    const [row] = await db
      .delete(noteAttachments)
      .where(and(eq(noteAttachments.id, attachmentId), eq(noteAttachments.companyId, companyId)))
      .returning();
    if (row?.fileId) {
      const { deleteFile } = await import("../services/fileUploadService");
      await deleteFile(companyId, row.fileId).catch(() => {});
    }
    return row ?? null;
  }
}

export const noteAttachmentRepository = new NoteAttachmentRepository();
