import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { quoteNoteAttachments, files, quoteNotes } from "@shared/schema";
import { BaseRepository } from "./base";

/**
 * QuoteNoteAttachmentRepository — manages the quote_note↔file join table.
 *
 * 2026-05-02 (Audit #2 PR 3A) — created as part of the canonical-notes
 * consolidation prep work. Mirrors `JobNoteAttachmentRepository`
 * one-for-one so the future `EntityNoteDialog` frontend can route
 * attach / detach through a per-entity repo with identical method
 * signatures. Same defensive checks (tenant isolation + UUID
 * validation + ownership verification) and the same R2 cleanup
 * cascade on detach.
 *
 * No business logic deviates from the job version. Any divergence
 * here would be a bug per the Audit #2 plan.
 */
export class QuoteNoteAttachmentRepository extends BaseRepository {
  /** List all attachments for a quote note with file metadata. */
  async listByNote(companyId: string, noteId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(noteId, "noteId");
    return db
      .select({
        id: quoteNoteAttachments.id,
        noteId: quoteNoteAttachments.noteId,
        fileId: quoteNoteAttachments.fileId,
        createdAt: quoteNoteAttachments.createdAt,
        originalName: files.originalName,
        mimeType: files.mimeType,
        size: files.size,
      })
      .from(quoteNoteAttachments)
      .innerJoin(files, eq(quoteNoteAttachments.fileId, files.id))
      .where(
        and(
          eq(quoteNoteAttachments.noteId, noteId),
          eq(quoteNoteAttachments.companyId, companyId),
        ),
      );
  }

  /** Attach a file to a quote note. Verifies both belong to the tenant. */
  async attach(companyId: string, userId: string, noteId: string, fileId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(noteId, "noteId");
    this.validateUUID(fileId, "fileId");

    // Verify note ownership
    const [note] = await db
      .select({ id: quoteNotes.id })
      .from(quoteNotes)
      .where(and(eq(quoteNotes.id, noteId), eq(quoteNotes.companyId, companyId)))
      .limit(1);
    if (!note) throw this.notFoundError("Quote Note");

    // Verify file ownership
    const [file] = await db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.companyId, companyId)))
      .limit(1);
    if (!file) throw this.notFoundError("File");

    const [row] = await db
      .insert(quoteNoteAttachments)
      .values({ companyId, noteId, fileId, createdBy: userId })
      .returning();
    return row;
  }

  /**
   * Remove a single attachment link. Mirrors the job-note path:
   * detaching is also the trigger to soft-delete the underlying file
   * row and best-effort remove the R2 blob. `deleteFile` is idempotent;
   * a repeat call on a missing / already-deleted file is a no-op.
   */
  async detach(companyId: string, attachmentId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(attachmentId, "attachmentId");
    const [row] = await db
      .delete(quoteNoteAttachments)
      .where(
        and(
          eq(quoteNoteAttachments.id, attachmentId),
          eq(quoteNoteAttachments.companyId, companyId),
        ),
      )
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

export const quoteNoteAttachmentRepository = new QuoteNoteAttachmentRepository();
