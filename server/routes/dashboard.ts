/**
 * Dashboard Routes — Phase 5 Part B
 *
 * Provides dashboard-specific endpoints for the UI.
 * Phase 5 B2: Routes now use QueryCtx + canonical functions directly.
 */

import { Router } from "express";
import type { Response } from "express";
import { getWorkflowSummary, getNeedsAttentionJobs, getFinancialSummary, getPMDueInstances } from "../storage/dashboard";
import { getTodayVisitSummary } from "../storage/todaySummary";
import { getTodayCapacity } from "../storage/capacity";
import { getQueryCtx } from "../lib/queryCtx";
import { asyncHandler } from "../middleware/errorHandler";
import type { AuthedRequest } from "../auth/tenantIsolation";

const router = Router();

/**
 * GET /api/dashboard/workflow
 *
 * Returns workflow summary counts for the Dashboard workflow strip.
 * Counts are tenant-safe and respect soft deletes.
 */
router.get("/workflow", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const ctx = getQueryCtx(req);
  const summary = await getWorkflowSummary(ctx);
  res.json(summary);
}));

/**
 * GET /api/dashboard/needs-attention
 *
 * Returns jobs needing attention:
 * - Overdue jobs (effectiveEnd < NOW(), still open — instant cutoff)
 * - On hold jobs (status = on_hold)
 * - Jobs requiring invoicing (status = completed)
 * Sorted: overdue first (oldest), then requires_invoicing, then on_hold
 * Limited to 5 by default
 */
router.get("/needs-attention", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const ctx = getQueryCtx(req);
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 5;

  const jobs = await getNeedsAttentionJobs(ctx, limit);
  res.json({ data: jobs });
}));

/**
 * GET /api/dashboard/financial
 *
 * Financial dashboard aggregation — revenue by period, AR summary, quote pipeline, PM health.
 * Revenue = sum of payments received (cash-basis), not invoiced amounts.
 */
router.get("/financial", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const ctx = getQueryCtx(req);
  const summary = await getFinancialSummary(ctx);
  res.json(summary);
}));

/**
 * GET /api/dashboard/today-summary
 *
 * Returns today's visit counts by status for the "Today's Operations" section.
 * Real-time: scheduled, on route, in progress, remaining, completed.
 */
router.get("/today-summary", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const summary = await getTodayVisitSummary(companyId);
  res.json(summary);
}));

/**
 * GET /api/dashboard/pm-due-instances
 *
 * 2026-04-26: Drill-down rows for the dashboard "Requires attention"
 * bucket — preventive-maintenance instances that are eligible for job
 * generation but have not been generated yet. The row filter mirrors
 * `getPMCounts().awaitingGenerationCount` exactly so the tile count and
 * this list stay in lockstep. Tenant-scoped via `getQueryCtx`. Each row
 * carries the instance id, the template id (for "View PM" navigation),
 * customer / location identity, and an `isOverdue` flag the modal uses
 * to colour-tag the row. Generation itself still routes through the
 * canonical `POST /api/recurring-templates/generate-selected` endpoint.
 */
router.get("/pm-due-instances", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const ctx = getQueryCtx(req);
  const limit = req.query.limit ? Math.min(parseInt(String(req.query.limit), 10) || 50, 100) : 50;
  const data = await getPMDueInstances(ctx, limit);
  res.json({ data });
}));

/**
 * GET /api/dashboard/capacity
 *
 * Returns per-technician "remaining capacity today" — one primary open slot
 * per active technician plus total remaining available minutes. Powers the
 * "Today's Capacity" card on the dashboard.
 *
 * Reuses canonical sources (no duplicate scheduling logic): workingHours
 * table, companyBusinessHours fallback, schedulable-tech filter, and the
 * same visit query the calendar + dispatch board use.
 */
router.get("/capacity", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const capacity = await getTodayCapacity(companyId);
  res.json(capacity);
}));

export default router;
