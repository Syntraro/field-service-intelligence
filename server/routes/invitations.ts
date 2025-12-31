
import express from "express";
import { requireRole } from "../auth/requireRole";
import { createInvitation, acceptInvitation, resendInvitation } from "../services/invitations";
import { writeAuditLog } from "../services/audit";

const router = express.Router();

// Admin/dispatcher create invite (protected by requireAuth upstream)
router.post("/", requireRole(["admin", "dispatcher"]), async (req, res) => {
  const { email, role } = req.body;
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
  const { token, password, passwordHash } = req.body;
  const user = await acceptInvitation(token, password ?? passwordHash);

  res.json({ success: true, user });
});

export default router;
