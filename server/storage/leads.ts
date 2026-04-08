/**
 * Lead Repository — CRUD storage for leads table.
 * Follows the same repository pattern as quotes.ts and jobs.ts.
 */
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../db";
import { leads, leadNotes, type InsertLead, type UpdateLead } from "@shared/schema";

function assertCompanyId(companyId: string) {
  if (!companyId) throw new Error("companyId is required");
}

export const leadRepository = {
  async createLead(companyId: string, data: Omit<InsertLead, "companyId">): Promise<typeof leads.$inferSelect> {
    assertCompanyId(companyId);
    const [lead] = await db
      .insert(leads)
      .values({ ...data, companyId })
      .returning();
    return lead;
  },

  async getLead(companyId: string, leadId: string): Promise<typeof leads.$inferSelect | undefined> {
    assertCompanyId(companyId);
    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.companyId, companyId), eq(leads.isActive, true)));
    return lead;
  },

  async listLeads(companyId: string, filters?: { status?: string }): Promise<(typeof leads.$inferSelect)[]> {
    assertCompanyId(companyId);
    const conditions = [eq(leads.companyId, companyId), eq(leads.isActive, true)];
    if (filters?.status) {
      conditions.push(eq(leads.status, filters.status));
    }
    return db
      .select()
      .from(leads)
      .where(and(...conditions))
      .orderBy(desc(leads.createdAt));
  },

  async updateLead(companyId: string, leadId: string, data: UpdateLead & { convertedQuoteId?: string; convertedAt?: Date }): Promise<typeof leads.$inferSelect | undefined> {
    assertCompanyId(companyId);
    // Hardening: originTechnicianId is write-once at creation, immutable forever.
    // Strip it from update payload even if caller passes it, to prevent silent corruption.
    const { originTechnicianId: _stripped, ...safeData } = data as any;
    const [updated] = await db
      .update(leads)
      .set({ ...safeData, updatedAt: new Date() })
      .where(and(eq(leads.id, leadId), eq(leads.companyId, companyId), eq(leads.isActive, true)))
      .returning();
    return updated;
  },

  /** Soft-delete (archive) a lead. Reversible via restoreLead. */
  async archiveLead(companyId: string, leadId: string) {
    assertCompanyId(companyId);
    await db.update(leads).set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(leads.id, leadId), eq(leads.companyId, companyId)));
  },

  /** Restore a soft-deleted lead. */
  async restoreLead(companyId: string, leadId: string) {
    assertCompanyId(companyId);
    const [restored] = await db.update(leads).set({ isActive: true, updatedAt: new Date() })
      .where(and(eq(leads.id, leadId), eq(leads.companyId, companyId), eq(leads.isActive, false)))
      .returning();
    return restored;
  },

  /**
   * Hard-delete a lead (permanently destroys row + cascade-deletes lead notes).
   * Irreversible. Use archiveLead() for reversible removal.
   */
  async hardDeleteLead(companyId: string, leadId: string) {
    assertCompanyId(companyId);
    const deleted = await db.delete(leads)
      .where(and(eq(leads.id, leadId), eq(leads.companyId, companyId)))
      .returning({ id: leads.id });
    return deleted.length > 0;
  },

  /** Create a note on a lead. */
  async createNote(companyId: string, leadId: string, userId: string, noteText: string) {
    assertCompanyId(companyId);
    const [note] = await db.insert(leadNotes).values({
      companyId, leadId, userId, noteText,
    }).returning();
    return note;
  },

  /** Update a note's text. Only the note's author may edit (caller enforces). */
  async updateNote(companyId: string, noteId: string, noteText: string) {
    assertCompanyId(companyId);
    const [updated] = await db.update(leadNotes)
      .set({ noteText, updatedAt: new Date() })
      .where(and(eq(leadNotes.id, noteId), eq(leadNotes.companyId, companyId)))
      .returning();
    return updated;
  },

  /** Get a single note (for ownership/existence checks). */
  async getNote(companyId: string, noteId: string) {
    assertCompanyId(companyId);
    const [note] = await db.select().from(leadNotes)
      .where(and(eq(leadNotes.id, noteId), eq(leadNotes.companyId, companyId)))
      .limit(1);
    return note;
  },

  /** Delete a note from a lead. */
  async deleteNote(companyId: string, noteId: string) {
    assertCompanyId(companyId);
    const deleted = await db.delete(leadNotes)
      .where(and(eq(leadNotes.id, noteId), eq(leadNotes.companyId, companyId)))
      .returning();
    return deleted.length > 0;
  },
};
