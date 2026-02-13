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
 * - needs_review - Needs supervisor review
 */

import { jobs, invoices, clientLocations as clients, customerCompanies } from "@shared/schema";
import { eq, and, or, sql, asc } from "drizzle-orm";
import type { QueryCtx } from "../lib/queryCtx";
import { activeJobFilter } from "./jobFilters";
import { activeInvoiceFilter } from "./invoicesFeed";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Workflow summary for the Dashboard strip. */
export interface WorkflowSummary {
  quotes: { approvedCount: number; draftCount: number };
  jobs: { requiresInvoicingCount: number; activeCount: number; onHoldCount: number };
  invoices: { outstandingCount: number; pastDueCount: number };
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
  const [jobCounts, invoiceCounts] = await Promise.all([
    getJobCounts(ctx),
    getInvoiceCounts(ctx),
  ]);

  return {
    quotes: { approvedCount: 0, draftCount: 0 }, // No quotes table
    jobs: jobCounts,
    invoices: invoiceCounts,
    fourth: null,
  };
}

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
    })
    .from(jobs)
    .where(and(eq(jobs.companyId, ctx.tenantId), activeJobFilter()));

  const c = result[0] || { requiresInvoicingCount: 0, activeCount: 0, onHoldCount: 0 };
  return {
    requiresInvoicingCount: Number(c.requiresInvoicingCount) || 0,
    activeCount: Number(c.activeCount) || 0,
    onHoldCount: Number(c.onHoldCount) || 0,
  };
}

async function getInvoiceCounts(ctx: QueryCtx) {
  const today = new Date().toISOString().slice(0, 10);

  const result = await ctx.db
    .select({
      outstandingCount: sql<number>`
        COUNT(*) FILTER (
          WHERE CAST(${invoices.balance} AS NUMERIC) > 0
          AND ${invoices.status} IN ('awaiting_payment', 'sent', 'partial_paid')
        )
      `.as("outstanding_count"),
      pastDueCount: sql<number>`
        COUNT(*) FILTER (
          WHERE ${invoices.dueDate} < ${today}
          AND CAST(${invoices.balance} AS NUMERIC) > 0
          AND ${invoices.status} IN ('awaiting_payment', 'sent', 'partial_paid')
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
  locationName: clients.location,
  locationDisplayName: sql<string>`COALESCE(${customerCompanies.name}, ${clients.companyName})`,
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
 * Phase 5 B2: Uses QueryCtx, activeJobFilter(), canonical COALESCE joins.
 *
 * Combines:
 *   1. Overdue jobs (effectiveEnd < now, still open)
 *   2. On-hold + completed (needs invoicing) attention jobs
 * Sorted: overdue first (oldest), then requires_invoicing, then on_hold.
 * Deduplicates by job ID.
 */
export async function getNeedsAttentionJobs(
  ctx: QueryCtx,
  todayDate: string,
  limit: number = 5
): Promise<DashboardJobItem[]> {
  const todayStart = new Date(`${todayDate}T00:00:00.000Z`);

  // Query 1: Overdue jobs (effectiveEnd < now, still open)
  const overdueRows = await ctx.db
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
        sql`${jobs.scheduledStart} IS NOT NULL`,
        sql`CASE
          WHEN ${jobs.scheduledEnd} IS NOT NULL THEN ${jobs.scheduledEnd}
          WHEN ${jobs.durationMinutes} IS NOT NULL THEN ${jobs.scheduledStart} + (${jobs.durationMinutes} || ' minutes')::interval
          ELSE ${jobs.scheduledStart}
        END < ${todayStart}`,
        eq(jobs.status, "open")
      )
    )
    .orderBy(asc(jobs.scheduledStart));

  // Query 2: Attention jobs (on_hold or completed/needs-invoicing)
  const attentionRows = await ctx.db
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
    );

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

export const dashboardRepository = {
  getWorkflowSummary: (companyId: string) => {
    // Legacy callers pass companyId directly; wrap in a minimal QueryCtx
    const { db } = require("../db");
    const ctx: QueryCtx = { db, tenantId: companyId, userId: "", role: "" };
    return getWorkflowSummary(ctx);
  },
  getNeedsAttentionJobs: (companyId: string, todayDate: string, limit?: number) => {
    const { db } = require("../db");
    const ctx: QueryCtx = { db, tenantId: companyId, userId: "", role: "" };
    return getNeedsAttentionJobs(ctx, todayDate, limit);
  },
};
