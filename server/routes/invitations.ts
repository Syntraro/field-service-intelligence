import express, { Request, Response } from "express";
import { requireRole } from "../auth/requireRole";
import { canAssignRole, type Role } from "../auth/roles";
// 2026-05-04 PR 4: invitations are team management. team.manage gate
// behind the existing role gate. POST /accept is intentionally NOT
// gated — it's the public token-redemption endpoint.
import { requirePermission } from "../permissions";
import { invitationRepository } from "../storage/invitations";
import { logInvitationCreated, logInvitationResent } from "../services/auditService";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";
import { z } from "zod";

const router = express.Router();

// ========================================
// VALIDATION SCHEMAS
// ========================================

const createInvitationSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "technician", "dispatcher"]),
});

const acceptInvitationSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).optional(),
  passwordHash: z.string().optional(),
}).refine(data => data.password || data.passwordHash, {
  message: "Either password or passwordHash is required",
});

// Admin/dispatcher create invite (protected by requireAuth upstream)
// Role hierarchy enforced: dispatchers can only invite technicians
router.post("/", requireRole(["admin", "dispatcher"]), requirePermission("team.manage"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const validation = createInvitationSchema.safeParse(req.body);
  if (!validation.success) {
    throw createError(400, "Validation failed");
  }

  const { email, role } = validation.data;
  const companyId = req.companyId!;
  const inviterRole = req.user!.role as Role;

  // Phase A Security Fix: Enforce role hierarchy to prevent privilege escalation
  if (!canAssignRole(inviterRole, role as Role)) {
    throw createError(403, `Insufficient permissions to assign role: ${role}`);
  }

  const { token, expiresAt } = await invitationRepository.createInvitation(companyId, email, role);

  await logInvitationCreated(req, companyId, req.user!.id, { email, role, expiresAt: expiresAt.toISOString() });

  res.json({ token, expiresAt });
}));

// Resend invite (pending only) - validates invitation belongs to company
router.post("/:id/resend", requireRole(["admin", "dispatcher"]), requirePermission("team.manage"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const { token, expiresAt } = await invitationRepository.resendInvitation(companyId, req.params.id);

  await logInvitationResent(req, companyId, req.user!.id, { invitationId: req.params.id, expiresAt: expiresAt.toISOString() });

  res.json({ token, expiresAt });
}));

// Public accept (should be mounted BEFORE requireAuth)
router.post("/accept", asyncHandler(async (req: Request, res: Response) => {
  const validation = acceptInvitationSchema.safeParse(req.body);
  if (!validation.success) {
    throw createError(400, "Validation failed");
  }

  const { token, password, passwordHash } = validation.data;
  const user = await invitationRepository.acceptInvitation(token, password ?? passwordHash!);

  res.json({ success: true, user });
}));

export default router;