/**
 * Client Intelligence — aggregate analytics for a single customer company.
 *
 * All queries are scoped to ctx.tenantId for tenant isolation.
 * Queries run in parallel via Promise.all — no sequential DB round-trips.
 */

import { eq, and, sql, inArray, isNull, desc } from "drizzle-orm";
import { db } from "../db";
import {
  jobs,
  invoices,
  invoiceLines,
  quotes,
  payments,
  equipment,
  jobVisits,
  recurringJobTemplates,
  clientLocations,
  customerCompanies,
} from "@shared/schema";
import type { QueryCtx } from "../lib/queryCtx";
import { UNPAID_INVOICE_STATUSES } from "./invoicesFeed";
import type { ClientIntelligenceData } from "@shared/clientIntelligence";

export type { ClientIntelligenceData };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toISODate(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  return val;
}

function grossMarginPct(revenue: number, cost: number): number | null {
  if (revenue === 0) return null;
  return ((revenue - cost) / revenue) * 100;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Returns a complete ClientIntelligenceData aggregate for a single customer company.
 *
 * Resolves location IDs first, then runs all aggregate queries in parallel.
 * Every query is scoped by ctx.tenantId to enforce tenant isolation.
 */
export async function getClientIntelligence(
  ctx: QueryCtx,
  opts: { customerCompanyId: string },
): Promise<ClientIntelligenceData> {
  const { customerCompanyId } = opts;
  const companyId = ctx.tenantId;

  // Step 1: Get all location IDs for this customer company.
  // Jobs are located via clientLocations.parentCompanyId — no direct customerCompanyId on jobs.
  const locationRows = await db
    .select({ id: clientLocations.id })
    .from(clientLocations)
    .where(
      and(
        eq(clientLocations.companyId, companyId),
        eq(clientLocations.parentCompanyId, customerCompanyId),
      ),
    );

  const locationIds = locationRows.map((r) => r.id);

  // Step 2: Run all aggregate queries in parallel.
  const [
    customerSinceRow,
    outstandingRow,
    lifetimeRevenueRow,
    marginRow,
    quotesRow,
    maintenancePlanRow,
    avgDaysToPayRow,
    companyAvgDaysToPayRow,
    jobsRow,
    invoicesRow,
    last30Row,
    last12Row,
    prev12Row,
    revenueTrendRows,
    paymentTrendRows,
    overdueRow,
    categoryRows,
    jobTypeRow,
    equipmentRow,
    openQuotesRow,
    visitCompletionRow,
    lastServiceRows,
  ] = await Promise.all([
    // customerSinceDate
    db
      .select({ createdAt: customerCompanies.createdAt })
      .from(customerCompanies)
      .where(
        and(
          eq(customerCompanies.id, customerCompanyId),
          eq(customerCompanies.companyId, companyId),
        ),
      )
      .limit(1),

    // outstanding balance + count
    db
      .select({
        balance: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)), 0)::text`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          eq(invoices.customerCompanyId, customerCompanyId),
          inArray(invoices.status, UNPAID_INVOICE_STATUSES),
        ),
      ),

    // lifetime revenue: sum(total) all invoices
    db
      .select({
        total: sql<string>`COALESCE(SUM(CAST(${invoices.total} AS numeric)), 0)::text`,
        count: sql<number>`COUNT(*)::int`,
        lastIssueDate: sql<string | null>`MAX(${invoices.issueDate})::text`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          eq(invoices.customerCompanyId, customerCompanyId),
        ),
      ),

    // gross margin: join invoice_lines via invoices — customer-scoped
    db
      .select({
        totalRevenue: sql<string>`COALESCE(SUM(CAST(${invoiceLines.lineTotal} AS numeric)), 0)::text`,
        totalCost: sql<string>`COALESCE(SUM(CAST(${invoiceLines.quantity} AS numeric) * CAST(${invoiceLines.unitCost} AS numeric)), 0)::text`,
        hasCostData: sql<boolean>`BOOL_OR(${invoiceLines.unitCost} IS NOT NULL AND CAST(${invoiceLines.unitCost} AS numeric) > 0)`,
      })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
      .where(
        and(
          eq(invoiceLines.companyId, companyId),
          eq(invoices.companyId, companyId),
          eq(invoices.customerCompanyId, customerCompanyId),
        ),
      ),

    // quotes: approved + rated (sent/approved/declined)
    db
      .select({
        status: quotes.status,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(quotes)
      .where(
        and(
          eq(quotes.companyId, companyId),
          eq(quotes.customerCompanyId, customerCompanyId),
          inArray(quotes.status, ["sent", "approved", "declined"]),
        ),
      )
      .groupBy(quotes.status),

    // maintenance plans
    db
      .select({
        count: sql<number>`COUNT(*)::int`,
        activeCount: sql<number>`COUNT(*) FILTER (WHERE ${recurringJobTemplates.isActive} = true)::int`,
      })
      .from(recurringJobTemplates)
      .where(
        and(
          eq(recurringJobTemplates.companyId, companyId),
          eq(recurringJobTemplates.clientId, customerCompanyId),
        ),
      ),

    // avg days to pay — this customer only
    db
      .select({
        avgDays: sql<string | null>`AVG(EXTRACT(epoch FROM (${payments.receivedAt} - ${invoices.issueDate}::timestamp)) / 86400)::text`,
      })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .where(
        and(
          eq(invoices.companyId, companyId),
          eq(invoices.customerCompanyId, customerCompanyId),
          eq(invoices.status, "paid"),
          sql`${invoices.issueDate} IS NOT NULL`,
          sql`${payments.receivedAt} IS NOT NULL`,
        ),
      ),

    // avg days to pay — all customers in company
    db
      .select({
        avgDays: sql<string | null>`AVG(EXTRACT(epoch FROM (${payments.receivedAt} - ${invoices.issueDate}::timestamp)) / 86400)::text`,
      })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .where(
        and(
          eq(invoices.companyId, companyId),
          eq(invoices.status, "paid"),
          sql`${invoices.issueDate} IS NOT NULL`,
          sql`${payments.receivedAt} IS NOT NULL`,
        ),
      ),

    // jobs aggregate — requires locationIds
    locationIds.length > 0
      ? db
          .select({
            count: sql<number>`COUNT(*)::int`,
            firstJobDate: sql<string | null>`MIN(${jobs.createdAt})::text`,
            lastJobDate: sql<string | null>`MAX(${jobs.closedAt})::text`,
          })
          .from(jobs)
          .where(
            and(
              eq(jobs.companyId, companyId),
              inArray(jobs.locationId, locationIds),
              isNull(jobs.deletedAt),
              eq(jobs.isActive, true),
            ),
          )
      : Promise.resolve([{ count: 0, firstJobDate: null, lastJobDate: null }]),

    // avg job value: avg(invoices.total) for this customer
    db
      .select({
        avgValue: sql<string | null>`AVG(CAST(${invoices.total} AS numeric))::text`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          eq(invoices.customerCompanyId, customerCompanyId),
        ),
      ),

    // last 30 days revenue
    db
      .select({
        gross: sql<string>`COALESCE(SUM(CAST(${invoices.total} AS numeric)), 0)::text`,
        count: sql<number>`COUNT(*)::int`,
        lineRevenue: sql<string>`COALESCE(SUM(CAST(il.line_total AS numeric)), 0)::text`,
        lineCost: sql<string>`COALESCE(SUM(CAST(il.line_cost_sum AS numeric)), 0)::text`,
        hasCost: sql<boolean>`BOOL_OR(il.has_cost)`,
      })
      .from(invoices)
      .leftJoin(
        sql`(SELECT invoice_id, SUM(CAST(line_total AS numeric)) AS line_total, SUM(CAST(quantity AS numeric) * CAST(unit_cost AS numeric)) AS line_cost_sum, BOOL_OR(unit_cost IS NOT NULL AND CAST(unit_cost AS numeric) > 0) AS has_cost FROM invoice_lines WHERE company_id = ${companyId} GROUP BY invoice_id) il`,
        sql`il.invoice_id = ${invoices.id}`,
      )
      .where(
        and(
          eq(invoices.companyId, companyId),
          eq(invoices.customerCompanyId, customerCompanyId),
          sql`${invoices.issueDate} >= CURRENT_DATE - INTERVAL '30 days'`,
        ),
      ),

    // last 12 months revenue + margin
    db
      .select({
        gross: sql<string>`COALESCE(SUM(CAST(${invoices.total} AS numeric)), 0)::text`,
        count: sql<number>`COUNT(*)::int`,
        lineRevenue: sql<string>`COALESCE(SUM(CAST(il.line_total AS numeric)), 0)::text`,
        lineCost: sql<string>`COALESCE(SUM(CAST(il.line_cost_sum AS numeric)), 0)::text`,
        hasCost: sql<boolean>`BOOL_OR(il.has_cost)`,
      })
      .from(invoices)
      .leftJoin(
        sql`(SELECT invoice_id, SUM(CAST(line_total AS numeric)) AS line_total, SUM(CAST(quantity AS numeric) * CAST(unit_cost AS numeric)) AS line_cost_sum, BOOL_OR(unit_cost IS NOT NULL AND CAST(unit_cost AS numeric) > 0) AS has_cost FROM invoice_lines WHERE company_id = ${companyId} GROUP BY invoice_id) il`,
        sql`il.invoice_id = ${invoices.id}`,
      )
      .where(
        and(
          eq(invoices.companyId, companyId),
          eq(invoices.customerCompanyId, customerCompanyId),
          sql`${invoices.issueDate} >= CURRENT_DATE - INTERVAL '12 months'`,
        ),
      ),

    // prev 12 months (months 13–24 ago) for comparison
    db
      .select({
        gross: sql<string>`COALESCE(SUM(CAST(${invoices.total} AS numeric)), 0)::text`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          eq(invoices.customerCompanyId, customerCompanyId),
          sql`${invoices.issueDate} >= CURRENT_DATE - INTERVAL '24 months'`,
          sql`${invoices.issueDate} < CURRENT_DATE - INTERVAL '12 months'`,
        ),
      ),

    // revenue trend: last 12 months by month
    db
      .select({
        month: sql<string>`TO_CHAR(${invoices.issueDate}::date, 'YYYY-MM')`,
        gross: sql<string>`COALESCE(SUM(CAST(${invoices.total} AS numeric)), 0)::text`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          eq(invoices.customerCompanyId, customerCompanyId),
          sql`${invoices.issueDate} >= CURRENT_DATE - INTERVAL '12 months'`,
          sql`${invoices.issueDate} IS NOT NULL`,
        ),
      )
      .groupBy(sql`TO_CHAR(${invoices.issueDate}::date, 'YYYY-MM')`)
      .orderBy(sql`TO_CHAR(${invoices.issueDate}::date, 'YYYY-MM') ASC`),

    // payment trend: last 12 months avg days to pay by month of receivedAt
    db
      .select({
        month: sql<string>`TO_CHAR(${payments.receivedAt}, 'YYYY-MM')`,
        avgDays: sql<string>`AVG(EXTRACT(epoch FROM (${payments.receivedAt} - ${invoices.issueDate}::timestamp)) / 86400)::text`,
      })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .where(
        and(
          eq(invoices.companyId, companyId),
          eq(invoices.customerCompanyId, customerCompanyId),
          sql`${payments.receivedAt} >= CURRENT_DATE - INTERVAL '12 months'`,
          sql`${invoices.issueDate} IS NOT NULL`,
          sql`${payments.receivedAt} IS NOT NULL`,
        ),
      )
      .groupBy(sql`TO_CHAR(${payments.receivedAt}, 'YYYY-MM')`)
      .orderBy(sql`TO_CHAR(${payments.receivedAt}, 'YYYY-MM') ASC`),

    // overdue: pct + largest amount
    db
      .select({
        overdueCount: sql<number>`COUNT(*) FILTER (WHERE ${invoices.dueDate} < CURRENT_DATE AND CAST(${invoices.balance} AS numeric) > 0)::int`,
        totalCount: sql<number>`COUNT(*)::int`,
        largestOverdue: sql<string | null>`MAX(CAST(${invoices.balance} AS numeric)) FILTER (WHERE ${invoices.dueDate} < CURRENT_DATE AND CAST(${invoices.balance} AS numeric) > 0)::text`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          eq(invoices.customerCompanyId, customerCompanyId),
          inArray(invoices.status, UNPAID_INVOICE_STATUSES),
        ),
      ),

    // revenue by category — invoice_lines grouped by lineItemType
    db
      .select({
        category: sql<string>`COALESCE(${invoiceLines.lineItemType}, 'Other')`,
        amount: sql<string>`COALESCE(SUM(CAST(${invoiceLines.lineTotal} AS numeric)), 0)::text`,
      })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
      .where(
        and(
          eq(invoiceLines.companyId, companyId),
          eq(invoices.companyId, companyId),
          eq(invoices.customerCompanyId, customerCompanyId),
          sql`${invoices.issueDate} >= CURRENT_DATE - INTERVAL '12 months'`,
        ),
      )
      .groupBy(sql`COALESCE(${invoiceLines.lineItemType}, 'Other')`),

    // most common job type — requires locationIds
    locationIds.length > 0
      ? db
          .select({
            jobType: jobs.jobType,
            count: sql<number>`COUNT(*)::int`,
          })
          .from(jobs)
          .where(
            and(
              eq(jobs.companyId, companyId),
              inArray(jobs.locationId, locationIds),
              isNull(jobs.deletedAt),
              eq(jobs.isActive, true),
              sql`${jobs.jobType} IS NOT NULL`,
            ),
          )
          .groupBy(jobs.jobType)
          .orderBy(desc(sql`COUNT(*)`))
          .limit(1)
      : Promise.resolve([]),

    // total active equipment — requires locationIds
    locationIds.length > 0
      ? db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(equipment)
          .where(
            and(
              eq(equipment.companyId, companyId),
              inArray(equipment.locationId, locationIds),
              eq(equipment.isActive, true),
              isNull(equipment.deletedAt),
            ),
          )
      : Promise.resolve([{ count: 0 }]),

    // open quotes value: sum(total) of sent quotes
    db
      .select({
        value: sql<string>`COALESCE(SUM(CAST(${quotes.total} AS numeric)), 0)::text`,
      })
      .from(quotes)
      .where(
        and(
          eq(quotes.companyId, companyId),
          eq(quotes.customerCompanyId, customerCompanyId),
          eq(quotes.status, "sent"),
        ),
      ),

    // work completion pct: completed visits / total visits for active jobs scoped to locationIds
    locationIds.length > 0
      ? db
          .select({
            totalVisits: sql<number>`COUNT(*)::int`,
            completedVisits: sql<number>`COUNT(*) FILTER (WHERE ${jobVisits.status} = 'completed')::int`,
          })
          .from(jobVisits)
          .innerJoin(
            jobs,
            and(eq(jobVisits.jobId, jobs.id), eq(jobs.status, "open")),
          )
          .where(
            and(
              eq(jobVisits.companyId, companyId),
              inArray(jobs.locationId, locationIds),
              eq(jobVisits.isActive, true),
              isNull(jobs.deletedAt),
              eq(jobs.isActive, true),
            ),
          )
      : Promise.resolve([{ totalVisits: 0, completedVisits: 0 }]),

    // last service date: most recent job closedAt or visit completedAt
    locationIds.length > 0
      ? db
          .select({
            lastJobClosed: sql<string | null>`MAX(${jobs.closedAt})::text`,
            lastVisitCompleted: sql<string | null>`MAX(${jobVisits.completedAt})::text`,
          })
          .from(jobs)
          .leftJoin(
            jobVisits,
            and(
              eq(jobVisits.jobId, jobs.id),
              eq(jobVisits.isActive, true),
              eq(jobVisits.status, "completed"),
            ),
          )
          .where(
            and(
              eq(jobs.companyId, companyId),
              inArray(jobs.locationId, locationIds),
              isNull(jobs.deletedAt),
              eq(jobs.isActive, true),
            ),
          )
      : Promise.resolve([{ lastJobClosed: null, lastVisitCompleted: null }]),
  ]);

  // ---------------------------------------------------------------------------
  // Assemble results
  // ---------------------------------------------------------------------------

  const customerSince = customerSinceRow[0]?.createdAt ?? null;
  const outstanding = outstandingRow[0];
  const lifetimeRow = lifetimeRevenueRow[0];
  const margin = marginRow[0];
  const jobsAgg = jobsRow[0];

  // Quotes
  let quotesApproved = 0;
  let quotesTotalRated = 0;
  for (const r of quotesRow) {
    const c = Number(r.count);
    quotesTotalRated += c;
    if (r.status === "approved") quotesApproved += c;
  }

  // Maintenance plans
  const mPlan = maintenancePlanRow[0];
  const maintenancePlanCount = Number(mPlan?.count ?? 0);
  const maintenancePlanActive = Number(mPlan?.activeCount ?? 0) > 0;

  // Avg days to pay
  const avgDaysRaw = avgDaysToPayRow[0]?.avgDays;
  const avgDaysToPay = avgDaysRaw != null && avgDaysRaw !== "" ? Number(avgDaysRaw) : null;
  const companyAvgRaw = companyAvgDaysToPayRow[0]?.avgDays;
  const companyAvgDaysToPay = companyAvgRaw != null && companyAvgRaw !== "" ? Number(companyAvgRaw) : null;

  // Lifetime margin
  const lifeRevenue = Number(margin?.totalRevenue ?? 0);
  const lifeCost = Number(margin?.totalCost ?? 0);
  const hasCostData = Boolean(margin?.hasCostData);
  const lifetimeGrossProfit = hasCostData ? lifeRevenue - lifeCost : null;
  const lifetimeGrossMarginPct = hasCostData ? grossMarginPct(lifeRevenue, lifeCost) : null;

  // Jobs aggregate
  const totalJobs = Number(jobsAgg?.count ?? 0);
  const firstJobDate = jobsAgg?.firstJobDate ?? null;
  const lastJobDate = jobsAgg?.lastJobDate ?? null;

  // avg service frequency in months
  let avgServiceFrequencyMonths: number | null = null;
  if (totalJobs >= 2 && firstJobDate && lastJobDate) {
    const firstMs = new Date(firstJobDate).getTime();
    const lastMs = new Date(lastJobDate).getTime();
    const diffMonths = (lastMs - firstMs) / (1000 * 60 * 60 * 24 * 30.44);
    avgServiceFrequencyMonths = diffMonths / (totalJobs - 1);
  }

  // Last service date: pick the more recent of lastJobClosed and lastVisitCompleted
  const svcRow = lastServiceRows[0];
  const lastJobClosed = svcRow?.lastJobClosed ?? null;
  const lastVisitCompleted = svcRow?.lastVisitCompleted ?? null;
  let lastServiceDate: string | null = null;
  if (lastJobClosed && lastVisitCompleted) {
    lastServiceDate = lastJobClosed > lastVisitCompleted ? lastJobClosed : lastVisitCompleted;
  } else {
    lastServiceDate = lastJobClosed ?? lastVisitCompleted ?? null;
  }

  let lastServiceDaysAgo: number | null = null;
  if (lastServiceDate) {
    const diffMs = Date.now() - new Date(lastServiceDate).getTime();
    lastServiceDaysAgo = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  // Last 30 days
  const l30 = last30Row[0];
  const l30Gross = Number(l30?.gross ?? 0);
  const l30Count = Number(l30?.count ?? 0);
  const l30Revenue = Number(l30?.lineRevenue ?? 0);
  const l30Cost = Number(l30?.lineCost ?? 0);
  const l30HasCost = Boolean(l30?.hasCost);
  const last30Days = {
    grossRevenue: l30Gross,
    invoiceCount: l30Count,
    avgInvoiceValue: l30Count > 0 ? l30Gross / l30Count : null,
    grossMarginPct: l30HasCost ? grossMarginPct(l30Revenue, l30Cost) : null,
  };

  // Last 12 months
  const l12 = last12Row[0];
  const l12Gross = Number(l12?.gross ?? 0);
  const l12Count = Number(l12?.count ?? 0);
  const l12Revenue = Number(l12?.lineRevenue ?? 0);
  const l12Cost = Number(l12?.lineCost ?? 0);
  const l12HasCost = Boolean(l12?.hasCost);
  const prev12Gross = Number(prev12Row[0]?.gross ?? 0);
  const last12Months = {
    grossRevenue: l12Gross,
    invoiceCount: l12Count,
    avgInvoiceValue: l12Count > 0 ? l12Gross / l12Count : null,
    grossMarginPct: l12HasCost ? grossMarginPct(l12Revenue, l12Cost) : null,
    prev12GrossRevenue: prev12Gross,
  };

  // Revenue trend
  const revenueTrend = revenueTrendRows.map((r) => ({
    month: r.month,
    gross: Number(r.gross),
  }));

  // Payment trend
  const paymentTrend = paymentTrendRows.map((r) => ({
    month: r.month,
    avgDays: Number(r.avgDays),
  }));

  // Overdue
  const ov = overdueRow[0];
  const overdueCount = Number(ov?.overdueCount ?? 0);
  const totalInvCount = Number(ov?.totalCount ?? 0);
  const pctInvoicesOverdue = totalInvCount > 0 ? (overdueCount / totalInvCount) * 100 : null;
  const largestOverdueRaw = ov?.largestOverdue ?? null;
  const largestOverdueAmount = largestOverdueRaw != null && largestOverdueRaw !== "" ? Number(largestOverdueRaw) : null;

  // Revenue by category
  const categoryTotal = categoryRows.reduce((acc, r) => acc + Number(r.amount), 0);
  const revenueByCategory = categoryRows.map((r) => {
    const amount = Number(r.amount);
    return {
      category: r.category,
      amount,
      pct: categoryTotal > 0 ? (amount / categoryTotal) * 100 : 0,
    };
  });

  // At a glance
  const mostCommonJobType = (jobTypeRow as any[])[0]?.jobType ?? null;
  const totalEquipment = Number((equipmentRow as any[])[0]?.count ?? 0);
  const openQuotesValue = Number(openQuotesRow[0]?.value ?? 0);

  // Work completion
  const wc = (visitCompletionRow as any[])[0];
  const totalVisits = Number(wc?.totalVisits ?? 0);
  const completedVisits = Number(wc?.completedVisits ?? 0);
  const workCompletionPct = totalVisits > 0 ? (completedVisits / totalVisits) * 100 : null;

  // avgJobValue
  const avgJobValueRaw = invoicesRow[0]?.avgValue ?? null;
  const avgJobValue = avgJobValueRaw != null && avgJobValueRaw !== "" ? Number(avgJobValueRaw) : null;

  return {
    avgDaysToPay,
    companyAvgDaysToPay,
    outstandingBalance: Number(outstanding?.balance ?? 0),
    outstandingInvoiceCount: Number(outstanding?.count ?? 0),
    lifetimeRevenue: Number(lifetimeRow?.total ?? 0),
    customerSinceDate: toISODate(customerSince),
    lifetimeGrossMarginPct,
    lifetimeGrossProfit,
    quotesApproved,
    quotesTotalRated,
    quoteApprovalRate: quotesTotalRated > 0 ? (quotesApproved / quotesTotalRated) * 100 : null,
    lastServiceDate,
    lastServiceDaysAgo,
    maintenancePlanActive,
    maintenancePlanCount,

    totalJobs,
    totalInvoices: Number(lifetimeRow?.count ?? 0),
    lastJobDate: toISODate(lastJobDate),
    lastInvoiceDate: toISODate(lifetimeRow?.lastIssueDate ?? null),
    avgServiceFrequencyMonths,
    avgJobValue,

    last30Days,
    last12Months,
    revenueTrend,

    pctInvoicesOverdue,
    largestOverdueAmount,
    paymentTrend,

    revenueByCategory,

    mostCommonJobType,
    totalEquipment,
    openQuotesValue,
    workCompletionPct,
  };
}
