import express, { Response } from "express";
import { requireRole } from "../auth/requireRole";
import { db } from "../db";
import { users } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { writeAuditLog } from "../services/audit";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";
import { z } from "zod";

const router = express.Router();

// ========================================
// VALIDATION SCHEMAS
// ========================================

const updateRoleSchema = z.object({
  role: z.enum(["admin", "technician", "dispatcher"]),
});

router.patch("/:id/role", requireRole(["admin"]), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const validation = updateRoleSchema.safeParse(req.body);
  if (!validation.success) {
    throw createError(400, "Validation failed");
  }

  const { role } = validation.data;
  const companyId = req.companyId!;

  const updated = await db
    .update(users)
    .set({ role })
    .where(and(eq(users.id, req.params.id), eq(users.companyId, companyId)))
    .returning({ id: users.id });

  if (!updated || updated.length === 0) {
    throw createError(404, "User not found");
  }

  await writeAuditLog({
    companyId,
    userId: req.user!.id,
    action: "user_role_changed",
    entity: "user",
    entityId: req.params.id,
    metadata: { role },
  });

  res.json({ success: true });
}));

router.post("/:id/disable", requireRole(["admin"]), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;

  const disabledRes = await db
    .update(users)
    .set({ disabled: true })
    .where(and(eq(users.id, req.params.id), eq(users.companyId, companyId)))
    .returning({ id: users.id });

  if (!disabledRes || disabledRes.length === 0) {
    throw createError(404, "User not found");
  }

  await writeAuditLog({
    companyId,
    userId: req.user!.id,
    action: "user_disabled",
    entity: "user",
    entityId: req.params.id,
  });

  res.json({ success: true });
}));

export default router;