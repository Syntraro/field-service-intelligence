/**
 * PM Billing Repository — data access for PM billing events.
 *
 * Owns all reads/writes to the pmBillingEvents table and related contract queries.
 * Orchestration/business logic stays in services/pmBillingService.ts.
 *
 * 2026-04-08: Extracted from pmBillingService.ts to enforce Route→Service→Storage.
 */

import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import {
  recurringJobTemplates,
  pmBillingEvents,
  clients,
} from "@shared/schema";

export const pmBillingRepository = {
  /**
   * Find an existing billing event for a contract+period (idempotency check).
   */
  async findEventByContractPeriod(contractId: string, periodStart: string) {
    const [existing] = await db
      .select({ id: pmBillingEvents.id })
      .from(pmBillingEvents)
      .where(and(
        eq(pmBillingEvents.pmContractId, contractId),
        eq(pmBillingEvents.periodStart, periodStart),
      ))
      .limit(1);
    return existing ?? null;
  },

  /**
   * Create a new billing event. Returns the created event.
   */
  async createEvent(values: {
    companyId: string;
    pmContractId: string;
    billingModelSnapshot: string;
    periodStart: string;
    periodEnd: string;
    billingDate: string;
    status: string;
    amountSnapshot: string | null;
    billingLabelSnapshot: string;
  }) {
    const [event] = await db
      .insert(pmBillingEvents)
      .values(values)
      .returning();
    return event;
  },

  /**
   * Update a billing event's status and optional fields.
   */
  async updateEventStatus(
    eventId: string,
    status: string,
    extra?: { notes?: string; invoiceId?: string }
  ) {
    await db
      .update(pmBillingEvents)
      .set({
        status,
        ...(extra?.notes !== undefined ? { notes: extra.notes } : {}),
        ...(extra?.invoiceId !== undefined ? { invoiceId: extra.invoiceId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(pmBillingEvents.id, eventId));
  },

  /**
   * Get a pending billing event by ID (for invoice creation).
   */
  async getPendingEvent(eventId: string) {
    const [event] = await db
      .select()
      .from(pmBillingEvents)
      .where(and(eq(pmBillingEvents.id, eventId), eq(pmBillingEvents.status, "pending")))
      .limit(1);
    return event ?? null;
  },

  /**
   * Resolve customer company for a location.
   */
  async resolveLocationCustomerCompany(locationId: string): Promise<string | null> {
    const [location] = await db
      .select({ parentCompanyId: clients.parentCompanyId })
      .from(clients)
      .where(eq(clients.id, locationId))
      .limit(1);
    return location?.parentCompanyId ?? null;
  },

  /**
   * Skip a pending billing event.
   */
  async skipEvent(eventId: string, companyId: string, reason?: string) {
    await db
      .update(pmBillingEvents)
      .set({
        status: "skipped",
        notes: reason ?? "Manually skipped",
        updatedAt: new Date(),
      })
      .where(and(
        eq(pmBillingEvents.id, eventId),
        eq(pmBillingEvents.companyId, companyId),
        eq(pmBillingEvents.status, "pending"),
      ));
  },

  /**
   * Get all billing events for a PM contract (for detail page).
   */
  async getEventsForContract(companyId: string, contractId: string) {
    return db
      .select()
      .from(pmBillingEvents)
      .where(and(
        eq(pmBillingEvents.companyId, companyId),
        eq(pmBillingEvents.pmContractId, contractId),
      ))
      .orderBy(sql`${pmBillingEvents.periodStart} DESC`);
  },

  /**
   * Get all billing events for a company with contract info (for oversight tab).
   */
  async getEventsForCompany(companyId: string) {
    return db
      .select({
        event: pmBillingEvents,
        contractTitle: recurringJobTemplates.title,
        contractLocationId: recurringJobTemplates.locationId,
        contractClientId: recurringJobTemplates.clientId,
      })
      .from(pmBillingEvents)
      .leftJoin(recurringJobTemplates, eq(pmBillingEvents.pmContractId, recurringJobTemplates.id))
      .where(eq(pmBillingEvents.companyId, companyId))
      .orderBy(sql`${pmBillingEvents.periodStart} DESC`);
  },

  /**
   * Find all active contracts with contract-based billing models.
   */
  async getActiveContractBilledTemplates(companyId?: string) {
    const conditions = [
      eq(recurringJobTemplates.isActive, true),
      sql`${recurringJobTemplates.pmBillingModel} IN ('monthly_fixed', 'annual_prepaid')`,
    ];
    if (companyId) {
      conditions.push(eq(recurringJobTemplates.companyId, companyId));
    }
    return db
      .select()
      .from(recurringJobTemplates)
      .where(and(...conditions));
  },
};
