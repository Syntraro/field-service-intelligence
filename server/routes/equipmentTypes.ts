/**
 * Equipment Types — tenant-owned catalog routes.
 *
 * Backs the searchable combobox in the Add Equipment dialog. Tenant-isolated
 * by `ensureTenantContext` middleware applied in routes/index.ts.
 */
import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";
import { equipmentTypeRepository } from "../storage/equipmentTypes";
import { asyncHandler, createError } from "../middleware/errorHandler";
import type { AuthedRequest } from "../auth/tenantIsolation";

const router = Router();

router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) throw createError(401, "Unauthorized");
  const types = await equipmentTypeRepository.listActive(companyId);
  res.json(types);
}));

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Name must be 80 characters or less"),
});

router.post("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) throw createError(401, "Unauthorized");
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    const err = parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw createError(400, `Validation failed: ${err}`);
  }
  const created = await equipmentTypeRepository.createOrGet(companyId, parsed.data.name);
  res.status(201).json(created);
}));

export default router;
