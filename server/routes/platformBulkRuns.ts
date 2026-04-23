/**
 * Platform Bulk Runs Router — SaaS Admin Phase A6.3.
 *
 * Mounted at /api/platform/bulk-runs. Read-only. Any platform role may
 * inspect history (the parent router already applies `requirePlatformRole()`
 * — no write-role escalation needed for read surfaces).
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { requirePlatformRole } from "../auth/requirePlatformRole";
import { bulkRunsService } from "../services/bulkRunsService";

const router = Router();
router.use(requirePlatformRole());

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const runIdParamSchema = z.object({
  runId: z.string().min(1, "runId required"),
});

// GET /api/platform/bulk-runs — recent bulk runs, most recent first.
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const params = validateSchema(listQuerySchema, req.query);
    const result = await bulkRunsService.listRuns(params);
    res.json(result);
  }),
);

// GET /api/platform/bulk-runs/:runId — per-tenant outcomes + params snapshot.
router.get(
  "/:runId",
  asyncHandler(async (req: Request, res: Response) => {
    const { runId } = validateSchema(runIdParamSchema, req.params);
    const detail = await bulkRunsService.getRun(runId);
    if (!detail) throw createError(404, "Bulk run not found");
    res.json(detail);
  }),
);

export default router;
