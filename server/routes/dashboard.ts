/**
 * Dashboard Routes
 *
 * Provides dashboard-specific endpoints for the UI.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { dashboardRepository } from "../storage/dashboard";
import { asyncHandler, createError } from "../middleware/errorHandler";

const router = Router();

/**
 * GET /api/dashboard/workflow
 *
 * Returns workflow summary counts for the Dashboard workflow strip.
 * Counts are tenant-safe and respect soft deletes.
 */
router.get("/workflow", asyncHandler(async (req: Request, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) throw createError(401, "Unauthorized");

  const summary = await dashboardRepository.getWorkflowSummary(companyId);
  res.json(summary);
}));

export default router;
