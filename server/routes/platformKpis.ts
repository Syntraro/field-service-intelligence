/**
 * Platform KPIs Router — SaaS Admin / Tenant Operations Phase A3.
 *
 * Mounted at /api/platform/kpis. Read-only. The parent `/api/platform`
 * router already applies `requirePlatformRole()`; we repeat it here as
 * defense-in-depth against mis-mounting.
 */

import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { requirePlatformRole } from "../auth/requirePlatformRole";
import { platformKpiService } from "../services/platformKpiService";

const router = Router();
router.use(requirePlatformRole());

// GET /api/platform/kpis
//
// Single round-trip for the operator control-center KPI strip. Service
// caches the whole result for 60s; individual KPIs are not queryable —
// the strip is always rendered as a batch.
router.get(
  "/",
  asyncHandler(async (_req: Request, res: Response) => {
    const kpis = await platformKpiService.getPlatformKpis();
    res.json(kpis);
  }),
);

export default router;
