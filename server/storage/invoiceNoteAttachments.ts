import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { invoiceNoteAttachments, files, invoiceNotes } from "@shared/schema";
import { BaseRepository } from "./base";

/**
 * InvoiceNoteAttachmentRepository — manages the invoice_note↔file join table.
 *
 * 2026-05-03: direct port of `JobNoteAttachmentRepository`. Same shape,
 * same idempotent attach + detach + R2-cleanup-on-detach behavior. The
 * fileUploadService adapter for `invoice_note` uses this repo's
 * `attach` (via inline ensureAttachment) so the upload pipeline binds
 * files exactly as it does for job notes.
 */
export class InvoiceNoteAttachmentRepository extends BaseRepository {
  /** List all attachments for an invoice note with file metadata. */
  async listByNote(companyId: string, noteId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(noteId, "noteId");
    return db
      .select({
        id: invoiceNoteAttachments.id,
        noteId: invoiceNoteAttachments.noteId,
        fileId: invoiceNoteAttachments.fileId,
        createdAt: invoiceNoteAttachments.createdAt,
        originalName: files.originalName,
        mimeType: files.mimeType,
        size: files.size,
      })
      .from(invoiceNoteAttachments)
      .innerJoin(files, eq(invoiceNoteAttachments.fileId, files.id))
      .where(
        and(eq(invoiceNoteAttachments.noteId, noteId), eq(invoiceNoteAttachments.companyId, companyId)),
      );
  }

  /** Attach a file to an invoice note. Verifies both belong to tenant. */
  async attach(companyId: string, userId: string, noteId: string, fileId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(noteId, "noteId");
    this.validateUUID(fileId, "fileId");

    // Verify note ownership
    const [note] = await db
      .select({ id: invoiceNotes.id })
      .from(invoiceNotes)
      .where(and(eq(invoiceNotes.id, noteId), eq(invoiceNotes.companyId, companyId)))
      .limit(1);
    if (!note) throw this.notFoundError("Invoice Note");

    // Verify file ownership
    const [file] = await db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.companyId, companyId)))
      .limit(1);
    if (!file) throw this.notFoundError("File");

    const [row] = await db
      .insert(invoiceNoteAttachments)
      .values({ companyId, noteId, fileId, createdBy: userId })
      .returning();
    return row;
  }

  /**
   * Remove a single attachment link. Files are 1:1 with attachments —
   * detaching also triggers a soft-delete of the underlying file row +
   * best-effort R2 blob removal (mirrors `JobNoteAttachmentRepository.detach`).
   * `deleteFile` is idempotent; repeated calls on missing files are no-ops.
   */
  async detach(companyId: string, attachmentId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(attachmentId, "attachmentId");
    const [row] = await db
      .delete(invoiceNoteAttachments)
      .where(and(eq(invoiceNoteAttachments.id, attachmentId), eq(invoiceNoteAttachments.companyId, companyId)))
      .returning();
    if (row?.fileId) {
      const { deleteFile } = await import("../services/fileUploadService");
      await deleteFile(companyId, row.fileId).catch(() => {});
    }
    return row ?? null;
  }
}

export const invoiceNoteAttachmentRepository = new InvoiceNoteAttachmentRepository();
