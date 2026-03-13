/**
 * PM Billing Service — Contract-period billing event engine
 *
 * PM Billing Phase 2: Creates billing events and invoices for
 * monthly_fixed and annual_prepaid PM contracts.
 *
 * Key behaviors:
 * - Idempotent: duplicate events prevented by unique index (pm_contract_id, period_start)
 * - Safe: invoice creation uses authorized PM_BILLING_SERVICE source
 * - Observable: all events logged and traceable
 *
 * Schedule: runs alongside PM auto-generation (startup + every 6 hours)
 */

import { db } from "../db";
import { eq, and, sql, isNull } from "drizzle-orm";
import {
  recurringJobTemplates,
  pmBillingEvents,
  clients,
  type RecurringJobTemplate,
} from "@shared/schema";
import { invoiceRepository } from "../storage/invoices";

// ============================================================================
// Types
// ============================================================================

interface BillingRunResult {
  companiesProcessed: number;
  eventsCreated: number;
  invoicesCreated: number;
  errors: string[];
}

interface ContractBillingResult {
  eventsCreated: number;
  invoicesCreated: number;
  errors: string[];
}

// ============================================================================
// Period computation helpers
// ============================================================================

/** Get the billing period for a monthly_fixed contract for a given reference date */
function getMonthlyPeriod(refDate: Date): { periodStart: string; periodEnd: string; billingDate: string } {
  const year = refDate.getFullYear();
  const month = refDate.getMonth(); // 0-based
  const periodStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  // Last day of month
  const lastDay = new Date(year, month + 1, 0).getDate();
  const periodEnd = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  // Billing date = 1st of the month
  const billingDate = periodStart;
  return { periodStart, periodEnd, billingDate };
}

/** Get the billing period for an annual_prepaid contract based on contract start date */
function getAnnualPeriod(contractStartDate: string, refDate: Date): { periodStart: string; periodEnd: string; billingDate: string } | null {
  const start = new Date(contractStartDate + "T00:00:00");
  const startMonth = start.getMonth(); // 0-based
  const startDay = start.getDate();

  // Find the most recent anniversary date on or before refDate
  let anniversaryYear = refDate.getFullYear();
  let anniversaryDate = new Date(anniversaryYear, startMonth, startDay);

  // If anniversary is in the future, go back one year
  if (anniversaryDate > refDate) {
    anniversaryYear--;
    anniversaryDate = new Date(anniversaryYear, startMonth, startDay);
  }

  // The period runs from anniversary to anniversary - 1 day next year
  const periodStart = anniversaryDate.toISOString().split("T")[0];
  const periodEndDate = new Date(anniversaryYear + 1, startMonth, startDay);
  periodEndDate.setDate(periodEndDate.getDate() - 1);
  const periodEnd = periodEndDate.toISOString().split("T")[0];
  const billingDate = periodStart;

  return { periodStart, periodEnd, billingDate };
}

// ============================================================================
// Core billing event engine
// ============================================================================

/**
 * Process billing events for a single PM contract.
 * Creates missing billing events for the current period and generates invoices.
 */
async function processContractBilling(
  contract: RecurringJobTemplate
): Promise<ContractBillingResult> {
  const result: ContractBillingResult = { eventsCreated: 0, invoicesCreated: 0, errors: [] };
  const now = new Date();

  if (!contract.pmBillingModel || !["monthly_fixed", "annual_prepaid"].includes(contract.pmBillingModel)) {
    return result; // Not a contract-billed model
  }

  // Determine billing period
  let period: { periodStart: string; periodEnd: string; billingDate: string } | null = null;

  if (contract.pmBillingModel === "monthly_fixed") {
    period = getMonthlyPeriod(now);
  } else if (contract.pmBillingModel === "annual_prepaid") {
    period = getAnnualPeriod(contract.startDate, now);
  }

  if (!period) {
    result.errors.push(`Could not determine billing period for contract ${contract.id}`);
    return result;
  }

  // Check if event already exists for this period (idempotency via query before insert)
  const [existing] = await db
    .select({ id: pmBillingEvents.id })
    .from(pmBillingEvents)
    .where(and(
      eq(pmBillingEvents.pmContractId, contract.id),
      eq(pmBillingEvents.periodStart, period.periodStart),
    ))
    .limit(1);

  if (existing) {
    return result; // Event already exists — idempotent skip
  }

  // Create the billing event
  try {
    const [event] = await db
      .insert(pmBillingEvents)
      .values({
        companyId: contract.companyId,
        pmContractId: contract.id,
        billingModelSnapshot: contract.pmBillingModel,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        billingDate: period.billingDate,
        status: "pending",
        amountSnapshot: contract.pmContractAmount ?? null,
        billingLabelSnapshot: contract.pmBillingLabel ?? contract.title,
      })
      .returning();

    result.eventsCreated++;
    console.log(
      `[PM-Billing] Created billing event for contract ${contract.id} ` +
      `(${contract.pmBillingModel}): ${period.periodStart} to ${period.periodEnd}`
    );

    // Immediately create invoice if contract has amount and location
    if (contract.locationId && contract.pmContractAmount) {
      try {
        const invoiceResult = await createInvoiceForEvent(event.id, contract);
        if (invoiceResult) {
          result.invoicesCreated++;
        }
      } catch (err: any) {
        result.errors.push(`Invoice creation failed for event ${event.id}: ${err.message}`);
        // Mark event as billing_exception
        await db
          .update(pmBillingEvents)
          .set({ status: "billing_exception", notes: `Invoice creation failed: ${err.message}`, updatedAt: new Date() })
          .where(eq(pmBillingEvents.id, event.id));
      }
    } else {
      // No location or amount — mark as exception
      const reason = !contract.locationId
        ? "Contract missing location — cannot create invoice"
        : "Contract missing billing amount";
      await db
        .update(pmBillingEvents)
        .set({ status: "billing_exception", notes: reason, updatedAt: new Date() })
        .where(eq(pmBillingEvents.id, event.id));
      result.errors.push(`Event ${event.id}: ${reason}`);
    }
  } catch (err: any) {
    // Unique constraint violation = another process created it (race condition safety)
    if (err.code === "23505") {
      return result; // Idempotent — already exists
    }
    result.errors.push(`Failed to create billing event for contract ${contract.id}: ${err.message}`);
  }

  return result;
}

/**
 * Create a canonical invoice from a PM billing event.
 * Links the invoice back to the event for traceability.
 */
async function createInvoiceForEvent(
  eventId: string,
  contract: RecurringJobTemplate
): Promise<boolean> {
  // Re-read event to ensure it's still pending
  const [event] = await db
    .select()
    .from(pmBillingEvents)
    .where(and(eq(pmBillingEvents.id, eventId), eq(pmBillingEvents.status, "pending")))
    .limit(1);

  if (!event) return false; // Already processed

  // Resolve customer company from location
  let customerCompanyId: string | null = null;
  if (contract.locationId) {
    const [location] = await db
      .select({ parentCompanyId: clients.parentCompanyId })
      .from(clients)
      .where(eq(clients.id, contract.locationId))
      .limit(1);
    customerCompanyId = location?.parentCompanyId ?? null;
  }

  // Create invoice via authorized path
  const { invoice } = await invoiceRepository.createInvoiceFromBillingEvent(
    contract.companyId,
    {
      locationId: contract.locationId!,
      customerCompanyId,
      billingLabel: event.billingLabelSnapshot ?? contract.title,
      amount: event.amountSnapshot ?? "0",
      periodStart: event.periodStart,
      periodEnd: event.periodEnd,
      billingModel: event.billingModelSnapshot,
    },
    "PM_BILLING_SERVICE"
  );

  // Link invoice to billing event
  await db
    .update(pmBillingEvents)
    .set({
      status: "invoiced",
      invoiceId: invoice.id,
      updatedAt: new Date(),
    })
    .where(eq(pmBillingEvents.id, eventId));

  console.log(
    `[PM-Billing] Created invoice #${invoice.invoiceNumber} for billing event ${eventId} ` +
    `(contract ${contract.id}, ${event.billingModelSnapshot})`
  );

  return true;
}

// ============================================================================
// Public API: Run billing for all tenants
// ============================================================================

/**
 * Run PM billing event generation for all tenants with active contract-billed PM contracts.
 * Called alongside PM auto-generation on startup + every 6 hours.
 */
export async function runBillingForAllTenants(): Promise<BillingRunResult> {
  const startTime = Date.now();
  console.log("[PM-Billing] Starting billing run...");

  const result: BillingRunResult = { companiesProcessed: 0, eventsCreated: 0, invoicesCreated: 0, errors: [] };

  try {
    // Find all active contracts with contract-based billing models
    const contracts = await db
      .select()
      .from(recurringJobTemplates)
      .where(and(
        eq(recurringJobTemplates.isActive, true),
        sql`${recurringJobTemplates.pmBillingModel} IN ('monthly_fixed', 'annual_prepaid')`,
      ));

    const companies = new Set(contracts.map((c) => c.companyId));
    console.log(`[PM-Billing] Found ${contracts.length} contract-billed PM contracts across ${companies.size} companies`);

    for (const contract of contracts) {
      try {
        const contractResult = await processContractBilling(contract);
        result.eventsCreated += contractResult.eventsCreated;
        result.invoicesCreated += contractResult.invoicesCreated;
        result.errors.push(...contractResult.errors);
      } catch (err: any) {
        result.errors.push(`Contract ${contract.id}: ${err.message}`);
        console.error(`[PM-Billing] Error processing contract ${contract.id}:`, err);
      }
    }

    result.companiesProcessed = companies.size;
  } catch (err: any) {
    console.error("[PM-Billing] Fatal error:", err);
    result.errors.push(`Fatal: ${err.message}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `[PM-Billing] Run complete in ${elapsed}s: ` +
    `${result.companiesProcessed} companies, ` +
    `${result.eventsCreated} events created, ` +
    `${result.invoicesCreated} invoices created, ` +
    `${result.errors.length} errors`
  );

  return result;
}

/**
 * Run PM billing for a single company (used by API trigger).
 */
export async function runBillingForCompany(companyId: string): Promise<ContractBillingResult> {
  const result: ContractBillingResult = { eventsCreated: 0, invoicesCreated: 0, errors: [] };

  const contracts = await db
    .select()
    .from(recurringJobTemplates)
    .where(and(
      eq(recurringJobTemplates.companyId, companyId),
      eq(recurringJobTemplates.isActive, true),
      sql`${recurringJobTemplates.pmBillingModel} IN ('monthly_fixed', 'annual_prepaid')`,
    ));

  for (const contract of contracts) {
    try {
      const contractResult = await processContractBilling(contract);
      result.eventsCreated += contractResult.eventsCreated;
      result.invoicesCreated += contractResult.invoicesCreated;
      result.errors.push(...contractResult.errors);
    } catch (err: any) {
      result.errors.push(`Contract ${contract.id}: ${err.message}`);
    }
  }

  return result;
}

/**
 * Skip a pending billing event (e.g., contract on hold, client dispute).
 */
export async function skipBillingEvent(eventId: string, companyId: string, reason?: string): Promise<void> {
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
}

/**
 * Get billing events for a PM contract (for detail page display).
 */
export async function getBillingEventsForContract(
  companyId: string,
  contractId: string
): Promise<any[]> {
  return db
    .select()
    .from(pmBillingEvents)
    .where(and(
      eq(pmBillingEvents.companyId, companyId),
      eq(pmBillingEvents.pmContractId, contractId),
    ))
    .orderBy(sql`${pmBillingEvents.periodStart} DESC`);
}

/**
 * Get all billing events for a company (for PM Billing oversight tab).
 */
export async function getBillingEventsForCompany(companyId: string): Promise<any[]> {
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
}
