import express, { Response } from "express";
import { requireRole } from "../auth/requireRole";
import { canAssignRole, type Role } from "../auth/roles";
import { logRoleChanged, logUserDisabled } from "../services/auditService";
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

// Phase A Security Fix: Enforce role hierarchy to prevent privilege escalation
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
    const changerRole = req.user!.role as Role;

    // Phase A Security Fix: Enforce role hierarchy
    if (!canAssignRole(changerRole, role as Role)) {
      throw createError(403, `Insufficient permissions to assign role: ${role}`);
    }

    await userRepository.updateUserRole(companyId, req.params.id, role);

    await logRoleChanged(req, companyId, req.user!.id, req.params.id, { newRole: role });

    res.json({ success: true });
  })
);

router.post(
  "/:id/disable",
  requireRole(["admin"]),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;

    await userRepository.disableUser(companyId, req.params.id);

    await logUserDisabled(req, companyId, req.user!.id, req.params.id);

    res.json({ success: true });
  })
);

export default router;
