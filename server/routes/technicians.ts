import express, { Response } from "express";
import { createTechnician } from "../services/technicians";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { RESTRICTED_MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";

const router = express.Router();

const MANAGER_ROLES = RESTRICTED_MANAGER_ROLES;

// ========================================
// VALIDATION SCHEMAS
// ========================================

const createTechnicianSchema = z.object({
  name: z.string().min(1).max(200),
  userId: z.string().uuid().optional(),
});

router.post("/", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const validation = createTechnicianSchema.safeParse(req.body);
  if (!validation.success) {
    throw createError(400, "Validation failed");
  }

  const { name, userId } = validation.data;
  const companyId = req.companyId!;
  const tech = await createTechnician(companyId, name, userId);
  res.json(tech);
}));

export default router;