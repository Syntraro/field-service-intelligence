/**
 * Activity Routes — Read endpoints for the canonical events table.
 *
 * Phase 1 Architecture: Event Log + Attention Queue.
 *
 * GET /api/activity          — Latest events for tenant (activity feed)
 * GET /api/activity/:entityType/:entityId — Timeline for one entity
 */

import { Router } from "express";
import type { Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { getActivityFeed, getEntityTimeline } from "../storage/events";

const router = Router();

/**
 * GET /api/activity
 * Returns latest events for the authenticated tenant.
 * Query params: limit (default 50), cursor (ISO timestamp for pagination)
 */
router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const tenantId = req.companyId;
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
  const cursor = req.query.cursor ? String(req.query.cursor) : undefined;

  const result = await getActivityFeed({ tenantId, limit, cursor });
  res.json(result);
}));

/**
 * GET /api/activity/:entityType/:entityId
 * Returns timeline for a specific entity.
 * Query params: limit (default 50), cursor (ISO timestamp for pagination)
 */
router.get("/:entityType/:entityId", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const tenantId = req.companyId;
  const { entityType, entityId } = req.params;
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
  const cursor = req.query.cursor ? String(req.query.cursor) : undefined;

  const result = await getEntityTimeline({ tenantId, entityType, entityId, limit, cursor });
  res.json(result);
}));

export default router;
