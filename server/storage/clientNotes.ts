import { db } from "../db";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { clientNotes, clients, customerCompanies, noteAttachments, users } from "@shared/schema";
import { BaseRepository, clampLimit, clampOffset } from "./base";

/**
 * 2026-04-13 — canonical cleanup helper shared by every client-note
 * delete path. Files are 1:1 with attachments; we must drop the file
 * rows + R2 blobs BEFORE the FK cascade wipes the join rows. Dynamic
 * import keeps the storage ↔ service layering clean.
 */
async function deleteAttachedFilesForNote(companyId: string, noteId: string): Promise<void> {
  const rows = await db
    .select({ fileId: noteAttachments.fileId })
    .from(noteAttachments)
    .where(
      and(
        eq(noteAttachments.noteId, noteId),
        eq(noteAttachments.companyId, companyId),
      ),
    );
  if (rows.length === 0) return;
  const { deleteFile } = await import("../services/fileUploadService");
  for (const row of rows) {
    if (row.fileId) {
      await deleteFile(companyId, row.fileId).catch(() => {});
    }
  }
}

export interface ClientNotesListResult {
  items: any[];
  hasMore: boolean;
  nextOffset?: number;
}

/** Visibility flags accepted on create / update. */
export interface NoteFlags {
  showOnJobs?: boolean;
  showOnInvoices?: boolean;
  showOnQuotes?: boolean;
}

export class ClientNotesRepository extends BaseRepository {
  /**
   * Verify client exists and belongs to company (tenant-scoped)
   */
  async assertClientOwned(companyId: string, clientId: string): Promise<void> {
    this.assertCompanyId(companyId);
    this.validateUUID(clientId, "clientId");

    const [row] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId)))
      .limit(1);

    if (!row) {
      throw this.notFoundError("Client");
    }
  }

  // ─── Location-scoped queries ──────────────────────────────────

  /**
   * List notes for a specific location (locationId must match).
   * Includes notes with attachments metadata when joined at the route layer.
   */
  async listLocationNotes(
    companyId: string,
    locationId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<ClientNotesListResult> {
    this.assertCompanyId(companyId);
    this.validateUUID(locationId, "locationId");

    const limit = clampLimit(options.limit ?? 50, 200);
    const offset = clampOffset(options.offset ?? 0);

    // Join users table to include createdByName
    const rows = await db
      .select({
        note: clientNotes,
        createdByName: users.fullName,
      })
      .from(clientNotes)
      .leftJoin(users, eq(clientNotes.userId, users.id))
      .where(
        and(
          eq(clientNotes.companyId, companyId),
          eq(clientNotes.locationId, locationId)
        )
      )
      .orderBy(desc(clientNotes.createdAt))
      .limit(limit + 1)
      .offset(offset);

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((r) => ({
      ...r.note,
      createdByName: r.createdByName ?? "Unknown",
    }));
    return { items, hasMore, nextOffset: hasMore ? offset + limit : undefined };
  }

  // ─── Company-scoped queries (locationId IS NULL) ──────────────

  /**
   * List company-wide notes (locationId IS NULL).
   */
  async listCompanyNotes(
    companyId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<ClientNotesListResult> {
    this.assertCompanyId(companyId);

    const limit = clampLimit(options.limit ?? 50, 200);
    const offset = clampOffset(options.offset ?? 0);

    // Join users table to include createdByName
    const rows = await db
      .select({
        note: clientNotes,
        createdByName: users.fullName,
      })
      .from(clientNotes)
      .leftJoin(users, eq(clientNotes.userId, users.id))
      .where(
        and(
          eq(clientNotes.companyId, companyId),
          isNull(clientNotes.locationId)
        )
      )
      .orderBy(desc(clientNotes.createdAt))
      .limit(limit + 1)
      .offset(offset);

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((r) => ({
      ...r.note,
      createdByName: r.createdByName ?? "Unknown",
    }));
    return { items, hasMore, nextOffset: hasMore ? offset + limit : undefined };
  }

  // ─── Legacy dual-read queries (back-compat) ───────────────────

  /**
   * List notes for a client/location with pagination (tenant-scoped)
   * DUAL-READ: Reads by locationId OR clientId
   * TODO: [MIGRATION] Once locationId is fully adopted, simplify to locationId only
   */
  async listNotes(
    companyId: string,
    clientId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<ClientNotesListResult> {
    this.assertCompanyId(companyId);
    this.validateUUID(clientId, "clientId");

    const limit = clampLimit(options.limit ?? 50, 200);
    const offset = clampOffset(options.offset ?? 0);

    const notes = await db
      .select()
      .from(clientNotes)
      .where(
        and(
          eq(clientNotes.companyId, companyId),
          or(
            eq(clientNotes.locationId, clientId),
            eq(clientNotes.clientId, clientId)
          )
        )
      )
      .orderBy(desc(clientNotes.createdAt))
      .limit(limit + 1)
      .offset(offset);

    const hasMore = notes.length > limit;
    const items = hasMore ? notes.slice(0, limit) : notes;

    return {
      items,
      hasMore,
      nextOffset: hasMore ? offset + limit : undefined,
    };
  }

  // ─── Duplicate detection ──────────────────────────────────────

  /**
   * Check for duplicate note (within 5-second window)
   * DUAL-READ: Reads by locationId OR clientId
   * TODO: [MIGRATION] Once locationId is fully adopted, simplify to locationId only
   */
  async findRecentDuplicate(
    companyId: string,
    userId: string,
    clientId: string,
    noteText: string
  ): Promise<typeof clientNotes.$inferSelect | null> {
    this.assertCompanyId(companyId);

    const fiveSecondsAgo = new Date(Date.now() - 5000);
    const [duplicate] = await db
      .select()
      .from(clientNotes)
      .where(
        and(
          eq(clientNotes.companyId, companyId),
          eq(clientNotes.userId, userId),
          or(
            eq(clientNotes.locationId, clientId),
            eq(clientNotes.clientId, clientId)
          ),
          eq(clientNotes.noteText, noteText),
          sql`${clientNotes.createdAt} > ${fiveSecondsAgo}`
        )
      )
      .limit(1);

    return duplicate ?? null;
  }

  // ─── Create ───────────────────────────────────────────────────

  /**
   * Create a location-scoped note with optional visibility flags.
   * DUAL-WRITE: Writes both locationId AND clientId for back-compat.
   * TODO: [MIGRATION] Once locationId is fully adopted, remove clientId write
   */
  async createNote(
    companyId: string,
    userId: string,
    clientId: string,
    noteText: string,
    flags: NoteFlags = {}
  ): Promise<typeof clientNotes.$inferSelect> {
    this.assertCompanyId(companyId);
    this.validateUUID(clientId, "clientId");

    const [created] = await db
      .insert(clientNotes)
      .values({
        companyId,
        userId,
        clientId,
        noteText,
        locationId: clientId, // DUAL-WRITE
        showOnJobs: flags.showOnJobs ?? false,
        showOnInvoices: flags.showOnInvoices ?? false,
        showOnQuotes: flags.showOnQuotes ?? false,
      })
      .returning();

    return created;
  }

  /**
   * Create a company-wide note (locationId = NULL).
   */
  async createCompanyNote(
    companyId: string,
    userId: string,
    noteText: string,
    flags: NoteFlags = {}
  ): Promise<typeof clientNotes.$inferSelect> {
    this.assertCompanyId(companyId);

    const [created] = await db
      .insert(clientNotes)
      .values({
        companyId,
        userId,
        noteText,
        locationId: null,
        clientId: null,
        showOnJobs: flags.showOnJobs ?? false,
        showOnInvoices: flags.showOnInvoices ?? false,
        showOnQuotes: flags.showOnQuotes ?? false,
      })
      .returning();

    return created;
  }

  // ─── Update ───────────────────────────────────────────────────

  /**
   * Update note text and/or visibility flags (tenant-scoped).
   * DUAL-READ: Finds by locationId OR clientId
   * TODO: [MIGRATION] Once locationId is fully adopted, simplify to locationId only
   */
  async updateNote(
    companyId: string,
    clientId: string,
    noteId: string,
    noteText: string,
    flags: NoteFlags = {}
  ): Promise<typeof clientNotes.$inferSelect | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(clientId, "clientId");
    this.validateUUID(noteId, "noteId");

    const setFields: Record<string, any> = { noteText };
    if (flags.showOnJobs !== undefined) setFields.showOnJobs = flags.showOnJobs;
    if (flags.showOnInvoices !== undefined) setFields.showOnInvoices = flags.showOnInvoices;
    if (flags.showOnQuotes !== undefined) setFields.showOnQuotes = flags.showOnQuotes;

    const [updated] = await db
      .update(clientNotes)
      .set(setFields)
      .where(
        and(
          eq(clientNotes.id, noteId),
          eq(clientNotes.companyId, companyId),
          or(
            eq(clientNotes.locationId, clientId),
            eq(clientNotes.clientId, clientId)
          )
        )
      )
      .returning();

    return updated ?? null;
  }

  /**
   * Update a company-wide note (locationId IS NULL).
   */
  async updateCompanyNote(
    companyId: string,
    noteId: string,
    noteText: string,
    flags: NoteFlags = {}
  ): Promise<typeof clientNotes.$inferSelect | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(noteId, "noteId");

    const setFields: Record<string, any> = { noteText };
    if (flags.showOnJobs !== undefined) setFields.showOnJobs = flags.showOnJobs;
    if (flags.showOnInvoices !== undefined) setFields.showOnInvoices = flags.showOnInvoices;
    if (flags.showOnQuotes !== undefined) setFields.showOnQuotes = flags.showOnQuotes;

    const [updated] = await db
      .update(clientNotes)
      .set(setFields)
      .where(
        and(
          eq(clientNotes.id, noteId),
          eq(clientNotes.companyId, companyId),
          isNull(clientNotes.locationId)
        )
      )
      .returning();

    return updated ?? null;
  }

  // ─── Delete ───────────────────────────────────────────────────

  /**
   * Delete note (hard delete, tenant-scoped)
   * DUAL-DELETE: Finds by locationId OR clientId
   * TODO: [MIGRATION] Once locationId is fully adopted, simplify to locationId only
   */
  async deleteNote(
    companyId: string,
    clientId: string,
    noteId: string
  ): Promise<typeof clientNotes.$inferSelect | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(clientId, "clientId");
    this.validateUUID(noteId, "noteId");

    // 2026-04-13 — cascade file cleanup before FK drops the join rows.
    await deleteAttachedFilesForNote(companyId, noteId);

    const [deleted] = await db
      .delete(clientNotes)
      .where(
        and(
          eq(clientNotes.id, noteId),
          eq(clientNotes.companyId, companyId),
          or(
            eq(clientNotes.locationId, clientId),
            eq(clientNotes.clientId, clientId)
          )
        )
      )
      .returning();

    return deleted ?? null;
  }

  /**
   * Delete a company-wide note (locationId IS NULL).
   */
  async deleteCompanyNote(
    companyId: string,
    noteId: string
  ): Promise<typeof clientNotes.$inferSelect | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(noteId, "noteId");

    await deleteAttachedFilesForNote(companyId, noteId);

    const [deleted] = await db
      .delete(clientNotes)
      .where(
        and(
          eq(clientNotes.id, noteId),
          eq(clientNotes.companyId, companyId),
          isNull(clientNotes.locationId)
        )
      )
      .returning();

    return deleted ?? null;
  }

  // ─── Customer-company-scoped queries ───────────────────────────

  /**
   * Verify customer company exists and belongs to tenant.
   */
  async assertCustomerCompanyOwned(companyId: string, customerCompanyId: string): Promise<void> {
    this.assertCompanyId(companyId);
    this.validateUUID(customerCompanyId, "customerCompanyId");

    const [row] = await db
      .select({ id: customerCompanies.id })
      .from(customerCompanies)
      .where(and(eq(customerCompanies.id, customerCompanyId), eq(customerCompanies.companyId, companyId)))
      .limit(1);

    if (!row) throw this.notFoundError("Customer company");
  }

  /**
   * List notes scoped to a customer company (customerCompanyId set, locationId IS NULL).
   * Joins users table for createdByName.
   */
  async listCustomerCompanyNotes(
    companyId: string,
    customerCompanyId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<ClientNotesListResult> {
    this.assertCompanyId(companyId);
    this.validateUUID(customerCompanyId, "customerCompanyId");

    const limit = clampLimit(options.limit ?? 50, 200);
    const offset = clampOffset(options.offset ?? 0);

    const rows = await db
      .select({ note: clientNotes, createdByName: users.fullName })
      .from(clientNotes)
      .leftJoin(users, eq(clientNotes.userId, users.id))
      .where(
        and(
          eq(clientNotes.companyId, companyId),
          eq(clientNotes.customerCompanyId, customerCompanyId)
        )
      )
      .orderBy(desc(clientNotes.createdAt))
      .limit(limit + 1)
      .offset(offset);

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((r) => ({
      ...r.note,
      createdByName: r.createdByName ?? "Unknown",
    }));
    return { items, hasMore, nextOffset: hasMore ? offset + limit : undefined };
  }

  /**
   * Dedupe check for customer-company notes (5-second window).
   */
  async findRecentDuplicateForCustomerCompany(
    companyId: string,
    userId: string,
    customerCompanyId: string,
    noteText: string
  ): Promise<typeof clientNotes.$inferSelect | null> {
    this.assertCompanyId(companyId);
    const fiveSecondsAgo = new Date(Date.now() - 5000);
    const [dup] = await db
      .select()
      .from(clientNotes)
      .where(
        and(
          eq(clientNotes.companyId, companyId),
          eq(clientNotes.userId, userId),
          eq(clientNotes.customerCompanyId, customerCompanyId),
          eq(clientNotes.noteText, noteText),
          sql`${clientNotes.createdAt} > ${fiveSecondsAgo}`
        )
      )
      .limit(1);
    return dup ?? null;
  }

  /**
   * Create a customer-company-level note (locationId = NULL, customerCompanyId set).
   */
  async createCustomerCompanyNote(
    companyId: string,
    userId: string,
    customerCompanyId: string,
    noteText: string,
    flags: NoteFlags = {}
  ): Promise<typeof clientNotes.$inferSelect> {
    this.assertCompanyId(companyId);
    this.validateUUID(customerCompanyId, "customerCompanyId");

    const [created] = await db
      .insert(clientNotes)
      .values({
        companyId,
        userId,
        customerCompanyId,
        locationId: null,
        clientId: null,
        noteText,
        showOnJobs: flags.showOnJobs ?? false,
        showOnInvoices: flags.showOnInvoices ?? false,
        showOnQuotes: flags.showOnQuotes ?? false,
      })
      .returning();
    return created;
  }

  /**
   * Update a customer-company-level note.
   */
  async updateCustomerCompanyNote(
    companyId: string,
    customerCompanyId: string,
    noteId: string,
    noteText: string,
    flags: NoteFlags = {}
  ): Promise<typeof clientNotes.$inferSelect | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(customerCompanyId, "customerCompanyId");
    this.validateUUID(noteId, "noteId");

    const setFields: Record<string, any> = { noteText };
    if (flags.showOnJobs !== undefined) setFields.showOnJobs = flags.showOnJobs;
    if (flags.showOnInvoices !== undefined) setFields.showOnInvoices = flags.showOnInvoices;
    if (flags.showOnQuotes !== undefined) setFields.showOnQuotes = flags.showOnQuotes;

    const [updated] = await db
      .update(clientNotes)
      .set(setFields)
      .where(
        and(
          eq(clientNotes.id, noteId),
          eq(clientNotes.companyId, companyId),
          eq(clientNotes.customerCompanyId, customerCompanyId)
        )
      )
      .returning();
    return updated ?? null;
  }

  /**
   * Delete a customer-company-level note.
   */
  async deleteCustomerCompanyNote(
    companyId: string,
    customerCompanyId: string,
    noteId: string
  ): Promise<typeof clientNotes.$inferSelect | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(customerCompanyId, "customerCompanyId");
    this.validateUUID(noteId, "noteId");

    await deleteAttachedFilesForNote(companyId, noteId);

    const [deleted] = await db
      .delete(clientNotes)
      .where(
        and(
          eq(clientNotes.id, noteId),
          eq(clientNotes.companyId, companyId),
          eq(clientNotes.customerCompanyId, customerCompanyId)
        )
      )
      .returning();
    return deleted ?? null;
  }
}

export const clientNotesRepository = new ClientNotesRepository();
