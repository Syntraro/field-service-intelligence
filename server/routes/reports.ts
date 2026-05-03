import { Router, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { jobs, jobStatusEvents } from "@shared/schema";
import { eq, and, gte, sql, desc } from "drizzle-orm";
import { activeJobFilter } from "../storage/jobFilters";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";
import { reportsRepository } from "../storage/reports";
import { getCompanySnapshot } from "../storage/reportsSnapshot";
import { getCompanyFinancial } from "../storage/reportsFinancial";
import { getCompanyOperations } from "../storage/reportsOperations";
import { getCompanySales } from "../storage/reportsSales";
import { getCompanyAR } from "../storage/reportsAR";
import { getCompanyRevenue } from "../storage/reportsRevenue";
import { getCompanyJobs } from "../storage/reportsJobs";
import { getCompanySalesFunnel } from "../storage/reportsSalesFunnel";
import { getCompanyTeam } from "../storage/reportsTeam";
import { getCompanyPartsForecast } from "../storage/reportsPartsForecast";
import type { SnapshotRange } from "@shared/reports/snapshot";
import type { FinancialRange } from "@shared/reports/financial";
import type { OperationsRange } from "@shared/reports/operations";
import type { SalesRange } from "@shared/reports/sales";
import type { ARRange } from "@shared/reports/ar";
import type { RevenueRange } from "@shared/reports/revenue";
import type { JobsRange } from "@shared/reports/jobs";
import type { SalesFunnelRange } from "@shared/reports/salesFunnel";
import type { TeamRange } from "@shared/reports/team";
import type { PartsForecastRange } from "@shared/reports/partsForecast";

const router = Router();

/**
 * GET /api/reports/snapshot?range=last_30_days
 *
 * Canonical aggregator for the Reports → Snapshot tab. Returns the
 * full structured response (revenueCashFlow, jobsOperations, sales,
 * accountsReceivable) computed from real persisted data. Every metric
 * carries a `hasData` flag so the UI can render an empty state instead
 * of a fabricated zero.
 *
 * Range is parameterized so additional spans (last_quarter / last_year)
 * can be wired without restructuring the contract; only `last_30_days`
 * is supported in this first pass.
 */
const snapshotQuerySchema = z.object({
  range: z.enum(["last_30_days"]).default("last_30_days"),
});

router.get(
  "/snapshot",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const parsed = snapshotQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw createError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const range = parsed.data.range as SnapshotRange;
    const snapshot = await getCompanySnapshot(companyId, range);
    res.json(snapshot);
  }),
);

/**
 * GET /api/reports/financial?range=last_30_days
 *
 * Drill-down aggregator for the Reports → Financial tab. Returns the
 * full structured response (kpis, revenueTrend, paymentBreakdown,
 * arAging, invoiceStatus, paymentTime, topOutstandingClients) computed
 * from real persisted data. Every section carries a `hasData` flag so
 * the UI can render per-section empty states.
 *
 * Reuses the Snapshot tab's shared query primitives (revenue / avg
 * payment days / AR 30+) via `server/storage/reportsCommon.ts` so the
 * two tabs cannot disagree on those definitions.
 */
const financialQuerySchema = z.object({
  range: z.enum(["last_30_days"]).default("last_30_days"),
});

router.get(
  "/financial",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const parsed = financialQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw createError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const range = parsed.data.range as FinancialRange;
    const financial = await getCompanyFinancial(companyId, range);
    res.json(financial);
  }),
);

/**
 * GET /api/reports/operations?range=last_30_days
 *
 * Drill-down aggregator for the Reports → Operations tab. Returns the
 * full structured response (kpis, completionTrend, jobStatus,
 * avgJobValueTrend, unbillableBreakdown) computed from real persisted
 * data. Every section carries a `hasData` flag so the UI can render
 * per-section empty states.
 *
 * KPIs reuse the canonical `sharedQueries` from `reportsCommon.ts`
 * (jobs completed, avg job invoice value, unbillable time cost) so the
 * Snapshot and Operations tabs cannot disagree on those numbers.
 */
const operationsQuerySchema = z.object({
  range: z.enum(["last_30_days"]).default("last_30_days"),
});

router.get(
  "/operations",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const parsed = operationsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw createError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const range = parsed.data.range as OperationsRange;
    const operations = await getCompanyOperations(companyId, range);
    res.json(operations);
  }),
);

/**
 * GET /api/reports/sales?range=last_30_days
 *
 * Drill-down aggregator for the Reports → Sales tab. Returns the full
 * structured response (kpis, leadCreationTrend, leadConversionTrend,
 * quoteCreationTrend, quoteConversionTrend, leadStatusBreakdown,
 * quoteStatusBreakdown) computed from real persisted data.
 *
 * KPIs reuse `sharedQueries` (leadsCreated / leadConversionPercent /
 * quotesCreated / quoteConversionPercent) so the Snapshot tab's Sales
 * section and the Sales drill-down tab cannot disagree.
 */
const salesQuerySchema = z.object({
  range: z.enum(["last_30_days"]).default("last_30_days"),
});

router.get(
  "/sales",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const parsed = salesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw createError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const range = parsed.data.range as SalesRange;
    const sales = await getCompanySales(companyId, range);
    res.json(sales);
  }),
);

/**
 * GET /api/reports/ar?range=last_30_days
 *
 * Backs the Accounts Receivable deep-report page (`/reports/ar`).
 * Returns the full structured response (kpis, aging, overdueInvoices,
 * topOutstandingClients, paymentTimeTrend). Reuses the canonical
 * `getARAgingReport` for buckets + invoice list + the
 * `sharedQueries` for windowed totals.
 */
const arQuerySchema = z.object({
  range: z.enum(["last_30_days"]).default("last_30_days"),
});

router.get(
  "/ar",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const parsed = arQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw createError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const range = parsed.data.range as ARRange;
    const ar = await getCompanyAR(companyId, range);
    res.json(ar);
  }),
);

/**
 * GET /api/reports/revenue?range=last_30_days
 *
 * Backs the Revenue deep-report page (`/reports/revenue`). Returns
 * KPIs, revenue trend, payment methods, revenue by client, recent
 * payments, and a calendar-month comparison. Reuses
 * `sharedQueries.revenue` / `paymentsCollected` / `avgPaymentAmount`
 * for the KPI strip and `getRevenueTrendShared` /
 * `getPaymentBreakdownShared` for the chart sections — same queries
 * the Financial tab uses, so the two surfaces cannot disagree.
 */
const revenueQuerySchema = z.object({
  range: z.enum(["last_30_days"]).default("last_30_days"),
});

router.get(
  "/revenue",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const parsed = revenueQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw createError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const range = parsed.data.range as RevenueRange;
    const revenue = await getCompanyRevenue(companyId, range);
    res.json(revenue);
  }),
);

/**
 * GET /api/reports/jobs?range=last_30_days
 *
 * Backs the Job Performance deep-report page (`/reports/jobs`).
 * Returns KPIs (jobs completed, avg job invoice value, unbillable
 * cost, active jobs), the four Operations sections (completion
 * trend, status breakdown, avg job value trend, unbillable
 * breakdown), and a completed-jobs activity table.
 *
 * KPIs + sections route through the canonical `sharedQueries` and
 * `get*Shared` helpers in `reportsCommon`, so this surface and the
 * Operations tab cannot disagree.
 */
const jobsQuerySchema = z.object({
  range: z.enum(["last_30_days"]).default("last_30_days"),
});

router.get(
  "/jobs",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const parsed = jobsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw createError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const range = parsed.data.range as JobsRange;
    const jobs = await getCompanyJobs(companyId, range);
    res.json(jobs);
  }),
);

/**
 * GET /api/reports/sales-funnel?range=last_30_days
 *
 * Backs the Sales Funnel deep-report page (`/reports/sales-funnel`).
 * Returns 5 KPIs (leads / lead conv % / quotes / quote conv % /
 * lead→quote drop-off), a fixed-order 4-stage funnel, the four Sales
 * tab trend sections, both status breakdowns, and a conversion-lag
 * section.
 *
 * KPIs + section helpers all route through `sharedQueries` and
 * `get*Shared` in `reportsCommon`, so the Sales tab and this surface
 * cannot disagree on any number.
 */
const salesFunnelQuerySchema = z.object({
  range: z.enum(["last_30_days"]).default("last_30_days"),
});

router.get(
  "/sales-funnel",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const parsed = salesFunnelQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw createError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const range = parsed.data.range as SalesFunnelRange;
    const funnel = await getCompanySalesFunnel(companyId, range);
    res.json(funnel);
  }),
);

/**
 * GET /api/reports/team?range=last_30_days
 *
 * Backs the Team Performance deep-report page (`/reports/team`).
 * Returns hour totals, per-user hours, per-user unbillable cost,
 * per-user completed-jobs counts, and a time-distribution summary.
 *
 * Attribution is FK-clean only: time queries key on
 * `time_entries.technicianId`; job-completion queries key on
 * `job_status_events.changedBy`. Multi-tech `job_visits` arrays are
 * NOT used. Per spec: "If attribution is unclear → hasData=false."
 */
const teamQuerySchema = z.object({
  range: z.enum(["last_30_days"]).default("last_30_days"),
});

router.get(
  "/team",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const parsed = teamQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw createError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const range = parsed.data.range as TeamRange;
    const team = await getCompanyTeam(companyId, range);
    res.json(team);
  }),
);

/**
 * GET /api/reports/parts-forecast?range=next_30_days
 *
 * Backs the Parts Forecast deep-report page (`/reports/parts-forecast`).
 * Forecasts parts demand for upcoming PM work by joining scheduled
 * `job_visits` (jobType='maintenance', in window) to active
 * `location_pm_part_templates`. Each visit contributes
 * `quantityPerVisit` once — visits are NOT deduplicated by location.
 *
 * Per-section helpers route through `reportsCommon` so the same
 * (visit × part) join definition is applied consistently across the
 * KPIs, the parts-by-product roll-up, the per-visit roll-up, and
 * the missing-parts gap report.
 */
const partsForecastQuerySchema = z.object({
  range: z.enum(["next_30_days"]).default("next_30_days"),
});

router.get(
  "/parts-forecast",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const parsed = partsForecastQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw createError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const range = parsed.data.range as PartsForecastRange;
    const forecast = await getCompanyPartsForecast(companyId, range);
    res.json(forecast);
  }),
);

/**
 * Query params schema for action-required-kpis
 */
const kpiQuerySchema = z.object({
  days: z.coerce.number().min(1).max(365).default(30),
});

/**
 * GET /api/reports/action-required-kpis
 * Returns Action Required KPIs for the current state and historical trends
 */
router.get("/action-required-kpis", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const { days } = kpiQuerySchema.parse(req.query);

  const now = new Date();
  const windowStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  // ==========================================
  // PART A: Current Jobs On Hold
  // Canonical model: status='open' AND openSubStatus='on_hold'
  // ==========================================
  const currentJobs = await db
    .select({
      id: jobs.id,
      onHoldAt: jobs.onHoldAt,
      holdReason: jobs.holdReason,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.companyId, companyId),
        activeJobFilter(),
        eq(jobs.status, "open"),
        eq(jobs.openSubStatus, "on_hold")
      )
    );

  // Compute current metrics
  let total = 0;
  let slaBreached24h = 0;
  let escalated = 0;
  const buckets = { lt24h: 0, h24to72: 0, gte72h: 0 };
  const reasonCounts: Record<string, number> = {};

  for (const job of currentJobs) {
    total++;

    if (job.onHoldAt) {
      const ageMs = now.getTime() - new Date(job.onHoldAt).getTime();
      const ageHours = ageMs / (1000 * 60 * 60);

      if (ageHours >= 24) {
        slaBreached24h++;
      }

      if (ageHours < 24) {
        buckets.lt24h++;
      } else if (ageHours < 72) {
        buckets.h24to72++;
      } else {
        buckets.gte72h++;
      }
    }

    // Count by reason
    const reason = job.holdReason || "unknown";
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  }

  // ==========================================
  // PART B: Historical Metrics (last N days)
  // ==========================================
  // Find all events where jobs entered needs_review state in the window
  // Note: Historical data may have "action_required" as legacy status
  const entryEvents = await db
    .select({
      jobId: jobStatusEvents.jobId,
      changedAt: jobStatusEvents.changedAt,
      meta: jobStatusEvents.meta,
    })
    .from(jobStatusEvents)
    .where(
      and(
        eq(jobStatusEvents.companyId, companyId),
        // Include both legacy "action_required" and new "needs_review" for historical data
        sql`(${jobStatusEvents.toStatus} = 'action_required' OR ${jobStatusEvents.meta}->>'openSubStatus' = 'needs_review')`,
        gte(jobStatusEvents.changedAt, windowStart)
      )
    )
    .orderBy(jobStatusEvents.changedAt);

  // Find all events where jobs exited needs_review/action_required
  const exitEvents = await db
    .select({
      jobId: jobStatusEvents.jobId,
      changedAt: jobStatusEvents.changedAt,
      fromStatus: jobStatusEvents.fromStatus,
    })
    .from(jobStatusEvents)
    .where(
      and(
        eq(jobStatusEvents.companyId, companyId),
        // Include both legacy and new for historical data
        sql`(${jobStatusEvents.fromStatus} = 'action_required' OR ${jobStatusEvents.meta}->>'previousOpenSubStatus' = 'needs_review')`
      )
    )
    .orderBy(jobStatusEvents.changedAt);

  // Build a map of exit events by jobId for quick lookup
  const exitsByJob = new Map<string, Array<{ changedAt: Date }>>();
  for (const exit of exitEvents) {
    if (!exitsByJob.has(exit.jobId)) {
      exitsByJob.set(exit.jobId, []);
    }
    exitsByJob.get(exit.jobId)!.push({ changedAt: exit.changedAt });
  }

  // Calculate durations for completed action_required intervals
  const durations: Array<{ hours: number; reason: string }> = [];

  for (const entry of entryEvents) {
    const exits = exitsByJob.get(entry.jobId) || [];
    // Find the first exit after this entry
    const exitAfterEntry = exits.find(e => e.changedAt > entry.changedAt);

    if (exitAfterEntry) {
      const durationMs = exitAfterEntry.changedAt.getTime() - entry.changedAt.getTime();
      const durationHours = durationMs / (1000 * 60 * 60);
      const reason = (entry.meta as any)?.reason || "unknown";
      durations.push({ hours: durationHours, reason });
    }
  }

  // Compute aggregate stats
  const allHours = durations.map(d => d.hours).sort((a, b) => a - b);
  const averageHours = allHours.length > 0
    ? allHours.reduce((sum, h) => sum + h, 0) / allHours.length
    : 0;
  const medianHours = allHours.length > 0
    ? allHours[Math.floor(allHours.length / 2)]
    : 0;

  // Group by reason
  const byReasonMap = new Map<string, number[]>();
  for (const d of durations) {
    if (!byReasonMap.has(d.reason)) {
      byReasonMap.set(d.reason, []);
    }
    byReasonMap.get(d.reason)!.push(d.hours);
  }

  const byReason = Array.from(byReasonMap.entries()).map(([reason, hours]) => {
    const sorted = hours.sort((a, b) => a - b);
    const avg = sorted.reduce((sum, h) => sum + h, 0) / sorted.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    return {
      reason,
      count: hours.length,
      avgHours: Math.round(avg * 10) / 10,
      medianHours: Math.round(median * 10) / 10,
    };
  }).sort((a, b) => b.count - a.count);

  // Current reasons breakdown
  const currentByReason = Object.entries(reasonCounts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  res.json({
    current: {
      total,
      slaBreached24h,
      escalated,
      buckets,
      byReason: currentByReason,
    },
    history: {
      windowDays: days,
      resolvedCount: durations.length,
      averageHoursInActionRequired: Math.round(averageHours * 10) / 10,
      medianHoursInActionRequired: Math.round(medianHours * 10) / 10,
      byReason,
    },
  });
}));

/**
 * GET /api/reports/ar-aging
 * Returns Accounts Receivable Aging report
 * Includes invoices with status 'sent' or 'partial_paid' and balance > 0
 * Bounded: invoices array paginated (default limit=200, max 200)
 * Summary and buckets always returned in full.
 */
router.get("/ar-aging", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const report = await reportsRepository.getARAgingReport(companyId);

  // Paginate the invoices array; summary + buckets are always small
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const sliced = report.invoices.slice(offset, offset + limit);
  const hasMore = offset + limit < report.invoices.length;

  res.json({
    summary: report.summary,
    buckets: report.buckets,
    invoices: sliced,
    meta: { total: report.invoices.length, limit, offset, hasMore },
  });
}));

export default router;
