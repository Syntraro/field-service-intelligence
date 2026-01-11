import { db } from "../db";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { clientNotes, clients } from "@shared/schema";
import { BaseRepository, clampLimit, clampOffset } from "./base";

export interface ClientNotesListResult {
  items: any[];
  hasMore: boolean;
  nextOffset?: number;
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

  /**
   * Create note (tenant-scoped)
   * DUAL-WRITE: Writes both locationId AND clientId
   * TODO: [MIGRATION] Once locationId is fully adopted, remove clientId write
   */
  async createNote(
    companyId: string,
    userId: string,
    clientId: string,
    noteText: string
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
      })
      .returning();

    return created;
  }

  /**
   * Update note (tenant-scoped)
   * DUAL-READ: Finds by locationId OR clientId
   * TODO: [MIGRATION] Once locationId is fully adopted, simplify to locationId only
   */
  async updateNote(
    companyId: string,
    clientId: string,
    noteId: string,
    noteText: string
  ): Promise<typeof clientNotes.$inferSelect | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(clientId, "clientId");
    this.validateUUID(noteId, "noteId");

    const [updated] = await db
      .update(clientNotes)
      .set({ noteText })
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
}

export const clientNotesRepository = new ClientNotesRepository();
