import { db } from "../db";
import { and, eq, desc, inArray } from "drizzle-orm";
import { invoiceNotes, invoices, users, invoiceNoteAttachments, files } from "@shared/schema";
import { BaseRepository, clampLimit } from "./base";
import { resolveTechnicianName } from "../lib/resolveTechnicianName";

/**
 * Invoice Notes repository — handles all invoice note database operations.
 *
 * 2026-05-03: introduced as the canonical first-class invoice notes
 * surface. Previously the invoice detail page borrowed entity-owned
 * notes from the linked job (when present) and fell back to the flat
 * `invoices.notes_internal` column otherwise — neither path supported
 * attachments cleanly nor worked for no-job invoices.
 *
 * This repository is a direct port of `JobNotesRepository` minus the
 * equipment-linkage validation (invoices don't carry equipment context).
 * Same tenant-isolation guard, same listing shape with attachment
 * hydration in one extra query, same author-only edit/delete rule. The
 * frontend EntityNotesSection / EntityNoteDialog point at the matching
 * invoice route family with no other special-casing.
 */
export class InvoiceNotesRepository extends BaseRepository {
  /**
   * List notes for an invoice. Throws 404 if the invoice doesn't exist
   * or doesn't belong to the company. Hydrates attachments in a single
   * additional query (matches `JobNotesRepository.listJobNotes`).
   */
  async listInvoiceNotes(companyId: string, invoiceId: string, limit = 100) {
    this.assertCompanyId(companyId);
    this.validateUUID(invoiceId, "invoiceId");
    const safeLimit = clampLimit(limit, 500);

    // Verify invoice exists and belongs to company. Soft-deletion isn't a
    // concept on invoices today (delete is a hard-delete with strict
    // eligibility), so a simple companyId+id check is sufficient.
    const [invoice] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));

    if (!invoice) {
      throw this.notFoundError("Invoice");
    }

    // Get notes with author user info.
    const rows = await db
      .select({
        id: invoiceNotes.id,
        invoiceId: invoiceNotes.invoiceId,
        noteText: invoiceNotes.noteText,
        createdAt: invoiceNotes.createdAt,
        updatedAt: invoiceNotes.updatedAt,
        user: {
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(invoiceNotes)
      .leftJoin(users, eq(invoiceNotes.userId, users.id))
      .where(and(eq(invoiceNotes.companyId, companyId), eq(invoiceNotes.invoiceId, invoiceId)))
      .orderBy(desc(invoiceNotes.createdAt))
      .limit(safeLimit);

    // Load attachments for all notes in one query — exact mirror of the
    // job-notes hydration pattern. Status filter ensures pending /
    // failed / soft-deleted file rows never surface in the listing.
    const noteIds = rows.map((r) => r.id);
    const allAttachments = noteIds.length > 0
      ? await db
          .select({
            id: invoiceNoteAttachments.id,
            noteId: invoiceNoteAttachments.noteId,
            fileId: invoiceNoteAttachments.fileId,
            originalName: files.originalName,
            mimeType: files.mimeType,
            size: files.size,
            storageProvider: files.storageProvider,
            status: files.status,
          })
          .from(invoiceNoteAttachments)
          .innerJoin(files, eq(invoiceNoteAttachments.fileId, files.id))
          .where(and(
            eq(invoiceNoteAttachments.companyId, companyId),
            inArray(invoiceNoteAttachments.noteId, noteIds),
            eq(files.status, "uploaded"),
          ))
      : [];

    const attachmentsByNote = new Map<string, typeof allAttachments>();
    for (const att of allAttachments) {
      const list = attachmentsByNote.get(att.noteId) ?? [];
      list.push(att);
      attachmentsByNote.set(att.noteId, list);
    }

    return rows.map((row) => ({
      ...row,
      userName: row.user ? resolveTechnicianName(row.user) : "Unknown",
      attachments: attachmentsByNote.get(row.id) ?? [],
    }));
  }

  /** Create an invoice note. */
  async createInvoiceNote(
    companyId: string,
    invoiceId: string,
    userId: string,
    noteText: string,
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(invoiceId, "invoiceId");
    this.validateUUID(userId, "userId");

    // Verify invoice exists and belongs to company.
    const [invoice] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));

    if (!invoice) {
      throw this.notFoundError("Invoice");
    }

    const [note] = await db
      .insert(invoiceNotes)
      .values({
        companyId,
        invoiceId,
        userId,
        noteText,
      })
      .returning();

    // Return with hydrated author info — same shape as listInvoiceNotes.
    const [noteWithUser] = await db
      .select({
        id: invoiceNotes.id,
        invoiceId: invoiceNotes.invoiceId,
        noteText: invoiceNotes.noteText,
        createdAt: invoiceNotes.createdAt,
        updatedAt: invoiceNotes.updatedAt,
        user: {
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(invoiceNotes)
      .leftJoin(users, eq(invoiceNotes.userId, users.id))
      .where(eq(invoiceNotes.id, note.id));

    return noteWithUser;
  }

  /**
   * Update an invoice note. Only the author can update their own notes —
   * matches the job-notes contract.
   */
  async updateInvoiceNote(
    companyId: string,
    noteId: string,
    userId: string,
    noteText: string,
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(noteId, "noteId");
    this.validateUUID(userId, "userId");

    const [existing] = await db
      .select()
      .from(invoiceNotes)
      .where(
        and(
          eq(invoiceNotes.id, noteId),
          eq(invoiceNotes.companyId, companyId),
          eq(invoiceNotes.userId, userId),
        ),
      );

    if (!existing) {
      throw this.notFoundError("Note");
    }

    const [updated] = await db
      .update(invoiceNotes)
      .set({
        noteText,
        updatedAt: new Date(),
      })
      .where(eq(invoiceNotes.id, noteId))
      .returning();

    const [noteWithUser] = await db
      .select({
        id: invoiceNotes.id,
        invoiceId: invoiceNotes.invoiceId,
        noteText: invoiceNotes.noteText,
        createdAt: invoiceNotes.createdAt,
        updatedAt: invoiceNotes.updatedAt,
        user: {
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(invoiceNotes)
      .leftJoin(users, eq(invoiceNotes.userId, users.id))
      .where(eq(invoiceNotes.id, updated.id));

    return noteWithUser;
  }

  /**
   * Delete an invoice note (hard delete). Only the author can delete
   * their own notes. Cascades attachment cleanup the same way the job-
   * notes repo does: snapshot the attached fileIds before the FK
   * cascade wipes the join rows, then call `deleteFile` on each so the
   * R2 blob + file row both go away (best-effort; idempotent).
   */
  async deleteInvoiceNote(companyId: string, noteId: string, userId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(noteId, "noteId");
    this.validateUUID(userId, "userId");

    const [existing] = await db
      .select()
      .from(invoiceNotes)
      .where(
        and(
          eq(invoiceNotes.id, noteId),
          eq(invoiceNotes.companyId, companyId),
          eq(invoiceNotes.userId, userId),
        ),
      );

    if (!existing) {
      throw this.notFoundError("Note");
    }

    const attachedFiles = await db
      .select({ fileId: invoiceNoteAttachments.fileId })
      .from(invoiceNoteAttachments)
      .where(
        and(
          eq(invoiceNoteAttachments.noteId, noteId),
          eq(invoiceNoteAttachments.companyId, companyId),
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

    await db.delete(invoiceNotes).where(eq(invoiceNotes.id, noteId));

    return { success: true };
  }
}

export const invoiceNotesRepository = new InvoiceNotesRepository();
