import express from "express";
import { requireRole } from "../auth/requireRole";
import { createInvitation, acceptInvitation, resendInvitation } from "../services/invitations";
import { writeAuditLog } from "../services/audit";
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
router.post("/", requireRole(["admin", "dispatcher"]), async (req, res) => {
  const validation = createInvitationSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ 
      error: "Validation failed", 
      details: validation.error.errors 
    });
  }

  const { email, role } = validation.data;
  const companyId = req.companyId!;
  const { token, expiresAt } = await createInvitation(companyId, email, role);

  await writeAuditLog({
    companyId,
    userId: req.user!.id,
    action: "invitation_created",
    entity: "invitation",
    metadata: { email, role, expiresAt },
  });

  res.json({ token, expiresAt });
});

// Resend invite (pending only)
router.post("/:id/resend", requireRole(["admin", "dispatcher"]), async (req, res) => {
  const companyId = req.companyId!;
  const { token, expiresAt } = await resendInvitation(req.params.id);

  await writeAuditLog({
    companyId,
    userId: req.user!.id,
    action: "invitation_resent",
    entity: "invitation",
    entityId: req.params.id,
    metadata: { expiresAt },
  });

  res.json({ token, expiresAt });
});

// Public accept (should be mounted BEFORE requireAuth)
router.post("/accept", async (req, res) => {
  const validation = acceptInvitationSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ 
      error: "Validation failed", 
      details: validation.error.errors 
    });
  }

  const { token, password, passwordHash } = validation.data;
  const user = await acceptInvitation(token, password ?? passwordHash);

  res.json({ success: true, user });
});

export default router;