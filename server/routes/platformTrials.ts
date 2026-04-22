/**
 * Platform Trials Router — SaaS Admin / Tenant Operations Phase A2.
 *
 * Mounted at /api/platform/trials. All routes gated by requirePlatformRole
 * (applied once by the parent platform router; repeated here as
 * defense-in-depth against mis-mount).
 *
 * Read-only. Writes for trial lifecycle (extend / assign plan) continue to
 * flow through the canonical lifecycle + billing endpoints:
 *   PATCH /api/admin/tenants/:id/billing            (trialEndsAt)
 *   PATCH /api/platform/tenants/:id/subscription    (plan assignment)
 */

import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { requirePlatformRole } from "../auth/requirePlatformRole";
import { trialPipelineService } from "../services/trialPipelineService";

const router = Router();
router.use(requirePlatformRole());

// GET /api/platform/trials/pipeline
//
// Returns the full bucket matrix: ending_soon, ending_this_week,
// expired_not_converted, stalled_trial, converted_recently. Each bucket
// contains an ordered array of enriched TrialRow objects + a count.
//
// Single round-trip for the dashboard. Service caches the result for 60s.
router.get(
  "/pipeline",
  asyncHandler(async (_req: Request, res: Response) => {
    const result = await trialPipelineService.getTrialPipeline();
    res.json(result);
  }),
);

export default router;
