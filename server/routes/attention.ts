/**
 * Attention Routes — Read + admin endpoints for the attention_items queue.
 *
 * Phase 1 Architecture: Event Log + Attention Queue.
 *
 * GET  /api/attention              — Filtered attention items
 * GET  /api/attention/summary      — Counts by ruleType (for dashboard)
 * GET  /api/attention/:entityType/:entityId — Items for a single entity
 * POST /api/attention/recompute    — Admin-only full recompute
 */

import { Router } from "express";
import type { Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { requireRole } from "../auth/requireRole";
import { getAttentionItems, getAttentionSummary, getEntityAttentionItems } from "../storage/attention";
import { recomputeAllAttention } from "../lib/attentionRules";

const router = Router();

/**
 * GET /api/attention
 * Returns attention items for the tenant.
 * Query params: entityType, status (default 'open'), limit, offset
 */
router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const tenantId = req.companyId;
  const entityType = req.query.entityType ? String(req.query.entityType) : undefined;
  const status = req.query.status ? String(req.query.status) : "open";
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
  const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;

  const items = await getAttentionItems({ tenantId, entityType, status, limit, offset });
  res.json({ data: items });
}));

/**
 * GET /api/attention/summary
 * Returns counts by ruleType for open items (dashboard strip).
 */
router.get("/summary", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const tenantId = req.companyId;
  const summary = await getAttentionSummary(tenantId);
  res.json(summary);
}));

/**
 * GET /api/attention/:entityType/:entityId
 * Returns attention items for a specific entity.
 */
router.get("/:entityType/:entityId", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const tenantId = req.companyId;
  const { entityType, entityId } = req.params;
  const items = await getEntityAttentionItems(tenantId, entityType, entityId);
  res.json({ data: items });
}));

/**
 * POST /api/attention/recompute
 * Admin-only: full tenant-wide recompute of attention items.
 * Safety valve for when incremental updates get out of sync.
 */
router.post("/recompute", requireRole(["owner", "admin"]), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const tenantId = req.companyId;
  const result = await recomputeAllAttention(tenantId);
  res.json({ message: "Recompute complete", ...result });
}));

export default router;
