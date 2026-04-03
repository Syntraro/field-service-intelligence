/**
 * Lead Repository — CRUD storage for leads table.
 * Follows the same repository pattern as quotes.ts and jobs.ts.
 */
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../db";
import { leads, type InsertLead, type UpdateLead } from "@shared/schema";

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
};
