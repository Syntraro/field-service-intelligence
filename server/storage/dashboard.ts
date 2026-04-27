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

import { jobs, invoices, clientLocations as clients, customerCompanies, recurringJobInstances, recurringJobTemplates, quotes, payments } from "@shared/schema";
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
