/**
 * Dashboard Storage — Phase 5 Part B
 *
 * Provides workflow summary counts and needs-attention job list
 * for the Dashboard page.
 *
 * Phase 5 B2: Refactored from class-based DashboardRepository to
 * function-based QueryCtx pattern. Uses canonical activeJobFilter()
 * and activeInvoiceFilter() guards instead of inline conditions.
 *
 * NORMALIZED JOB STATUS MODEL (4 values only):
 * - "open"      - Active job that can be worked on
 * - "completed" - Work finished (may need invoicing)
 * - "invoiced"  - Invoice created (locked)
 * - "archived"  - Historical archive
 *
 * WORKFLOW SUB-STATUS (openSubStatus, only when status = 'open'):
 * - null         - Default state
 * - in_progress  - Work actively being performed
 * - on_hold      - Job is blocked (requires holdReason)
 * - on_route     - Technician traveling to job
 * - (needs_review: removed — migrated to on_hold)
 */

import { jobs, invoices, clientLocations as clients, customerCompanies, recurringJobInstances, recurringJobTemplates, quotes, payments } from "@shared/schema";
import { eq, and, or, sql, asc, isNull, gte, lt, inArray } from "drizzle-orm";
import type { QueryCtx } from "../lib/queryCtx";
import { activeJobFilter } from "./jobFilters";
import { activeInvoiceFilter, UNPAID_INVOICE_STATUSES, UNPAID_INVOICE_STATUS_SQL } from "./invoicesFeed";
import { db } from "../db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Workflow summary for the Dashboard strip. */
export interface WorkflowSummary {
  quotes: { approvedCount: number; draftCount: number };
  jobs: { requiresInvoicingCount: number; activeCount: number; onHoldCount: number; unscheduledCount: number };
  invoices: { outstandingCount: number; pastDueCount: number };
  pm: { awaitingGenerationCount: number; overdueCount: number; comingDueCount: number; upcomingCount: number };
  fourth: null;
}

/**
 * Phase 5 B2: Dashboard job item with attention classification.
 * attentionType is presentation logic specific to the dashboard,
 * not a core job attribute — hence a separate type (Option B).
 */
export interface DashboardJobItem {
  id: string;
  jobNumber: number;
  summary: string;
  status: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  isAllDay: boolean;
  locationName: string | null;
  locationDisplayName: string | null;
  location: {
    companyName: string | null;
    location: string | null;
  } | null;
  attentionType: "overdue" | "on_hold" | "requires_invoicing" | "other";
}

// ---------------------------------------------------------------------------
// Workflow Summary (counts)
// ---------------------------------------------------------------------------

/**
 * Get workflow summary counts for a company.
 * Phase 5 B2: Now uses QueryCtx + canonical filters.
 */
export async function getWorkflowSummary(ctx: QueryCtx): Promise<WorkflowSummary> {
  const [jobCounts, invoiceCounts, pmCounts] = await Promise.all([
    getJobCounts(ctx),
    getInvoiceCounts(ctx),
    getPMCounts(ctx.tenantId),
  ]);

  return {
    quotes: { approvedCount: 0, draftCount: 0 }, // No quotes table
    jobs: jobCounts,
    invoices: invoiceCounts,
    pm: pmCounts,
    fourth: null,
  };
}

// 2026-03-18: effectiveEndExpr centralized in server/lib/queryHelpers.ts
import { effectiveEndExpr, locationDisplayNameExpr } from "../lib/queryHelpers";

async function getJobCounts(ctx: QueryCtx) {
  const result = await ctx.db
    .select({
      requiresInvoicingCount: sql<number>`
        COUNT(*) FILTER (WHERE ${jobs.status} = 'completed')
      `.as("requires_invoicing_count"),
      activeCount: sql<number>`
        COUNT(*) FILTER (WHERE ${jobs.status} = 'open')
      `.as("active_count"),
      onHoldCount: sql<number>`
        COUNT(*) FILTER (WHERE ${jobs.status} = 'open' AND ${jobs.openSubStatus} = 'on_hold')
      `.as("on_hold_count"),
      // 2026-03-18: Canonical unscheduled — aligned with isBacklogEligible() from shared/schema.ts
      // Removed all-day exclusion (was causing count drift vs attention rules and dispatch rail)
      unscheduledCount: sql<number>`
        COUNT(*) FILTER (WHERE ${jobs.status} = 'open'
          AND ${jobs.scheduledStart} IS NULL
          AND (${jobs.openSubStatus} IS NULL OR ${jobs.openSubStatus} != 'on_hold'))
      `.as("unscheduled_count"),
    })
    .from(jobs)
    .where(and(eq(jobs.companyId, ctx.tenantId), activeJobFilter()));

  const c = result[0] || { requiresInvoicingCount: 0, activeCount: 0, onHoldCount: 0, unscheduledCount: 0 };
  return {
    requiresInvoicingCount: Number(c.requiresInvoicingCount) || 0,
    activeCount: Number(c.activeCount) || 0,
    onHoldCount: Number(c.onHoldCount) || 0,
    unscheduledCount: Number(c.unscheduledCount) || 0,
  };
}

async function getInvoiceCounts(ctx: QueryCtx) {
  const today = new Date().toISOString().slice(0, 10);

  const result = await ctx.db
    .select({
      outstandingCount: sql<number>`
        COUNT(*) FILTER (
          WHERE CAST(${invoices.balance} AS NUMERIC) > 0
          AND ${invoices.status} IN (${sql.raw(UNPAID_INVOICE_STATUS_SQL)})
        )
      `.as("outstanding_count"),
      pastDueCount: sql<number>`
        COUNT(*) FILTER (
          WHERE ${invoices.dueDate} < ${today}
          AND CAST(${invoices.balance} AS NUMERIC) > 0
          AND ${invoices.status} IN (${sql.raw(UNPAID_INVOICE_STATUS_SQL)})
        )
      `.as("past_due_count"),
    })
    .from(invoices)
    .where(and(eq(invoices.companyId, ctx.tenantId), activeInvoiceFilter()));

  const c = result[0] || { outstandingCount: 0, pastDueCount: 0 };
  return {
    outstandingCount: Number(c.outstandingCount) || 0,
    pastDueCount: Number(c.pastDueCount) || 0,
  };
}

/**
 * Unified PM counts: awaiting generation + health urgency tiers.
 *
 * PM Health tiers (non-overlapping, based on instanceDate):
 *   - Overdue:      instanceDate < today
 *   - Coming Due:   today <= instanceDate <= today + 7 days
 *   - Upcoming:     today + 7 < instanceDate <= today + 30 days
 *
 * CRITICAL: Only unconverted instances count toward PM Health.
 *   Once a PM instance has generatedJobId set (converted to job), it exits PM Health entirely.
 *   Statuses excluded: 'generated' (converted), 'skipped', 'canceled'.
 *
 * Awaiting generation: pending instances within their service window (existing logic).
 */
async function getPMCounts(tenantId: string) {
  const today = new Date().toISOString().slice(0, 10);

  // Single query: all PM counts in one pass using FILTER clauses
  const result = await db
    .select({
      awaitingGenerationCount: sql<number>`
        COUNT(*) FILTER (WHERE
          ${recurringJobInstances.generatedJobId} IS NULL
          AND ${recurringJobInstances.status} = 'pending'
          AND (${recurringJobInstances.instanceDate}::date - COALESCE(${recurringJobTemplates.serviceWindowDaysBefore}, 7)) <= ${today}::date
        )
      `.as("awaiting_generation_count"),
      // PM Health: only pending instances (not converted/skipped/canceled)
      overdueCount: sql<number>`
        COUNT(*) FILTER (WHERE
          ${recurringJobInstances.status} = 'pending'
          AND ${recurringJobInstances.generatedJobId} IS NULL
          AND ${recurringJobInstances.instanceDate}::date < ${today}::date
        )
      `.as("overdue_count"),
      comingDueCount: sql<number>`
        COUNT(*) FILTER (WHERE
          ${recurringJobInstances.status} = 'pending'
          AND ${recurringJobInstances.generatedJobId} IS NULL
          AND ${recurringJobInstances.instanceDate}::date >= ${today}::date
          AND ${recurringJobInstances.instanceDate}::date <= (${today}::date + 7)
        )
      `.as("coming_due_count"),
      upcomingCount: sql<number>`
        COUNT(*) FILTER (WHERE
          ${recurringJobInstances.status} = 'pending'
          AND ${recurringJobInstances.generatedJobId} IS NULL
          AND ${recurringJobInstances.instanceDate}::date > (${today}::date + 7)
          AND ${recurringJobInstances.instanceDate}::date <= (${today}::date + 30)
        )
      `.as("upcoming_count"),
    })
    .from(recurringJobInstances)
    .innerJoin(recurringJobTemplates, eq(recurringJobInstances.templateId, recurringJobTemplates.id))
    .where(and(
      eq(recurringJobInstances.companyId, tenantId),
      eq(recurringJobTemplates.isActive, true),
    ));

  const c = result[0] || { awaitingGenerationCount: 0, overdueCount: 0, comingDueCount: 0, upcomingCount: 0 };
  return {
    awaitingGenerationCount: Number(c.awaitingGenerationCount) || 0,
    overdueCount: Number(c.overdueCount) || 0,
    comingDueCount: Number(c.comingDueCount) || 0,
    upcomingCount: Number(c.upcomingCount) || 0,
  };
}

// ---------------------------------------------------------------------------
// Needs-Attention Jobs (thin wrapper — Option B)
// ---------------------------------------------------------------------------

/** Shared select fields for dashboard job queries. */
const dashboardJobSelect = {
  id: jobs.id,
  jobNumber: jobs.jobNumber,
  summary: jobs.summary,
  status: jobs.status,
  scheduledStart: jobs.scheduledStart,
  scheduledEnd: jobs.scheduledEnd,
  isAllDay: jobs.isAllDay,
  locationName: clients.location,
  locationDisplayName: locationDisplayNameExpr,
  location: {
    companyName: clients.companyName,
    location: clients.location,
  },
};

function toISOOrNull(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  return val;
}

function mapDashboardRow(row: any, attentionType: string): DashboardJobItem {
  return {
    id: row.id,
    jobNumber: row.jobNumber,
    summary: row.summary,
    status: row.status,
    scheduledStart: toISOOrNull(row.scheduledStart),
    scheduledEnd: toISOOrNull(row.scheduledEnd),
    isAllDay: Boolean(row.isAllDay),
    locationName: row.locationName ?? null,
    locationDisplayName: row.locationDisplayName ?? null,
    location: row.location?.companyName
      ? { companyName: row.location.companyName, location: row.location.location ?? null }
      : null,
    attentionType: attentionType as DashboardJobItem["attentionType"],
  };
}

/**
 * Get jobs needing attention for the dashboard widget.
 * Uses QueryCtx, activeJobFilter(), canonical COALESCE joins.
 *
 * Combines:
 *   1. Overdue jobs (effectiveEnd < NOW(), still open) — instant cutoff, matches isJobOverdue()
 *   2. On-hold + completed (needs invoicing) attention jobs
 * Sorted: overdue first (oldest), then requires_invoicing, then on_hold.
 * Deduplicates by job ID.
 */
export async function getNeedsAttentionJobs(
  ctx: QueryCtx,
  limit: number = 5
): Promise<DashboardJobItem[]> {
  // Queries 1 & 2 are independent — execute in parallel
  const [overdueRows, attentionRows] = await Promise.all([
    // Query 1: Overdue jobs — inline conditions to match isJobOverdue() exactly:
    //   status='open', scheduledStart IS NOT NULL, effectiveEnd < NOW()
    ctx.db
      .select({
        ...dashboardJobSelect,
        attentionType: sql<string>`'overdue'`.as("attention_type"),
      })
      .from(jobs)
      .leftJoin(clients, eq(jobs.locationId, clients.id))
      .leftJoin(customerCompanies, eq(clients.parentCompanyId, customerCompanies.id))
      .where(
        and(
          eq(jobs.companyId, ctx.tenantId),
          activeJobFilter(),
          eq(jobs.status, "open"),
          sql`${jobs.scheduledStart} IS NOT NULL`,
          sql`${effectiveEndExpr} < NOW()`,
          // Exclude jobs actively being worked — in_progress/on_route are not overdue-attention
          sql`(${jobs.openSubStatus} IS NULL OR ${jobs.openSubStatus} NOT IN ('in_progress', 'on_route'))`
        )
      )
      .orderBy(asc(jobs.scheduledStart)),

    // Query 2: Attention jobs (on_hold or completed/needs-invoicing)
    ctx.db
      .select({
        ...dashboardJobSelect,
        attentionType: sql<string>`
          CASE
            WHEN ${jobs.openSubStatus} = 'on_hold' THEN 'on_hold'
            WHEN ${jobs.status} = 'completed' THEN 'requires_invoicing'
            ELSE 'other'
          END
        `.as("attention_type"),
      })
      .from(jobs)
      .leftJoin(clients, eq(jobs.locationId, clients.id))
      .leftJoin(customerCompanies, eq(clients.parentCompanyId, customerCompanies.id))
      .where(
        and(
          eq(jobs.companyId, ctx.tenantId),
          activeJobFilter(),
          or(
            and(eq(jobs.status, "open"), eq(jobs.openSubStatus, "on_hold")),
            eq(jobs.status, "completed")
          )
        )
      )
      .orderBy(
        sql`CASE WHEN ${jobs.status} = 'completed' THEN 0 ELSE 1 END`,
        asc(jobs.scheduledStart)
      ),
  ]);

  // Combine: overdue first, then attention, deduped
  const seenIds = new Set<string>();
  const combined: DashboardJobItem[] = [];

  for (const row of overdueRows) {
    if (!seenIds.has(row.id)) {
      seenIds.add(row.id);
      combined.push(mapDashboardRow(row, row.attentionType));
    }
  }
  for (const row of attentionRows) {
    if (!seenIds.has(row.id)) {
      seenIds.add(row.id);
      combined.push(mapDashboardRow(row, row.attentionType));
    }
  }

  return combined.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Legacy export for backward compatibility (used by routes)
// Phase 5 B2: Thin adapter bridging old class API → new function API
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Financial Summary (Phase 2: extracted verbatim from routes/dashboard.ts)
// ---------------------------------------------------------------------------

export interface FinancialSummary {
  revenue: { today: number; week: number; month: number; lastMonth: number };
  trend: { month: string; total: number }[];
  ar: { outstandingTotal: number; outstandingCount: number; pastDueTotal: number; pastDueCount: number; sentThisMonth: number };
  quotes: { sent: number; approved: number; conversionRate: number; avgValue: number };
  pm: { contractCount: number; totalContractValue: number };
}

export async function getFinancialSummary(ctx: QueryCtx): Promise<FinancialSummary> {
  const companyId = ctx.tenantId;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); // Monday
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 1);

  // Revenue by period (cash-basis: sum of payments received)
  const revenueQuery = async (from: Date, to: Date) => {
    const rows = await db.select({
      total: sql<string>`COALESCE(SUM(CAST(${payments.amount} AS numeric)), 0)::text`,
    }).from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .where(and(
        eq(invoices.companyId, companyId),
        gte(payments.receivedAt, from),
        lt(payments.receivedAt, to),
      ));
    return parseFloat(rows[0]?.total ?? "0");
  };

  // P3-01: All 10 reads are independent — dispatch concurrently via single Promise.all.
  // Previously: 4 revenue queries parallel, then 6 stats queries sequential.
  const UNPAID = UNPAID_INVOICE_STATUSES;

  const [
    revenueToday, revenueWeek, revenueMonth, revenueLastMonth,
    trendRows, arRows, pastDueRows, sentThisMonthRows, quoteRows, pmRows,
  ] = await Promise.all([
    // Revenue by period (4 queries)
    revenueQuery(todayStart, new Date(todayStart.getTime() + 86400000)),
    revenueQuery(weekStart, new Date(todayStart.getTime() + 86400000)),
    revenueQuery(monthStart, new Date(todayStart.getTime() + 86400000)),
    revenueQuery(lastMonthStart, lastMonthEnd),

    // Monthly revenue trend (last 12 months, cash-basis)
    db.select({
      month: sql<string>`TO_CHAR(${payments.receivedAt}, 'YYYY-MM')`,
      total: sql<string>`COALESCE(SUM(CAST(${payments.amount} AS numeric)), 0)::text`,
    }).from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .where(and(
        eq(invoices.companyId, companyId),
        gte(payments.receivedAt, new Date(now.getFullYear() - 1, now.getMonth(), 1)),
      ))
      .groupBy(sql`TO_CHAR(${payments.receivedAt}, 'YYYY-MM')`)
      .orderBy(sql`TO_CHAR(${payments.receivedAt}, 'YYYY-MM')`),

    // Invoice stats (AR)
    db.select({
      status: invoices.status,
      count: sql<number>`count(*)::int`,
      totalBalance: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)), 0)::text`,
    }).from(invoices)
      .where(and(
        eq(invoices.companyId, companyId),
        inArray(invoices.status, UNPAID),
        sql`${invoices.isActive} = true`,
      ))
      .groupBy(invoices.status),

    // Past due
    db.select({
      count: sql<number>`count(*)::int`,
      total: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)), 0)::text`,
    }).from(invoices)
      .where(and(
        eq(invoices.companyId, companyId),
        inArray(invoices.status, UNPAID),
        sql`${invoices.isActive} = true`,
        sql`CAST(${invoices.balance} AS numeric) > 0`,
        sql`${invoices.dueDate} < CURRENT_DATE`,
      )),

    // Invoices sent this month
    db.select({
      count: sql<number>`count(*)::int`,
    }).from(invoices)
      .where(and(
        eq(invoices.companyId, companyId),
        sql`${invoices.isActive} = true`,
        gte(invoices.sentAt, monthStart),
      )),

    // Quote pipeline
    db.select({
      status: quotes.status,
      count: sql<number>`count(*)::int`,
      total: sql<string>`COALESCE(SUM(CAST(${quotes.total} AS numeric)), 0)::text`,
    }).from(quotes)
      .where(and(eq(quotes.companyId, companyId), eq(quotes.isActive, true)))
      .groupBy(quotes.status),

    // PM financial health
    db.select({
      count: sql<number>`count(*)::int`,
      totalContractValue: sql<string>`COALESCE(SUM(CAST(${recurringJobTemplates.pmContractAmount} AS numeric)), 0)::text`,
    }).from(recurringJobTemplates)
      .where(and(
        eq(recurringJobTemplates.companyId, companyId),
        eq(recurringJobTemplates.isActive, true),
      )),
  ]);

  // Post-query derivations (unchanged)
  const outstandingTotal = arRows.reduce((s, r) => s + parseFloat(r.totalBalance ?? "0"), 0);
  const outstandingCount = arRows.reduce((s, r) => s + r.count, 0);

  const quotePipeline: Record<string, { count: number; total: number }> = {};
  for (const r of quoteRows) {
    quotePipeline[r.status ?? "unknown"] = { count: r.count, total: parseFloat(r.total ?? "0") };
  }
  const totalQuotes = quoteRows.reduce((s, r) => s + r.count, 0);
  const convertedCount = quotePipeline["converted"]?.count ?? 0;
  const conversionRate = totalQuotes > 0 ? (convertedCount / totalQuotes * 100) : 0;
  const allQuoteTotal = quoteRows.reduce((s, r) => s + parseFloat(r.total ?? "0"), 0);
  const avgQuoteValue = totalQuotes > 0 ? allQuoteTotal / totalQuotes : 0;

  return {
    revenue: {
      today: revenueToday,
      week: revenueWeek,
      month: revenueMonth,
      lastMonth: revenueLastMonth,
    },
    trend: trendRows.map(r => ({ month: r.month, total: parseFloat(r.total ?? "0") })),
    ar: {
      outstandingTotal,
      outstandingCount,
      pastDueTotal: parseFloat(pastDueRows[0]?.total ?? "0"),
      pastDueCount: pastDueRows[0]?.count ?? 0,
      sentThisMonth: sentThisMonthRows[0]?.count ?? 0,
    },
    quotes: {
      sent: quotePipeline["sent"]?.count ?? 0,
      approved: quotePipeline["approved"]?.count ?? 0,
      conversionRate: Math.round(conversionRate * 10) / 10,
      avgValue: Math.round(avgQuoteValue * 100) / 100,
    },
    pm: {
      contractCount: pmRows[0]?.count ?? 0,
      totalContractValue: parseFloat(pmRows[0]?.totalContractValue ?? "0"),
    },
  };
}

export const dashboardRepository = {
  getWorkflowSummary: (companyId: string) => {
    // Legacy callers pass companyId directly; wrap in a minimal QueryCtx
    const { db } = require("../db");
    const ctx: QueryCtx = { db, tenantId: companyId, userId: "", role: "" };
    return getWorkflowSummary(ctx);
  },
  getNeedsAttentionJobs: (companyId: string, limit?: number) => {
    const { db } = require("../db");
    const ctx: QueryCtx = { db, tenantId: companyId, userId: "", role: "" };
    return getNeedsAttentionJobs(ctx, limit);
  },
};
