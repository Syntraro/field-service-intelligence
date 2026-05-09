/**
 * Lead Repository — CRUD storage for leads table.
 * Follows the same repository pattern as quotes.ts and jobs.ts.
 */
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { leads, leadNotes, clientLocations, customerCompanies, type InsertLead, type UpdateLead } from "@shared/schema";
import { locationDisplayNameExpr } from "../lib/queryHelpers";

/** Lead row enriched with joined location display fields — returned by listLeads. */
export type LeadListItem = typeof leads.$inferSelect & {
  locationDisplayName: string | null;
  locationSiteName: string | null;
  locationCity: string | null;
};

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

  async listLeads(companyId: string, filters?: { status?: string }): Promise<LeadListItem[]> {
    assertCompanyId(companyId);
    const conditions = [eq(leads.companyId, companyId), eq(leads.isActive, true)];
    if (filters?.status) {
      conditions.push(eq(leads.status, filters.status));
    }
    const rows = await db
      .select({
        id: leads.id,
        companyId: leads.companyId,
        locationId: leads.locationId,
        customerCompanyId: leads.customerCompanyId,
        createdByUserId: leads.createdByUserId,
        originTechnicianId: leads.originTechnicianId,
        assignedToUserId: leads.assignedToUserId,
        sourceType: leads.sourceType,
        sourceRefType: leads.sourceRefType,
        sourceRefId: leads.sourceRefId,
        status: leads.status,
        priority: leads.priority,
        title: leads.title,
        description: leads.description,
        estimatedValue: leads.estimatedValue,
        convertedQuoteId: leads.convertedQuoteId,
        convertedAt: leads.convertedAt,
        isActive: leads.isActive,
        version: leads.version,
        createdAt: leads.createdAt,
        updatedAt: leads.updatedAt,
        locationDisplayName: locationDisplayNameExpr,
        locationSiteName: clientLocations.location,
        locationCity: clientLocations.city,
      })
      .from(leads)
      .leftJoin(clientLocations, eq(leads.locationId, clientLocations.id))
      .leftJoin(customerCompanies, eq(clientLocations.parentCompanyId, customerCompanies.id))
      .where(and(...conditions))
      .orderBy(desc(leads.createdAt));
    return rows as unknown as LeadListItem[];
  },

  /**
   * 2026-05-06 RALPH: actionable Pipeline drill-down rows.
   *
   * Predicates mirror the dashboard's `getPipelineSnapshot` aggregate
   * (`server/storage/dashboard.ts`) so the card's bucket counts and the
   * modal's drill-down list stay in lockstep.
   *
   *   followup → leads with status IN (new, contacted, needs_review).
   *              No time threshold — surfaces the full early-pipeline
   *              backlog the user can act on.
   *
   *   stale    → same status set + last activity older than `staleDays`
   *              (default 14). `COALESCE(updated_at, created_at)` is the
   *              activity timestamp, matching the dashboard SQL.
   *
   * Both buckets exclude lost / quoted / won by definition (those rows
   * never enter the status-set above).
   */
  async listPipelineBucket(
    companyId: string,
    bucket: "followup" | "stale",
    staleDays: number = 14,
  ): Promise<(typeof leads.$inferSelect)[]> {
    assertCompanyId(companyId);
    const openStatuses = ["new", "contacted", "needs_review"];
    const conditions = [
      eq(leads.companyId, companyId),
      eq(leads.isActive, true),
      inArray(leads.status, openStatuses),
    ];
    if (bucket === "stale") {
      conditions.push(sql`COALESCE(${leads.updatedAt}, ${leads.createdAt}) < NOW() - (${staleDays} || ' days')::interval`);
    }
    return db
      .select()
      .from(leads)
      .where(and(...conditions))
      .orderBy(desc(sql`COALESCE(${leads.updatedAt}, ${leads.createdAt})`))
      .limit(50);
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
