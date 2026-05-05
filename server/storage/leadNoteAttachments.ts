import { db } from "../db";
import { and, eq, inArray } from "drizzle-orm";
import { leadNoteAttachments, files, leadNotes } from "@shared/schema";
import { BaseRepository } from "./base";

/**
 * LeadNoteAttachmentRepository — manages the lead_note ↔ file join table.
 * 2026-05-05: 1:1 mirror of `JobNoteAttachmentRepository` so the lead
 * notes surface uses the same canonical pattern. R2 file metadata
 * lives in `files`; this table only expresses "which files are
 * attached to which lead-note".
 */
export class LeadNoteAttachmentRepository extends BaseRepository {
  /** List all attachments for a single lead note with file metadata. */
  async listByNote(companyId: string, noteId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(noteId, "noteId");
    return db
      .select({
        id: leadNoteAttachments.id,
        noteId: leadNoteAttachments.noteId,
        fileId: leadNoteAttachments.fileId,
        createdAt: leadNoteAttachments.createdAt,
        originalName: files.originalName,
        mimeType: files.mimeType,
        size: files.size,
        storageProvider: files.storageProvider,
        status: files.status,
      })
      .from(leadNoteAttachments)
      .innerJoin(files, eq(leadNoteAttachments.fileId, files.id))
      .where(
        and(
          eq(leadNoteAttachments.noteId, noteId),
          eq(leadNoteAttachments.companyId, companyId),
        ),
      );
  }

  /** Bulk-list attachments for a set of note ids. */
  async listForNoteIds(companyId: string, noteIds: string[]) {
    this.assertCompanyId(companyId);
    if (noteIds.length === 0) return [];
    return db
      .select({
        id: leadNoteAttachments.id,
        noteId: leadNoteAttachments.noteId,
        fileId: leadNoteAttachments.fileId,
        createdAt: leadNoteAttachments.createdAt,
        originalName: files.originalName,
        mimeType: files.mimeType,
        size: files.size,
        storageProvider: files.storageProvider,
        status: files.status,
      })
      .from(leadNoteAttachments)
      .innerJoin(files, eq(leadNoteAttachments.fileId, files.id))
      .where(
        and(
          eq(leadNoteAttachments.companyId, companyId),
          inArray(leadNoteAttachments.noteId, noteIds),
        ),
      );
  }

  /** Attach a file to a lead note. Verifies both belong to tenant. */
  async attach(
    companyId: string,
    userId: string,
    noteId: string,
    fileId: string,
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(noteId, "noteId");
    this.validateUUID(fileId, "fileId");

    const [note] = await db
      .select({ id: leadNotes.id })
      .from(leadNotes)
      .where(and(eq(leadNotes.id, noteId), eq(leadNotes.companyId, companyId)))
      .limit(1);
    if (!note) throw this.notFoundError("Lead Note");

    const [file] = await db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.companyId, companyId)))
      .limit(1);
    if (!file) throw this.notFoundError("File");

    // Idempotent insert — if the same noteId/fileId pair already
    // exists (replay), return the existing row instead of duplicating.
    const [existing] = await db
      .select()
      .from(leadNoteAttachments)
      .where(
        and(
          eq(leadNoteAttachments.companyId, companyId),
          eq(leadNoteAttachments.noteId, noteId),
          eq(leadNoteAttachments.fileId, fileId),
        ),
      )
      .limit(1);
    if (existing) return existing;

    const [row] = await db
      .insert(leadNoteAttachments)
      .values({ companyId, noteId, fileId, createdBy: userId })
      .returning();
    return row;
  }

  /** Remove a single attachment link + soft-delete the underlying file. */
  async detach(companyId: string, attachmentId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(attachmentId, "attachmentId");
    const [row] = await db
      .delete(leadNoteAttachments)
      .where(
        and(
          eq(leadNoteAttachments.id, attachmentId),
          eq(leadNoteAttachments.companyId, companyId),
        ),
      )
      .returning();
    if (row?.fileId) {
      const { deleteFile } = await import("../services/fileUploadService");
      await deleteFile(companyId, row.fileId).catch(() => {});
    }
    return row ?? null;
  }
}

export const leadNoteAttachmentRepository = new LeadNoteAttachmentRepository();
