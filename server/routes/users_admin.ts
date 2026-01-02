import express from "express";
import { requireRole } from "../auth/requireRole";
import { db } from "../db";
import { users } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { writeAuditLog } from "../services/audit";

const router = express.Router();

router.patch("/:id/role", requireRole(["admin"]), async (req, res) => {
  const { role } = req.body;
  const companyId = req.companyId!;

  const updated = await db
    .update(users)
    .set({ role })
    .where(and(eq(users.id, req.params.id), eq(users.companyId, companyId)))
    .returning({ id: users.id });

  if (!updated || updated.length === 0)
    return res.status(404).json({ error: "User not found" });

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

  const disabledRes = await db
    .update(users)
    .set({ disabled: true })
    .where(and(eq(users.id, req.params.id), eq(users.companyId, companyId)))
    .returning({ id: users.id });

  if (!disabledRes || disabledRes.length === 0)
    return res.status(404).json({ error: "User not found" });

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
