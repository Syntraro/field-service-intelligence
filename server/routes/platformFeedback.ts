/**
 * Platform Feedback Routes — Phase 3 (Ops Portal).
 *
 * Mounted at /api/platform/feedback. All routes gated by requirePlatformRole.
 * Mutations are restricted to non-readonly platform roles.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { requirePlatformRole } from "../auth/requirePlatformRole";
import { platformFeedbackService } from "../services/platformFeedbackService";

// Phase 5 role matrix hardening: feedback triage is a tenant-support concern,
// not a billing concern. `platform_billing` no longer writes here.
const WRITE_ROLES = ["platform_admin", "platform_support"] as const;

const platformFeedbackRouter = Router();

// Defense-in-depth (parent also gates).
platformFeedbackRouter.use(requirePlatformRole());

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.string().trim().max(50).optional(),
  category: z.string().trim().max(50).optional(),
  tenantId: z.string().trim().optional(),
  assignedTo: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const idParamSchema = z.object({ id: z.string().min(1) });

const patchSchema = z.object({
  status: z.string().min(1).max(50).optional(),
  priority: z.string().min(1).max(50).nullable().optional(),
  assignedTo: z.string().min(1).nullable().optional(),
}).strict();

const noteSchema = z.object({
  note: z.string().min(1).max(5000),
}).strict();

function requireActor(req: Request) {
  const source = (req as any).isImpersonating ? (req as any).realUser : req.user;
  if (!source?.id) throw createError(401, "Unauthorized");
  return { id: source.id as string, email: (source.email as string) ?? "unknown" };
}

// GET /api/platform/feedback
platformFeedbackRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const params = validateSchema(listQuerySchema, req.query);
  const result = await platformFeedbackService.list(params);
  res.json(result);
}));

// GET /api/platform/feedback/:id
platformFeedbackRouter.get("/:id", asyncHandler(async (req: Request, res: Response) => {
  const { id } = validateSchema(idParamSchema, req.params);
  const row = await platformFeedbackService.getById(id);
  if (!row) throw createError(404, "Feedback not found");
  res.json(row);
}));

// PATCH /api/platform/feedback/:id
platformFeedbackRouter.patch(
  "/:id",
  requirePlatformRole(WRITE_ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validateSchema(idParamSchema, req.params);
    const patch = validateSchema(patchSchema, req.body);
    const actor = requireActor(req);
    const updated = await platformFeedbackService.update({ id, patch, actor, req });
    if (!updated) throw createError(404, "Feedback not found");
    res.json(updated);
  }),
);

// POST /api/platform/feedback/:id/note
platformFeedbackRouter.post(
  "/:id/note",
  requirePlatformRole(WRITE_ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validateSchema(idParamSchema, req.params);
    const { note } = validateSchema(noteSchema, req.body);
    const actor = requireActor(req);
    const created = await platformFeedbackService.addNote({ feedbackId: id, note, actor });
    if (!created) throw createError(404, "Feedback not found");
    res.status(201).json(created);
  }),
);

export default platformFeedbackRouter;
