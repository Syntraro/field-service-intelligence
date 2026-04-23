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
// 2026-04-22 Revised Phase 1: capability-based gates.
// - create → support:session:create
// - activate / revoke / close → support:session:manage
// Both capabilities are held by platform_admin + platform_support today;
// billing loses support-session access, which matches their job scope.
import { requireCapability } from "../auth/requireCapability";

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

/**
 * 2026-04-22 Phase 2-lite Platform Auth Separation: the actor for every
 * support-session action is the platform admin. We now prefer
 * `req.platformUser` (psid-backed session) over `req.user` (sid-backed
 * tenant session). A platform admin who logs in exclusively via
 * /platform/login can create / activate / revoke / close support sessions
 * without ever holding a tenant session.
 *
 * Fallback to `req.user` (with the impersonation real-actor preference)
 * is retained for any transitional caller that still uses the legacy
 * tenant-session path. Once Phase 3 removes the legacy path entirely,
 * the fallback can be dropped.
 */
function requireActor(req: Request) {
  const platformUser = (req as any).platformUser as
    | { id: string; email: string }
    | undefined;
  if (platformUser?.id) {
    return {
      id: platformUser.id,
      email: platformUser.email ?? "unknown",
    };
  }
  const source = (req as any).isImpersonating ? (req as any).realUser : req.user;
  if (!source?.id) throw createError(401, "Unauthorized");
  return { id: source.id as string, email: (source.email as string) ?? "unknown" };
}

// POST /api/platform/support-sessions — create (read-only or impersonation)
supportSessionsRouter.post(
  "/",
  requireCapability("support:session:create"),
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
  requireCapability("support:session:manage"),
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
  requireCapability("support:session:manage"),
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
  requireCapability("support:session:manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validateSchema(idParamSchema, req.params);
    const actor = requireActor(req);
    const updated = await supportSessionService.close(id, actor, req, res);
    if (!updated) throw createError(404, "Support session not found or already ended");
    res.json(updated);
  }),
);

export default supportSessionsRouter;
