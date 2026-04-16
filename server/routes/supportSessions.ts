/**
 * Support Session Routes — Phase 4.
 *
 * Mounted at /api/platform/support-sessions. All routes gated by
 * requirePlatformRole; mutations restricted to non-readonly platform roles.
 * Session activation/closure deliberately does NOT require ownership of the
 * specific session being acted on at this layer — ownership constraints are
 * enforced at the service if the session is impersonation-mode (existing
 * impersonation service validates ownerUserId equality on stop).
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { requirePlatformRole } from "../auth/requirePlatformRole";
import { supportSessionService } from "../services/supportSessionService";

const WRITE_ROLES = ["platform_admin", "platform_support"] as const;

const supportSessionsRouter = Router();
supportSessionsRouter.use(requirePlatformRole());

const createSchema = z.object({
  tenantId: z.string().min(1),
  accessMode: z.enum(["read_only", "impersonation"]),
  durationMinutes: z.coerce.number().int().refine((v) => [15, 30, 60].includes(v), {
    message: "durationMinutes must be 15, 30, or 60",
  }),
  reason: z.string().min(1).max(1000),
  targetUserId: z.string().min(1).nullable().optional(),
  approvedByUserId: z.string().min(1).nullable().optional(),
  // Phase 5: customer-approval foundation. Only honored for read_only mode.
  initialStatus: z.enum(["pending", "active"]).optional(),
}).strict();

const listQuerySchema = z.object({
  activeOnly: z.coerce.boolean().optional(),
  tenantId: z.string().optional(),
  ownerUserId: z.string().optional(),
  accessMode: z.enum(["read_only", "impersonation"]).optional(),
  status: z.enum(["pending", "active", "expired", "revoked", "closed"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const idParamSchema = z.object({ id: z.string().min(1) });

function requireActor(req: Request) {
  const source = (req as any).isImpersonating ? (req as any).realUser : req.user;
  if (!source?.id) throw createError(401, "Unauthorized");
  return { id: source.id as string, email: (source.email as string) ?? "unknown" };
}

// POST /api/platform/support-sessions — create (read-only or impersonation)
supportSessionsRouter.post(
  "/",
  requirePlatformRole(WRITE_ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const input = validateSchema(createSchema, req.body);
    if (input.accessMode === "impersonation" && !input.targetUserId) {
      throw createError(400, "targetUserId is required for accessMode=impersonation");
    }
    const actor = requireActor(req);
    const session = await supportSessionService.create({
      tenantId: input.tenantId,
      accessMode: input.accessMode,
      durationMinutes: input.durationMinutes,
      reason: input.reason,
      targetUserId: input.targetUserId ?? null,
      approvedByUserId: input.approvedByUserId ?? null,
      initialStatus: input.initialStatus,
      actor,
      req,
      res,
    });
    res.status(201).json(session);
  }),
);

// GET /api/platform/support-sessions
supportSessionsRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const params = validateSchema(listQuerySchema, req.query);
    const result = await supportSessionService.list(params);
    res.json(result);
  }),
);

// POST /api/platform/support-sessions/:id/activate
supportSessionsRouter.post(
  "/:id/activate",
  requirePlatformRole(WRITE_ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validateSchema(idParamSchema, req.params);
    const actor = requireActor(req);
    const updated = await supportSessionService.activate(id, actor, req, res);
    if (!updated) throw createError(404, "Support session not found");
    res.json(updated);
  }),
);

// POST /api/platform/support-sessions/:id/revoke
supportSessionsRouter.post(
  "/:id/revoke",
  requirePlatformRole(WRITE_ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validateSchema(idParamSchema, req.params);
    const actor = requireActor(req);
    const updated = await supportSessionService.revoke(id, actor, req, res);
    if (!updated) throw createError(404, "Support session not found or already ended");
    res.json(updated);
  }),
);

// POST /api/platform/support-sessions/:id/close
supportSessionsRouter.post(
  "/:id/close",
  requirePlatformRole(WRITE_ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validateSchema(idParamSchema, req.params);
    const actor = requireActor(req);
    const updated = await supportSessionService.close(id, actor, req, res);
    if (!updated) throw createError(404, "Support session not found or already ended");
    res.json(updated);
  }),
);

export default supportSessionsRouter;
