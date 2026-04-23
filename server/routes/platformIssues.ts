/**
 * Platform Issues Routes — Phase 3 (Ops Portal).
 *
 * Mounted at /api/platform/issues. All routes gated by requirePlatformRole;
 * mutations restricted to non-readonly platform roles.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { requirePlatformRole } from "../auth/requirePlatformRole";
import { platformIssuesService } from "../services/platformIssuesService";
import { insertIssueReportSchema } from "@shared/schema";

// 2026-04-22 Revised Phase 1: issue triage → `feedback:triage` capability
// (feedback + issues share the same triage capability by design; they're
// sibling surfaces).
import { requireCapability } from "../auth/requireCapability";

const platformIssuesRouter = Router();
platformIssuesRouter.use(requirePlatformRole());

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.string().trim().max(50).optional(),
  severity: z.string().trim().max(50).optional(),
  assignedTo: z.string().trim().optional(),
  tenantId: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const idParamSchema = z.object({ id: z.string().min(1) });

const patchSchema = z.object({
  status: z.string().min(1).max(50).optional(),
  severity: z.string().min(1).max(50).optional(),
  priority: z.string().min(1).max(50).nullable().optional(),
  assignedTo: z.string().min(1).nullable().optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(20000).nullable().optional(),
  route: z.string().max(500).nullable().optional(),
  featureArea: z.string().max(100).nullable().optional(),
  reproSteps: z.string().max(20000).nullable().optional(),
}).strict();

const noteSchema = z.object({ note: z.string().min(1).max(5000) }).strict();

function requireActor(req: Request) {
  const source = (req as any).isImpersonating ? (req as any).realUser : req.user;
  if (!source?.id) throw createError(401, "Unauthorized");
  return { id: source.id as string, email: (source.email as string) ?? "unknown" };
}

// GET /api/platform/issues
platformIssuesRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const params = validateSchema(listQuerySchema, req.query);
  const result = await platformIssuesService.list(params);
  res.json(result);
}));

// POST /api/platform/issues
platformIssuesRouter.post(
  "/",
  requireCapability("feedback:triage"),
  asyncHandler(async (req: Request, res: Response) => {
    const input = validateSchema(insertIssueReportSchema, req.body);
    const actor = requireActor(req);
    const created = await platformIssuesService.create({ input, actor, req });
    res.status(201).json(created);
  }),
);

// GET /api/platform/issues/:id
platformIssuesRouter.get("/:id", asyncHandler(async (req: Request, res: Response) => {
  const { id } = validateSchema(idParamSchema, req.params);
  const row = await platformIssuesService.getById(id);
  if (!row) throw createError(404, "Issue not found");
  res.json(row);
}));

// PATCH /api/platform/issues/:id
platformIssuesRouter.patch(
  "/:id",
  requireCapability("feedback:triage"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validateSchema(idParamSchema, req.params);
    const patch = validateSchema(patchSchema, req.body);
    const actor = requireActor(req);
    const updated = await platformIssuesService.update({ id, patch, actor, req });
    if (!updated) throw createError(404, "Issue not found");
    res.json(updated);
  }),
);

// POST /api/platform/issues/:id/note
platformIssuesRouter.post(
  "/:id/note",
  requireCapability("feedback:triage"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validateSchema(idParamSchema, req.params);
    const { note } = validateSchema(noteSchema, req.body);
    const actor = requireActor(req);
    const created = await platformIssuesService.addNote({ issueId: id, note, actor });
    if (!created) throw createError(404, "Issue not found");
    res.status(201).json(created);
  }),
);

export default platformIssuesRouter;
