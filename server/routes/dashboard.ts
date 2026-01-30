/**
 * Dashboard Routes
 *
 * Provides dashboard-specific endpoints for the UI.
 */

import { Router } from "express";
import type { Response } from "express";
import { dashboardRepository } from "../storage/dashboard";
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
  const summary = await dashboardRepository.getWorkflowSummary(req.companyId);
  res.json(summary);
}));

/**
 * GET /api/dashboard/needs-attention
 *
 * Returns jobs needing attention:
 * - Overdue jobs (scheduled before today, still open)
 * - On hold jobs (status = on_hold)
 * - Jobs requiring invoicing (status = requires_invoicing)
 * Sorted: overdue first (oldest), then requires_invoicing, then on_hold
 * Limited to 5 by default
 */
router.get("/needs-attention", asyncHandler(async (req: AuthedRequest, res: Response) => {
  // Default to today if no date provided
  const date = req.query.date ? String(req.query.date) : new Date().toISOString().slice(0, 10);
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 5;

  const jobs = await dashboardRepository.getNeedsAttentionJobs(req.companyId, date, limit);
  res.json({ data: jobs });
}));

export default router;
