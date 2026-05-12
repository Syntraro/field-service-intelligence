/**
 * Dashboard Storage — Phase 5 Part B
 *
 * Provides workflow summary counts and needs-attention job list
 * for the Dashboard page.
 *
 * Phase 5 B2: Refactored from class-based DashboardRepository to
 * function-based QueryCtx pattern. Uses canonical activeJobFilter() guard
 * for jobs. 2026-04-09: invoice queries no longer use activeInvoiceFilter()
 * because invoices use the permanent-delete model — see
 * migrations/2026_04_09_invoice_permanent_delete.sql.
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

import { jobs, invoices, clientLocations as clients, customerCompanies, recurringJobInstances, recurringJobTemplates, quotes, payments, leads, leadVisits } from "@shared/schema";
import { eq, and, or, sql, asc, desc, isNull, gte, lt, inArray } from "drizzle-orm";
import type { QueryCtx } from "../lib/queryCtx";
import { activeJobFilter } from "./jobFilters";
// 2026-04-09: activeInvoiceFilter dropped (permanent-delete model — no soft delete on invoices)
import { UNPAID_INVOICE_STATUSES, UNPAID_INVOICE_STATUS_SQL } from "./invoicesFeed";
import { db } from "../db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * 2026-04-22 dashboard upgrade: one quote preview row per bucket.
 * Short label + amount + timing context + click → canonical quotes list.
 */
export interface DashboardQuotePreview {
  id: string;
  quoteNumber: string | null;
  title: string | null;
  customerName: string | null;
  total: number;
  /**
   * Bucket-specific reference timestamp for "sent / edited / approved X days ago"
   * copy. Awaiting-approval → sentAt; Draft → updatedAt fallback createdAt;
   * Approved → approvedAt. Null when the source column is null.
   */
  referenceAt: string | null;
}

/** Workflow summary for the Dashboard strip. */
export interface WorkflowSummary {
  quotes: {
    /** 2026-04-22: real counts (was hardcoded to 0 before today). */
    awaitingApprovalCount: number;
    draftReadyToSendCount: number;
    approvedNotConvertedCount: number;
    /** Up to 5 previews per bucket — client applies smart-fill to render up to 9 across buckets. */
    awaitingApprovalPreview: DashboardQuotePreview[];
    draftReadyToSendPreview: DashboardQuotePreview[];
    approvedNotConvertedPreview: DashboardQuotePreview[];
    /** Kept for backwards compatibility with any pre-existing consumer. */
    approvedCount: number;
    draftCount: number;
  };
  jobs: {
    requiresInvoicingCount: number;
    activeCount: number;
    onHoldCount: number;
    unscheduledCount: number;
    /**
     * 2026-04-08: Live overdue count.
     * Replaced the dashboard's previous read of the attention_items overdue
     * rule, which was materialized and had no time-based refresher → silently
     * stale. 2026-04-09: the corresponding attention rule was deleted entirely
     * (server/lib/attentionRules.ts) — overdue is now ONLY computed live here.
     * Uses the same effectiveEndExpr + openSubStatus exclusion the modal uses,
     * so dashboard count and modal list stay in lockstep by construction.
     */
    overdueCount: number;
  };
  invoices: {
    outstandingCount: number;
    pastDueCount: number;
    /** 2026-04-22 Revenue Center: draft invoice count surfaced alongside past-due. */
    draftCount: number;
  };
  pm: {
    awaitingGenerationCount: number;
    overdueCount: number;
    comingDueCount: number;
    upcomingCount: number;
    /**
     * 2026-04-22: PM relevance flag — the dashboard's PM Health card hides
     * entirely when no PM template or instance exists. Avoids dedicating
     * real estate to an empty product area for tenants not using PM.
     */
    hasAnyData: boolean;
  };
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
  const [jobCounts, invoiceCounts, pmCounts, quoteSummary] = await Promise.all([
    getJobCounts(ctx),
    getInvoiceCounts(ctx),
    getPMCounts(ctx.tenantId),
    // 2026-04-22: quote pipeline counts + 5-row previews per bucket.
    getQuotePipeline(ctx.tenantId),
  ]);

  return {
    quotes: {
      awaitingApprovalCount: quoteSummary.awaitingApproval.count,
      draftReadyToSendCount: quoteSummary.draftReadyToSend.count,
      approvedNotConvertedCount: quoteSummary.approvedNotConverted.count,
      awaitingApprovalPreview: quoteSummary.awaitingApproval.preview,
      draftReadyToSendPreview: quoteSummary.draftReadyToSend.preview,
      approvedNotConvertedPreview: quoteSummary.approvedNotConverted.preview,
      // Back-compat mirror: earlier WorkflowSummary consumers used these fields
      // for a simple "draft count / approved count" strip. Kept non-zero now so
      // any straggler reader sees real data instead of the former hardcoded 0.
      draftCount: quoteSummary.draftReadyToSend.count,
      approvedCount: quoteSummary.approvedNotConverted.count,
    },
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
      // 2026-04-19 Fix A: "ready for invoice" now requires both
      // status='completed' AND zero existing invoices on the job. The
      // prior filter over-counted jobs that already had invoices but
      // hadn't transitioned to 'invoiced' status (e.g. manual invoice
      // creation that bypassed the close-with-invoice flow).
      requiresInvoicingCount: sql<number>`
        COUNT(*) FILTER (WHERE ${jobs.status} = 'completed'
          AND NOT EXISTS (
            SELECT 1 FROM ${invoices}
            WHERE ${invoices.jobId} = ${jobs.id}
              AND ${invoices.companyId} = ${jobs.companyId}
          ))
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
      // 2026-04-08: Live overdue count — single SoT with the modal.
      // This is the SOLE source of the overdue count for the dashboard widget.
      // Predicates byte-equivalent to:
      //   server/storage/dashboard.ts getNeedsAttentionJobs overdue branch (lines 295-303)
      //   server/storage/jobsFeed.ts overdue filter (lines 402-408)
      // Reuses the same effectiveEndExpr SQL helper so any future change to
      // the overdue definition propagates to all three call sites in one place.
      overdueCount: sql<number>`
        COUNT(*) FILTER (WHERE ${jobs.status} = 'open'
          AND ${jobs.scheduledStart} IS NOT NULL
          AND ${effectiveEndExpr} < NOW()
          AND (${jobs.openSubStatus} IS NULL OR ${jobs.openSubStatus} NOT IN ('in_progress', 'on_route')))
      `.as("overdue_count"),
    })
    .from(jobs)
    .where(and(eq(jobs.companyId, ctx.tenantId), activeJobFilter()));

  const c = result[0] || { requiresInvoicingCount: 0, activeCount: 0, onHoldCount: 0, unscheduledCount: 0, overdueCount: 0 };
  return {
    requiresInvoicingCount: Number(c.requiresInvoicingCount) || 0,
    activeCount: Number(c.activeCount) || 0,
    onHoldCount: Number(c.onHoldCount) || 0,
    unscheduledCount: Number(c.unscheduledCount) || 0,
    overdueCount: Number(c.overdueCount) || 0,
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
      // 2026-04-22 Revenue Center — draft invoice count surfaced on the dashboard.
      draftCount: sql<number>`
        COUNT(*) FILTER (WHERE ${invoices.status} = 'draft')
      `.as("draft_count"),
    })
    .from(invoices)
    .where(and(eq(invoices.companyId, ctx.tenantId)));

  const c = result[0] || { outstandingCount: 0, pastDueCount: 0, draftCount: 0 };
  return {
    outstandingCount: Number(c.outstandingCount) || 0,
    pastDueCount: Number(c.pastDueCount) || 0,
    draftCount: Number(c.draftCount) || 0,
  };
}

// ---------------------------------------------------------------------------
// Quote Pipeline (2026-04-22)
// ---------------------------------------------------------------------------
//
// Three actionable quote buckets, each with a count + up to 5 preview rows:
//   • awaitingApproval   : status='sent'     → "Follow up" CTA
//   • draftReadyToSend   : status='draft'    → "Send / open" CTA
//   • approvedNotConverted : status='approved' AND convertedToJobId IS NULL
//                           → "Convert / open" CTA
//
// Kept surgical — no materialized view, no new endpoint. The existing
// /api/dashboard/workflow query is the single round-trip for the dashboard.
// Customer name derivation follows the canonical
// COALESCE(customerCompanies.name, clients.companyName) rule used by
// getFinancialSummary() and the Financial Dashboard preview lists.
// ---------------------------------------------------------------------------

interface QuotePipelineBucket {
  count: number;
  preview: Array<{
    id: string;
    quoteNumber: string | null;
    title: string | null;
    customerName: string | null;
    total: number;
    referenceAt: string | null;
  }>;
}

async function getQuotePipeline(tenantId: string): Promise<{
  awaitingApproval: QuotePipelineBucket;
  draftReadyToSend: QuotePipelineBucket;
  approvedNotConverted: QuotePipelineBucket;
}> {
  const PREVIEW_LIMIT = 5;

  // 2026-04-26: isActive + deletedAt filters removed — quotes use
  // permanent-delete now, so a row's existence is the only liveness signal.
  const baseWhere = and(
    eq(quotes.companyId, tenantId),
  );

  // Shared select shape — customer name via the canonical COALESCE rule.
  const previewSelect = {
    id: quotes.id,
    quoteNumber: quotes.quoteNumber,
    title: quotes.title,
    total: quotes.total,
    sentAt: quotes.sentAt,
    updatedAt: quotes.updatedAt,
    createdAt: quotes.createdAt,
    approvedAt: quotes.approvedAt,
    customerCompanyName: customerCompanies.name,
    locationCompanyName: clients.companyName,
  };

  const [sentRows, draftRows, approvedRows] = await Promise.all([
    db
      .select(previewSelect)
      .from(quotes)
      .leftJoin(clients, eq(quotes.locationId, clients.id))
      .leftJoin(customerCompanies, eq(quotes.customerCompanyId, customerCompanies.id))
      .where(and(baseWhere, eq(quotes.status, "sent")))
      .orderBy(sql`${quotes.sentAt} ASC NULLS LAST`, desc(quotes.updatedAt))
      .limit(PREVIEW_LIMIT),
    db
      .select(previewSelect)
      .from(quotes)
      .leftJoin(clients, eq(quotes.locationId, clients.id))
      .leftJoin(customerCompanies, eq(quotes.customerCompanyId, customerCompanies.id))
      .where(and(baseWhere, eq(quotes.status, "draft")))
      .orderBy(sql`COALESCE(${quotes.updatedAt}, ${quotes.createdAt}) DESC`)
      .limit(PREVIEW_LIMIT),
    db
      .select(previewSelect)
      .from(quotes)
      .leftJoin(clients, eq(quotes.locationId, clients.id))
      .leftJoin(customerCompanies, eq(quotes.customerCompanyId, customerCompanies.id))
      .where(and(
        baseWhere,
        eq(quotes.status, "approved"),
        isNull(quotes.convertedToJobId),
      ))
      .orderBy(sql`${quotes.approvedAt} DESC NULLS LAST`)
      .limit(PREVIEW_LIMIT),
  ]);

  // Counts — single aggregated query so we don't pay for three separate
  // count round-trips alongside the three preview selects above.
  const countsRow = await db
    .select({
      sentCount: sql<number>`COUNT(*) FILTER (WHERE ${quotes.status} = 'sent')`,
      draftCount: sql<number>`COUNT(*) FILTER (WHERE ${quotes.status} = 'draft')`,
      approvedCount: sql<number>`
        COUNT(*) FILTER (
          WHERE ${quotes.status} = 'approved'
          AND ${quotes.convertedToJobId} IS NULL
        )
      `,
    })
    .from(quotes)
    .where(baseWhere);

  const toPreview = (rows: typeof sentRows, bucket: "sent" | "draft" | "approved") =>
    rows.map((r) => {
      const referenceAt =
        bucket === "sent"
          ? r.sentAt
          : bucket === "approved"
            ? r.approvedAt
            : r.updatedAt ?? r.createdAt;
      return {
        id: r.id,
        quoteNumber: r.quoteNumber ?? null,
        title: r.title ?? null,
        customerName: r.customerCompanyName ?? r.locationCompanyName ?? null,
        total: parseFloat(r.total ?? "0"),
        referenceAt: referenceAt instanceof Date
          ? referenceAt.toISOString()
          : (referenceAt ? String(referenceAt) : null),
      };
    });

  const c = countsRow[0] ?? { sentCount: 0, draftCount: 0, approvedCount: 0 };
  return {
    awaitingApproval: {
      count: Number(c.sentCount) || 0,
      preview: toPreview(sentRows, "sent"),
    },
    draftReadyToSend: {
      count: Number(c.draftCount) || 0,
      preview: toPreview(draftRows, "draft"),
    },
    approvedNotConverted: {
      count: Number(c.approvedCount) || 0,
      preview: toPreview(approvedRows, "approved"),
    },
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

  // 2026-04-22: relevance signal. Dashboard hides the PM card when the
  // tenant has no recurring templates at all. One lightweight EXISTS query
  // — cheaper than counting all instances and zero-allocation false when
  // the tenant has never used PM.
  const templatePresence = await db
    .select({ exists: sql<number>`1` })
    .from(recurringJobTemplates)
    .where(eq(recurringJobTemplates.companyId, tenantId))
    .limit(1);
  const hasAnyData = templatePresence.length > 0;

  return {
    awaitingGenerationCount: Number(c.awaitingGenerationCount) || 0,
    overdueCount: Number(c.overdueCount) || 0,
    comingDueCount: Number(c.comingDueCount) || 0,
    upcomingCount: Number(c.upcomingCount) || 0,
    hasAnyData,
  };
}

// ---------------------------------------------------------------------------
// PM-due Instances (Requires Attention drill-down)
//
// 2026-04-26: the "Requires attention" alert on the Business Dashboard
// now folds in PM (preventive-maintenance) instances that are eligible
// for job generation but have not been generated yet. The count is
// already exposed via `getPMCounts().awaitingGenerationCount`; this
// helper returns the row list the action modal needs to render
// "Generate job" / "View PM" buttons. The row filter mirrors the
// awaiting-generation count exactly so the dashboard tile and the
// modal list stay in lockstep by construction.
// ---------------------------------------------------------------------------

export interface DashboardPMDueInstance {
  /** recurring_job_instances.id — the row the generation route consumes. */
  instanceId: string;
  /** ISO date — the instance's scheduled date (instance_date). */
  instanceDate: string;
  /** True when the instance date is strictly before today (i.e. overdue). */
  isOverdue: boolean;
  templateId: string;
  templateTitle: string;
  /** Customer (parent) company. May be null when the location is linked
   *  directly without a parent (rare, but the FK allows it). */
  customerCompanyId: string | null;
  customerName: string | null;
  /** Service location. Always set — every PM template requires a location
   *  (or the instance was orphaned and is filtered out by the inner join). */
  locationId: string | null;
  locationName: string | null;
  locationDisplayName: string | null;
}

export async function getPMDueInstances(
  ctx: QueryCtx,
  limit: number = 50,
): Promise<DashboardPMDueInstance[]> {
  const today = new Date().toISOString().slice(0, 10);

  // Filter mirrors `getPMCounts().awaitingGenerationCount`:
  //   status='pending' AND generatedJobId IS NULL AND
  //   (instanceDate - serviceWindowDaysBefore) <= today.
  // Sort: overdue first (earliest instance date), then due-soon next.
  const rows = await ctx.db
    .select({
      instanceId: recurringJobInstances.id,
      instanceDate: recurringJobInstances.instanceDate,
      templateId: recurringJobTemplates.id,
      templateTitle: recurringJobTemplates.title,
      customerCompanyId: customerCompanies.id,
      customerName: customerCompanies.name,
      locationId: clients.id,
      locationName: clients.location,
      locationCompanyName: clients.companyName,
      locationDisplayName: locationDisplayNameExpr,
    })
    .from(recurringJobInstances)
    .innerJoin(
      recurringJobTemplates,
      eq(recurringJobInstances.templateId, recurringJobTemplates.id),
    )
    .leftJoin(clients, eq(recurringJobTemplates.locationId, clients.id))
    .leftJoin(customerCompanies, eq(clients.parentCompanyId, customerCompanies.id))
    .where(
      and(
        eq(recurringJobInstances.companyId, ctx.tenantId),
        eq(recurringJobTemplates.isActive, true),
        eq(recurringJobInstances.status, "pending"),
        isNull(recurringJobInstances.generatedJobId),
        sql`(${recurringJobInstances.instanceDate}::date - COALESCE(${recurringJobTemplates.serviceWindowDaysBefore}, 7)) <= ${today}::date`,
      ),
    )
    .orderBy(asc(recurringJobInstances.instanceDate))
    .limit(limit);

  return rows.map((r) => {
    // Drizzle's `date()` column type returns the value as a YYYY-MM-DD
    // string in this codebase. The `< today` comparison is therefore a
    // safe lexicographic compare on ISO date strings (`2026-04-25` <
    // `2026-04-26`).
    const dateStr = String(r.instanceDate);
    return {
      instanceId: r.instanceId,
      instanceDate: dateStr,
      isOverdue: dateStr < today,
      templateId: r.templateId,
      templateTitle: r.templateTitle,
      customerCompanyId: r.customerCompanyId,
      customerName: r.customerName,
      locationId: r.locationId,
      locationName: r.locationName ?? r.locationCompanyName,
      locationDisplayName: r.locationDisplayName,
    };
  });
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
    // 2026-04-19 Fix A: the 'requires_invoicing' tag and the
    // WHERE branch that admits completed jobs both now require zero
    // existing invoices. Jobs that are 'completed' but already have
    // invoices should NOT appear in the needs-attention stream.
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
            and(
              eq(jobs.status, "completed"),
              sql`NOT EXISTS (
                SELECT 1 FROM ${invoices}
                WHERE ${invoices.jobId} = ${jobs.id}
                  AND ${invoices.companyId} = ${jobs.companyId}
              )`,
            ),
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
  ar: {
    outstandingTotal: number;
    outstandingCount: number;
    pastDueTotal: number;
    pastDueCount: number;
    sentThisMonth: number;
    /**
     * 2026-04-21 Financial Dashboard: tenant-wide A/R aging buckets.
     * Amounts sum `invoices.balance` for unpaid invoices (awaiting_payment/
     * sent/partial_paid) grouped by due-date bucket. Hoisted from the
     * per-client variant in customerCompanies.getBillingAggregatesForLocations
     * so the dashboard single-source-of-truths the same aging math.
     */
    aging: {
      current: number;
      d1_30: number;
      d31_60: number;
      d61_90: number;
      d90plus: number;
    };
  };
  quotes: {
    sent: number;
    approved: number;
    conversionRate: number;
    avgValue: number;
    /** 2026-04-21: SUM(total) of status='approved' quotes — "approved-not-converted" pipeline value. */
    approvedTotal: number;
  };
  pm: { contractCount: number; totalContractValue: number };
  /** 2026-04-21 Financial Dashboard: draft invoices (count + SUM(total)). */
  draft: { count: number; total: number };
  /** 2026-04-21 Financial Dashboard: workflow pipeline counts — mirrors getWorkflowSummary so the Financial Dashboard can render the same signals without a second round-trip. */
  pipeline: {
    /** status='completed' AND no invoices exist — reuses requiresInvoicingCount predicate. */
    readyToInvoiceCount: number;
    /** quotes with status='approved' (pre-conversion). */
    approvedQuotesNotConvertedCount: number;
  };
  /** 2026-04-21 Financial Dashboard: top 10 outstanding invoices by balance. */
  topOutstandingInvoices: {
    id: string;
    invoiceNumber: string | null;
    customerName: string | null;
    locationName: string | null;
    dueDate: string | null;
    balance: number;
    status: string | null;
    daysLate: number | null;
    /** customerCompanyId: used to open ClientCollectionsModal from dashboard rows. */
    customerCompanyId: string | null;
  }[];
  /** 2026-04-21 Financial Dashboard: top 10 customer balances. */
  topCustomerBalances: {
    customerCompanyId: string;
    name: string | null;
    outstanding: number;
    overdue: number;
    openCount: number;
  }[];
  /**
   * 2026-04-21 V1.1: actionable preview of draft invoices (6 most recent).
   * Replaces the former Draft KPI tile — users want rows they can click,
   * not a count. Sourced from status='draft'; server-side limited.
   */
  draftInvoicesPreview: {
    id: string;
    invoiceNumber: string | null;
    customerName: string | null;
    locationName: string | null;
    total: number;
    createdAt: string | null;
  }[];
  /**
   * 2026-04-21 V1.1: actionable preview of jobs ready to invoice (6 most
   * recently completed). Predicate IDENTICAL to getJobCounts.requiresInvoicingCount
   * and jobsFeed.readyToInvoiceOnly — status='completed' AND no invoice
   * exists for the job. Single source of truth so the preview, the dashboard
   * count, and `/jobs?readyToInvoiceOnly=true` all agree row-for-row.
   */
  readyToInvoiceJobsPreview: {
    id: string;
    jobNumber: number;
    summary: string | null;
    customerName: string | null;
    locationName: string | null;
    completedAt: string | null;
  }[];
  /**
   * 2026-04-23: 5 most recent inbound payments across the tenant. Feeds the
   * Solo / owner-operator dashboard's "Recent Payments" card. Refunds /
   * reversals (amount ≤ 0) are excluded — this is cash-in, not net ledger.
   */
  recentPayments: {
    id: string;
    amount: number;
    method: string | null;
    receivedAt: string | null;
    invoiceId: string;
    invoiceNumber: string | null;
    customerName: string | null;
    locationName: string | null;
  }[];
  /**
   * 2026-05-06 dashboard restructure: Pipeline Snapshot card data.
   * `conversionRateMonth` is null when there were zero leads created this
   * month (no denominator → display "—" not "0%"). `staleLeadsValue` is the
   * SUM of `estimatedValue` for the matching rows; nulls treated as zero.
   */
  pipelineSnapshot: {
    // 2026-05-06 (legacy fields, kept for backward compatibility with
    // any surface still consuming them — the dashboard card itself now
    // reads the actionable bucket fields below).
    leadsCount: number;
    leadsValue: number;
    quotesSentCount: number;
    quotesSentValue: number;
    awaitingFollowUpCount: number;
    awaitingFollowUpValue: number;
    conversionRateMonth: number | null;
    staleLeadsCount: number;
    staleLeadsValue: number;

    // 2026-05-06 RALPH actionable Pipeline buckets. Each maps 1:1 to a
    // dashboard action-modal mode (pipeline_leads_followup,
    // pipeline_quotes_not_sent, pipeline_quotes_awaiting_response,
    // pipeline_stale_opportunities). Counts are tenant-scoped, exclude
    // closed/lost/converted records, and use the SAME predicates the
    // server-side bucket filters in the leads + quotes route layers
    // use — so the card's count and the modal's drill-down list stay
    // in lockstep by construction.
    /** Open leads needing contact: status IN ('new','contacted','needs_review'). */
    leadsFollowUpCount: number;
    leadsFollowUpValue: number;
    /** Quotes created but never sent: status='draft'. */
    quotesNotSentCount: number;
    quotesNotSentValue: number;
    /** Quotes sent but not yet accepted/declined/converted: status='sent'. */
    quotesAwaitingResponseCount: number;
    quotesAwaitingResponseValue: number;
    /**
     * Stale opportunities — open leads OR open quotes whose last activity
     * (`COALESCE(updated_at, created_at)`) is older than 14 days.
     * Intentionally an OVERLAY over the per-bucket rows above: the same
     * lead may appear in both Leads-Needing-Follow-Up (current state)
     * AND Stale Opportunities (aging escalation). This is by design —
     * stale rows are a time-based escalation of the per-bucket rows,
     * not a separate set of records.
     */
    staleOpportunitiesCount: number;
    staleOpportunitiesValue: number;
  };
  /**
   * 2026-05-06 dashboard restructure: Scheduled Revenue card data.
   * Per-job value resolution: `invoices.total` when linked → else
   * `quotes.total` (quote status in {approved, converted, sent}). Jobs
   * with no reliable value (NULL after coalesce, or zero) are EXCLUDED
   * from totals and from `upcomingHighValueJobs`.
   */
  scheduledRevenue: {
    todayValue: number;
    next7DaysValue: number;
    next30DaysValue: number;
    upcomingHighValueJobs: {
      id: string;
      jobNumber: number;
      summary: string | null;
      customerName: string | null;
      locationName: string | null;
      scheduledStart: string | null;
      value: number;
    }[];
  };
  /**
   * 2026-05-06 dashboard restructure: Needs Attention card data. Explicitly
   * does NOT include "completed jobs not invoiced" — that lives in
   * Operational Alerts → Ready to Invoice. Payments-pending was evaluated
   * and SKIPPED because `payments` table has no status column (atomic
   * ledger entries, not pending receivables).
   */
  needsAttention: {
    invoicesNotSentCount: number;
    invoicesNotSentValue: number;
    quotesNotFollowedUpCount: number;
    quotesNotFollowedUpValue: number;
    leadsNotConvertedCount: number;
    leadsNotConvertedValue: number;
  };
}

// ---------------------------------------------------------------------------
// 2026-05-06 dashboard restructure helpers — Pipeline / Scheduled Revenue /
// Needs Attention. Each is a pure tenant-scoped read; no schema changes.
// All three are called in parallel from `getFinancialSummary` below.
// ---------------------------------------------------------------------------

async function getPipelineSnapshot(
  companyId: string,
  monthStart: Date,
): Promise<FinancialSummary["pipelineSnapshot"]> {
  // Single round-trip aggregate. CTEs separate each bucket so the
  // query stays readable. NULL `estimated_value` / `total` → 0.
  //
  // 2026-05-06 RALPH: extends the prior aggregate with four actionable
  // buckets used by the redesigned Pipeline card. The legacy buckets
  // remain so existing surfaces / tests don't break. Stale-opportunity
  // SQL deliberately uses the same predicates the leads + quotes route
  // layer's `bucket=` filters use — modal counts and drill-down rows
  // stay in lockstep without a parallel data path.
  const result = await db.execute(sql`
    WITH lead_agg AS (
      SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(CAST(estimated_value AS numeric)), 0)::text AS value,
        COUNT(*) FILTER (WHERE created_at >= ${monthStart})::int AS month_total,
        COUNT(*) FILTER (
          WHERE created_at >= ${monthStart}
            AND status IN ('quoted', 'won')
        )::int AS month_converted
      FROM leads
      WHERE company_id = ${companyId}
        AND is_active = true
        AND status NOT IN ('lost')
    ),
    quotes_sent AS (
      SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(CAST(total AS numeric)), 0)::text AS value
      FROM quotes
      WHERE company_id = ${companyId}
        AND status = 'sent'
    ),
    quotes_stale AS (
      SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(CAST(total AS numeric)), 0)::text AS value
      FROM quotes
      WHERE company_id = ${companyId}
        AND status = 'sent'
        AND sent_at < NOW() - INTERVAL '7 days'
    ),
    stale_leads AS (
      SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(CAST(l.estimated_value AS numeric)), 0)::text AS value
      FROM leads l
      WHERE l.company_id = ${companyId}
        AND l.is_active = true
        AND l.status NOT IN ('quoted', 'won', 'lost')
        AND l.created_at < NOW() - INTERVAL '7 days'
        AND NOT EXISTS (
          SELECT 1 FROM lead_visits lv
          WHERE lv.lead_id = l.id
            AND lv.scheduled_start IS NOT NULL
        )
    ),
    -- 2026-05-06 RALPH: actionable bucket aggregates ----------------
    leads_followup AS (
      -- Open leads needing contact: status in the early-pipeline set.
      -- Excludes 'quoted' (already progressed to a quote), 'won', 'lost'.
      SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(CAST(estimated_value AS numeric)), 0)::text AS value
      FROM leads
      WHERE company_id = ${companyId}
        AND is_active = true
        AND status IN ('new', 'contacted', 'needs_review')
    ),
    quotes_not_sent AS (
      -- Draft quotes — created but never sent to the customer.
      SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(CAST(total AS numeric)), 0)::text AS value
      FROM quotes
      WHERE company_id = ${companyId}
        AND status = 'draft'
    ),
    quotes_awaiting AS (
      -- Sent quotes — waiting on customer accept/decline/conversion.
      -- Same row set as quotes_sent above; aliased here for clarity in
      -- the SELECT projection.
      SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(CAST(total AS numeric)), 0)::text AS value
      FROM quotes
      WHERE company_id = ${companyId}
        AND status = 'sent'
    ),
    stale_opps AS (
      -- Stale opportunities = open leads OR open quotes (draft/sent)
      -- whose last activity (COALESCE(updated_at, created_at)) is older
      -- than 14 days. Counts both lead and quote rows in a single sum;
      -- the modal's drill-down splits them back by record type.
      SELECT
        SUM(stale_count)::int AS count,
        COALESCE(SUM(stale_value), 0)::text AS value
      FROM (
        SELECT
          COUNT(*)::int AS stale_count,
          COALESCE(SUM(CAST(estimated_value AS numeric)), 0) AS stale_value
        FROM leads
        WHERE company_id = ${companyId}
          AND is_active = true
          AND status IN ('new', 'contacted', 'needs_review')
          AND COALESCE(updated_at, created_at) < NOW() - INTERVAL '14 days'
        UNION ALL
        SELECT
          COUNT(*)::int AS stale_count,
          COALESCE(SUM(CAST(total AS numeric)), 0) AS stale_value
        FROM quotes
        WHERE company_id = ${companyId}
          AND status IN ('draft', 'sent')
          AND COALESCE(updated_at, created_at) < NOW() - INTERVAL '14 days'
      ) combined
    )
    SELECT
      lead_agg.count          AS leads_count,
      lead_agg.value          AS leads_value,
      lead_agg.month_total    AS month_total,
      lead_agg.month_converted AS month_converted,
      quotes_sent.count       AS quotes_sent_count,
      quotes_sent.value       AS quotes_sent_value,
      quotes_stale.count      AS awaiting_followup_count,
      quotes_stale.value      AS awaiting_followup_value,
      stale_leads.count       AS stale_leads_count,
      stale_leads.value       AS stale_leads_value,
      leads_followup.count    AS leads_followup_count,
      leads_followup.value    AS leads_followup_value,
      quotes_not_sent.count   AS quotes_not_sent_count,
      quotes_not_sent.value   AS quotes_not_sent_value,
      quotes_awaiting.count   AS quotes_awaiting_count,
      quotes_awaiting.value   AS quotes_awaiting_value,
      stale_opps.count        AS stale_opps_count,
      stale_opps.value        AS stale_opps_value
    FROM lead_agg, quotes_sent, quotes_stale, stale_leads,
         leads_followup, quotes_not_sent, quotes_awaiting, stale_opps
  `);
  const row: any = (result as any).rows?.[0] ?? (Array.isArray(result) ? result[0] : null);
  const monthTotal = row?.month_total ?? 0;
  const monthConverted = row?.month_converted ?? 0;
  const conversionRateMonth = monthTotal > 0
    ? Math.round((monthConverted / monthTotal) * 1000) / 10
    : null;
  return {
    leadsCount: row?.leads_count ?? 0,
    leadsValue: parseFloat(row?.leads_value ?? "0"),
    quotesSentCount: row?.quotes_sent_count ?? 0,
    quotesSentValue: parseFloat(row?.quotes_sent_value ?? "0"),
    awaitingFollowUpCount: row?.awaiting_followup_count ?? 0,
    awaitingFollowUpValue: parseFloat(row?.awaiting_followup_value ?? "0"),
    conversionRateMonth,
    staleLeadsCount: row?.stale_leads_count ?? 0,
    staleLeadsValue: parseFloat(row?.stale_leads_value ?? "0"),
    leadsFollowUpCount: row?.leads_followup_count ?? 0,
    leadsFollowUpValue: parseFloat(row?.leads_followup_value ?? "0"),
    quotesNotSentCount: row?.quotes_not_sent_count ?? 0,
    quotesNotSentValue: parseFloat(row?.quotes_not_sent_value ?? "0"),
    quotesAwaitingResponseCount: row?.quotes_awaiting_count ?? 0,
    quotesAwaitingResponseValue: parseFloat(row?.quotes_awaiting_value ?? "0"),
    staleOpportunitiesCount: row?.stale_opps_count ?? 0,
    staleOpportunitiesValue: parseFloat(row?.stale_opps_value ?? "0"),
  };
}

async function getScheduledRevenue(
  companyId: string,
  todayStart: Date,
): Promise<FinancialSummary["scheduledRevenue"]> {
  // Window: [today, today + 30 days). Per-job value resolution prefers
  // invoice total (linked), then quote total (status approved/converted/
  // sent). Jobs with no reliable value (resolved value NULL or 0) are
  // EXCLUDED from totals and from the high-value list.
  const window30End = new Date(todayStart.getTime() + 30 * 86400000);
  const window7End = new Date(todayStart.getTime() + 7 * 86400000);
  const window1End = new Date(todayStart.getTime() + 1 * 86400000);
  const result = await db.execute(sql`
    SELECT
      j.id,
      j.job_number AS "jobNumber",
      j.summary,
      j.scheduled_start AS "scheduledStart",
      cc.name AS "customerName",
      cl.company_name AS "locationName",
      COALESCE(
        CAST(inv.total AS numeric),
        CASE
          WHEN q.status IN ('approved', 'converted', 'sent')
            THEN CAST(q.total AS numeric)
          ELSE NULL
        END
      )::text AS value
    FROM jobs j
    LEFT JOIN invoices inv ON inv.id = j.invoice_id
    LEFT JOIN quotes q ON q.converted_to_job_id = j.id
    LEFT JOIN client_locations cl ON cl.id = j.location_id
    LEFT JOIN customer_companies cc ON cc.id = cl.parent_company_id
    WHERE j.company_id = ${companyId}
      AND j.scheduled_start >= ${todayStart}
      AND j.scheduled_start < ${window30End}
      AND j.status NOT IN ('cancelled', 'voided')
      AND COALESCE(
        CAST(inv.total AS numeric),
        CASE
          WHEN q.status IN ('approved', 'converted', 'sent')
            THEN CAST(q.total AS numeric)
          ELSE NULL
        END
      ) > 0
    ORDER BY value DESC NULLS LAST
  `);
  const rows: any[] = ((result as any).rows ?? (Array.isArray(result) ? result : [])) as any[];
  let todayValue = 0;
  let next7DaysValue = 0;
  let next30DaysValue = 0;
  for (const r of rows) {
    const v = parseFloat(r.value ?? "0");
    if (!Number.isFinite(v) || v <= 0) continue;
    next30DaysValue += v;
    const start = r.scheduledStart ? new Date(r.scheduledStart) : null;
    if (!start) continue;
    if (start < window7End) next7DaysValue += v;
    if (start < window1End) todayValue += v;
  }
  const upcomingHighValueJobs = rows.slice(0, 3).map((r: any) => ({
    id: r.id,
    jobNumber: r.jobNumber,
    summary: r.summary,
    customerName: r.customerName,
    locationName: r.locationName,
    scheduledStart: r.scheduledStart instanceof Date
      ? r.scheduledStart.toISOString()
      : (r.scheduledStart ?? null),
    value: parseFloat(r.value ?? "0"),
  }));
  return {
    todayValue: Math.round(todayValue * 100) / 100,
    next7DaysValue: Math.round(next7DaysValue * 100) / 100,
    next30DaysValue: Math.round(next30DaysValue * 100) / 100,
    upcomingHighValueJobs,
  };
}

async function getNeedsAttention(
  companyId: string,
): Promise<FinancialSummary["needsAttention"]> {
  // Three independent buckets in one round-trip via CTEs.
  // - invoicesNotSent: status='draft'
  // - quotesNotFollowedUp: status='sent' AND sent_at < NOW() - 7 days
  // - leadsNotConverted: created > 14 days ago, status NOT in {quoted,won,lost},
  //   no scheduled lead_visit (NOT EXISTS).
  const result = await db.execute(sql`
    WITH inv_draft AS (
      SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(CAST(total AS numeric)), 0)::text AS value
      FROM invoices
      WHERE company_id = ${companyId}
        AND status = 'draft'
    ),
    quotes_stale AS (
      SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(CAST(total AS numeric)), 0)::text AS value
      FROM quotes
      WHERE company_id = ${companyId}
        AND status = 'sent'
        AND sent_at < NOW() - INTERVAL '7 days'
    ),
    leads_stale AS (
      SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(CAST(l.estimated_value AS numeric)), 0)::text AS value
      FROM leads l
      WHERE l.company_id = ${companyId}
        AND l.is_active = true
        AND l.status NOT IN ('quoted', 'won', 'lost')
        AND l.created_at < NOW() - INTERVAL '14 days'
        AND NOT EXISTS (
          SELECT 1 FROM lead_visits lv
          WHERE lv.lead_id = l.id
            AND lv.scheduled_start IS NOT NULL
        )
    )
    SELECT
      inv_draft.count    AS invoices_not_sent_count,
      inv_draft.value    AS invoices_not_sent_value,
      quotes_stale.count AS quotes_stale_count,
      quotes_stale.value AS quotes_stale_value,
      leads_stale.count  AS leads_stale_count,
      leads_stale.value  AS leads_stale_value
    FROM inv_draft, quotes_stale, leads_stale
  `);
  const row: any = (result as any).rows?.[0] ?? (Array.isArray(result) ? result[0] : null);
  return {
    invoicesNotSentCount: row?.invoices_not_sent_count ?? 0,
    invoicesNotSentValue: parseFloat(row?.invoices_not_sent_value ?? "0"),
    quotesNotFollowedUpCount: row?.quotes_stale_count ?? 0,
    quotesNotFollowedUpValue: parseFloat(row?.quotes_stale_value ?? "0"),
    leadsNotConvertedCount: row?.leads_stale_count ?? 0,
    leadsNotConvertedValue: parseFloat(row?.leads_stale_value ?? "0"),
  };
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

  // P3-01: All reads are independent — dispatch concurrently via single Promise.all.
  // 2026-04-21 Financial Dashboard: added aging/topInvoices/topCustomers/draft/
  // readyToInvoice queries. Still one round-trip; each query is indexed.
  const UNPAID = UNPAID_INVOICE_STATUSES;
  const unpaidRaw = sql.raw(UNPAID_INVOICE_STATUS_SQL);

  const [
    revenueToday, revenueWeek, revenueMonth, revenueLastMonth,
    trendRows, arRows, pastDueRows, sentThisMonthRows, quoteRows, pmRows,
    agingRows, topInvoiceRows, topCustomerRows, draftRows, readyToInvoiceRows,
    draftPreviewRows, readyToInvoicePreviewRows,
    recentPaymentRows,
    // 2026-05-06 dashboard restructure — three new aggregates run in
    // parallel with the existing query set.
    pipelineSnapshotData,
    scheduledRevenueData,
    needsAttentionData,
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
    // 2026-04-09: invoices.isActive guard removed (permanent-delete model)
    db.select({
      status: invoices.status,
      count: sql<number>`count(*)::int`,
      totalBalance: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)), 0)::text`,
    }).from(invoices)
      .where(and(
        eq(invoices.companyId, companyId),
        inArray(invoices.status, UNPAID),
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
        sql`CAST(${invoices.balance} AS numeric) > 0`,
        sql`${invoices.dueDate} < CURRENT_DATE`,
      )),

    // Invoices sent this month
    db.select({
      count: sql<number>`count(*)::int`,
    }).from(invoices)
      .where(and(
        eq(invoices.companyId, companyId),
        gte(invoices.sentAt, monthStart),
      )),

    // Quote pipeline
    db.select({
      status: quotes.status,
      count: sql<number>`count(*)::int`,
      total: sql<string>`COALESCE(SUM(CAST(${quotes.total} AS numeric)), 0)::text`,
    }).from(quotes)
      .where(eq(quotes.companyId, companyId))
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

    // 2026-04-21 A/R aging (tenant-wide, 5 buckets). Same predicate family
    // as getBillingAggregatesForLocations — unpaid statuses, balance by
    // due-date bracket. Hoisted here so the financial dashboard single-
    // round-trips all AR signals.
    db.select({
      current: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)) FILTER (
        WHERE ${invoices.status} IN (${unpaidRaw})
          AND (${invoices.dueDate} IS NULL OR ${invoices.dueDate} >= CURRENT_DATE)
      ), 0)::text`,
      d1_30: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)) FILTER (
        WHERE ${invoices.status} IN (${unpaidRaw})
          AND ${invoices.dueDate} < CURRENT_DATE
          AND ${invoices.dueDate} >= CURRENT_DATE - INTERVAL '30 days'
      ), 0)::text`,
      d31_60: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)) FILTER (
        WHERE ${invoices.status} IN (${unpaidRaw})
          AND ${invoices.dueDate} < CURRENT_DATE - INTERVAL '30 days'
          AND ${invoices.dueDate} >= CURRENT_DATE - INTERVAL '60 days'
      ), 0)::text`,
      d61_90: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)) FILTER (
        WHERE ${invoices.status} IN (${unpaidRaw})
          AND ${invoices.dueDate} < CURRENT_DATE - INTERVAL '60 days'
          AND ${invoices.dueDate} >= CURRENT_DATE - INTERVAL '90 days'
      ), 0)::text`,
      d90plus: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)) FILTER (
        WHERE ${invoices.status} IN (${unpaidRaw})
          AND ${invoices.dueDate} < CURRENT_DATE - INTERVAL '90 days'
      ), 0)::text`,
    }).from(invoices)
      .where(and(
        eq(invoices.companyId, companyId),
        sql`CAST(${invoices.balance} AS numeric) > 0`,
      )),

    // 2026-04-21 Top 10 outstanding invoices (by balance desc). Joins
    // client_locations + customer_companies for display names. Overdue
    // is derived client-side from dueDate + daysLate.
    db.select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      dueDate: invoices.dueDate,
      balance: invoices.balance,
      status: invoices.status,
      customerName: customerCompanies.name,
      locationCompanyName: clients.companyName,
      locationName: clients.location,
      customerCompanyId: customerCompanies.id,
    }).from(invoices)
      .leftJoin(clients, eq(invoices.locationId, clients.id))
      .leftJoin(customerCompanies, eq(invoices.customerCompanyId, customerCompanies.id))
      .where(and(
        eq(invoices.companyId, companyId),
        inArray(invoices.status, UNPAID),
        sql`CAST(${invoices.balance} AS numeric) > 0`,
      ))
      .orderBy(sql`CAST(${invoices.balance} AS numeric) DESC`)
      .limit(10),

    // 2026-04-21 Top 10 customer balances. Group by customer_company, sum
    // unpaid balance per customer. HAVING > 0 excludes zero-balance rows
    // that would appear for customers whose only invoices are paid.
    db.select({
      customerCompanyId: customerCompanies.id,
      name: customerCompanies.name,
      outstanding: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)) FILTER (
        WHERE ${invoices.status} IN (${unpaidRaw}) AND CAST(${invoices.balance} AS numeric) > 0
      ), 0)::text`,
      overdue: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)) FILTER (
        WHERE ${invoices.status} IN (${unpaidRaw}) AND CAST(${invoices.balance} AS numeric) > 0
          AND ${invoices.dueDate} IS NOT NULL AND ${invoices.dueDate} < CURRENT_DATE
      ), 0)::text`,
      openCount: sql<number>`COUNT(*) FILTER (
        WHERE ${invoices.status} IN (${unpaidRaw}) AND CAST(${invoices.balance} AS numeric) > 0
      )::int`,
    }).from(customerCompanies)
      .innerJoin(invoices, eq(invoices.customerCompanyId, customerCompanies.id))
      .where(and(
        eq(customerCompanies.companyId, companyId),
        eq(invoices.companyId, companyId),
      ))
      .groupBy(customerCompanies.id, customerCompanies.name)
      .having(sql`COALESCE(SUM(CAST(${invoices.balance} AS numeric)) FILTER (
        WHERE ${invoices.status} IN (${unpaidRaw}) AND CAST(${invoices.balance} AS numeric) > 0
      ), 0) > 0`)
      .orderBy(sql`COALESCE(SUM(CAST(${invoices.balance} AS numeric)) FILTER (
        WHERE ${invoices.status} IN (${unpaidRaw}) AND CAST(${invoices.balance} AS numeric) > 0
      ), 0) DESC`)
      .limit(10),

    // 2026-04-21 Draft invoices — count + sum(total). Draft balance is
    // typically zero pre-send, so total is the meaningful value.
    db.select({
      count: sql<number>`count(*)::int`,
      total: sql<string>`COALESCE(SUM(CAST(${invoices.total} AS numeric)), 0)::text`,
    }).from(invoices)
      .where(and(
        eq(invoices.companyId, companyId),
        eq(invoices.status, "draft"),
      )),

    // 2026-04-21 Ready-to-invoice job count. Predicate IDENTICAL to
    // getWorkflowSummary.getJobCounts.requiresInvoicingCount — must stay
    // in lockstep. Bypass activeJobFilter on job lookup of invoices is
    // fine because NOT EXISTS only checks count, not visibility.
    db.select({
      count: sql<number>`COUNT(*) FILTER (WHERE ${jobs.status} = 'completed'
        AND NOT EXISTS (
          SELECT 1 FROM ${invoices}
          WHERE ${invoices.jobId} = ${jobs.id}
            AND ${invoices.companyId} = ${jobs.companyId}
        ))::int`,
    }).from(jobs)
      .where(and(
        eq(jobs.companyId, companyId),
        activeJobFilter(),
      )),

    // 2026-04-21 V1.1 Draft invoices preview — 6 most recent drafts with
    // customer + location resolved. Joins match the patterns used by
    // invoicesFeed + getBillingAggregatesForLocations so display names
    // follow the canonical COALESCE(customerCompanies.name, clients.companyName).
    db.select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      total: invoices.total,
      createdAt: invoices.createdAt,
      customerName: customerCompanies.name,
      locationCompanyName: clients.companyName,
      locationName: clients.location,
    }).from(invoices)
      .leftJoin(clients, eq(invoices.locationId, clients.id))
      .leftJoin(customerCompanies, eq(invoices.customerCompanyId, customerCompanies.id))
      .where(and(
        eq(invoices.companyId, companyId),
        eq(invoices.status, "draft"),
      ))
      .orderBy(desc(invoices.createdAt))
      .limit(6),

    // 2026-04-21 V1.1 Ready-to-invoice preview — up to 6 jobs whose
    // NOT EXISTS invoice check passes. Predicate byte-identical to
    // getJobCounts.requiresInvoicingCount (above) and jobsFeed.readyToInvoiceOnly;
    // only the return shape differs. activeJobFilter() applied so soft-
    // deleted jobs cannot leak into the preview.
    // 2026-04-21 V1.2: sort ASC (oldest completion first) so the backlog
    // surfaces the jobs waiting longest for an invoice — matches the
    // "work the oldest first" workflow priority. NULLS LAST so rows
    // without a closedAt/updatedAt don't poison the top.
    db.select({
      id: jobs.id,
      jobNumber: jobs.jobNumber,
      summary: jobs.summary,
      closedAt: jobs.closedAt,
      updatedAt: jobs.updatedAt,
      customerName: customerCompanies.name,
      locationCompanyName: clients.companyName,
      locationName: clients.location,
    }).from(jobs)
      .leftJoin(clients, eq(jobs.locationId, clients.id))
      .leftJoin(customerCompanies, eq(clients.parentCompanyId, customerCompanies.id))
      .where(and(
        eq(jobs.companyId, companyId),
        activeJobFilter(),
        eq(jobs.status, "completed"),
        sql`NOT EXISTS (
          SELECT 1 FROM ${invoices}
          WHERE ${invoices.jobId} = ${jobs.id}
            AND ${invoices.companyId} = ${jobs.companyId}
        )`,
      ))
      .orderBy(sql`COALESCE(${jobs.closedAt}, ${jobs.updatedAt}) ASC NULLS LAST`)
      .limit(6),

    // 2026-04-23 Solo dashboard: 5 most recent inbound payments with
    // invoice + customer resolved via the same join topology used by the
    // top-outstanding / draft-preview queries above. `amount > 0` excludes
    // refund / reversal rows (stored as negatives) so the "Recent Payments"
    // card is cash-in only.
    db.select({
      id: payments.id,
      amount: payments.amount,
      method: payments.method,
      receivedAt: payments.receivedAt,
      invoiceId: payments.invoiceId,
      invoiceNumber: invoices.invoiceNumber,
      customerName: customerCompanies.name,
      locationCompanyName: clients.companyName,
      locationName: clients.location,
    }).from(payments)
      .innerJoin(invoices, and(
        eq(payments.invoiceId, invoices.id),
        eq(invoices.companyId, companyId),
      ))
      .leftJoin(clients, eq(invoices.locationId, clients.id))
      .leftJoin(customerCompanies, eq(invoices.customerCompanyId, customerCompanies.id))
      .where(and(
        eq(payments.companyId, companyId),
        sql`CAST(${payments.amount} AS numeric) > 0`,
      ))
      .orderBy(desc(payments.receivedAt))
      .limit(5),

    // 2026-05-06 dashboard restructure helpers (run in parallel).
    getPipelineSnapshot(companyId, monthStart),
    getScheduledRevenue(companyId, todayStart),
    getNeedsAttention(companyId),
  ]);

  // Post-query derivations
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

  const agingRow = agingRows[0];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const topOutstandingInvoices = topInvoiceRows.map((r: any) => {
    let daysLate: number | null = null;
    if (r.dueDate) {
      const due = new Date(r.dueDate);
      due.setHours(0, 0, 0, 0);
      const diff = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
      daysLate = diff > 0 ? diff : 0;
    }
    return {
      id: r.id,
      invoiceNumber: r.invoiceNumber ?? null,
      // Prefer customerCompanies.name, fall back to location's companyName (same
      // COALESCE rule as `locationDisplayNameExpr` elsewhere in the codebase).
      customerName: r.customerName ?? r.locationCompanyName ?? null,
      locationName: r.locationName ?? null,
      dueDate: r.dueDate ? String(r.dueDate) : null,
      balance: parseFloat(r.balance ?? "0"),
      status: r.status ?? null,
      daysLate,
      customerCompanyId: r.customerCompanyId ?? null,
    };
  });

  const topCustomerBalances = topCustomerRows.map((r: any) => ({
    customerCompanyId: r.customerCompanyId,
    name: r.name ?? null,
    outstanding: parseFloat(r.outstanding ?? "0"),
    overdue: parseFloat(r.overdue ?? "0"),
    openCount: Number(r.openCount ?? 0),
  }));

  // 2026-04-21 V1.1: preview list mappers. customerName follows the
  // canonical COALESCE(customerCompanies.name, clients.companyName) rule.
  const draftInvoicesPreview = draftPreviewRows.map((r: any) => ({
    id: r.id,
    invoiceNumber: r.invoiceNumber ?? null,
    customerName: r.customerName ?? r.locationCompanyName ?? null,
    locationName: r.locationName ?? null,
    total: parseFloat(r.total ?? "0"),
    createdAt: r.createdAt instanceof Date
      ? r.createdAt.toISOString()
      : (r.createdAt ? String(r.createdAt) : null),
  }));

  const readyToInvoiceJobsPreview = readyToInvoicePreviewRows.map((r: any) => {
    const completedAt = r.closedAt ?? r.updatedAt ?? null;
    return {
      id: r.id,
      jobNumber: r.jobNumber,
      summary: r.summary ?? null,
      customerName: r.customerName ?? r.locationCompanyName ?? null,
      locationName: r.locationName ?? null,
      completedAt: completedAt instanceof Date
        ? completedAt.toISOString()
        : (completedAt ? String(completedAt) : null),
    };
  });

  const recentPayments = recentPaymentRows.map((r: any) => ({
    id: r.id,
    amount: parseFloat(r.amount ?? "0"),
    method: r.method ?? null,
    receivedAt: r.receivedAt instanceof Date
      ? r.receivedAt.toISOString()
      : (r.receivedAt ? String(r.receivedAt) : null),
    invoiceId: r.invoiceId,
    invoiceNumber: r.invoiceNumber ?? null,
    customerName: r.customerName ?? r.locationCompanyName ?? null,
    locationName: r.locationName ?? null,
  }));

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
      aging: {
        current: parseFloat(agingRow?.current ?? "0"),
        d1_30: parseFloat(agingRow?.d1_30 ?? "0"),
        d31_60: parseFloat(agingRow?.d31_60 ?? "0"),
        d61_90: parseFloat(agingRow?.d61_90 ?? "0"),
        d90plus: parseFloat(agingRow?.d90plus ?? "0"),
      },
    },
    quotes: {
      sent: quotePipeline["sent"]?.count ?? 0,
      approved: quotePipeline["approved"]?.count ?? 0,
      conversionRate: Math.round(conversionRate * 10) / 10,
      avgValue: Math.round(avgQuoteValue * 100) / 100,
      approvedTotal: quotePipeline["approved"]?.total ?? 0,
    },
    pm: {
      contractCount: pmRows[0]?.count ?? 0,
      totalContractValue: parseFloat(pmRows[0]?.totalContractValue ?? "0"),
    },
    draft: {
      count: draftRows[0]?.count ?? 0,
      total: parseFloat(draftRows[0]?.total ?? "0"),
    },
    pipeline: {
      readyToInvoiceCount: readyToInvoiceRows[0]?.count ?? 0,
      approvedQuotesNotConvertedCount: quotePipeline["approved"]?.count ?? 0,
    },
    topOutstandingInvoices,
    topCustomerBalances,
    draftInvoicesPreview,
    readyToInvoiceJobsPreview,
    recentPayments,
    pipelineSnapshot: pipelineSnapshotData,
    scheduledRevenue: scheduledRevenueData,
    needsAttention: needsAttentionData,
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
