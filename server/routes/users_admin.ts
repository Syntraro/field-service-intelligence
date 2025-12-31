
import express from "express";
import { requireRole } from "../auth/requireRole";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { writeAuditLog } from "../services/audit";

const router = express.Router();

router.patch("/:id/role", requireRole(["admin"]), async (req, res) => {
  const { role } = req.body;
  const companyId = req.companyId!;

  await db.update(users).set({ role }).where(eq(users.id, req.params.id));

  await writeAuditLog({
    companyId,
    userId: req.user!.id,
    action: "user_role_changed",
    entity: "user",
    entityId: req.params.id,
    metadata: { role },
  });

  res.json({ success: true });
});

router.post("/:id/disable", requireRole(["admin"]), async (req, res) => {
  const companyId = req.companyId!;
  
  await db.update(users).set({ disabled: true }).where(eq(users.id, req.params.id));

  await writeAuditLog({
    companyId,
    userId: req.user!.id,
    action: "user_disabled",
    entity: "user",
    entityId: req.params.id,
  });

  res.json({ success: true });
});

export default router;
