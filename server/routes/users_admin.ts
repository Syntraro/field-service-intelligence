import express, { Response } from "express";
import { requireRole } from "../auth/requireRole";
import { writeAuditLog } from "../services/audit";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";
import { z } from "zod";
import { userRepository } from "../storage/users";

const router = express.Router();

// ========================================
// VALIDATION SCHEMAS
// ========================================

const updateRoleSchema = z.object({
  role: z.enum(["admin", "technician", "dispatcher"]),
});

router.patch(
  "/:id/role",
  requireRole(["admin"]),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const validation = updateRoleSchema.safeParse(req.body);
    if (!validation.success) {
      throw createError(400, "Validation failed");
    }

    const { role } = validation.data;
    const companyId = req.companyId!;

    await userRepository.updateUserRole(companyId, req.params.id, role);

    await writeAuditLog({
      companyId,
      userId: req.user!.id,
      action: "user_role_changed",
      entity: "user",
      entityId: req.params.id,
      metadata: { role },
    });

    res.json({ success: true });
  })
);

router.post(
  "/:id/disable",
  requireRole(["admin"]),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;

    await userRepository.disableUser(companyId, req.params.id);

    await writeAuditLog({
      companyId,
      userId: req.user!.id,
      action: "user_disabled",
      entity: "user",
      entityId: req.params.id,
    });

    res.json({ success: true });
  })
);

export default router;
