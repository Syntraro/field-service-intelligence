/**
 * Tax API Routes — CRUD for tax rates and tax groups.
 * All endpoints require manager-level roles.
 */
import { Router, Response } from "express";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { taxRepository } from "../storage/tax";
import type { AuthedRequest } from "../auth/tenantIsolation";

const router = Router();

// ========================================
// VALIDATION SCHEMAS
// ========================================

const createTaxRateSchema = z.object({
  name: z.string().min(1).max(100),
  rate: z.string().regex(/^\d{1,3}(\.\d{1,4})?$/, "Rate must be a number with up to 4 decimal places"),
  description: z.string().max(500).optional(),
}).strict();

const updateTaxRateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  rate: z.string().regex(/^\d{1,3}(\.\d{1,4})?$/).optional(),
  description: z.string().max(500).optional(),
}).strict();

// 2026-05-05: reject the system-group prefix (`__sys_rate__:`) so a
// user-created group cannot collide with the auto-managed per-rate
// wrappers used by the invoice tax selector.
const SYSTEM_GROUP_PREFIX_PATTERN = /^__sys_rate__:/;
const userGroupName = z
  .string()
  .min(1)
  .max(100)
  .refine((s) => !SYSTEM_GROUP_PREFIX_PATTERN.test(s), {
    message: "Tax group name must not start with __sys_rate__: (reserved)",
  });

const createTaxGroupSchema = z.object({
  name: userGroupName,
  description: z.string().max(500).optional(),
  isDefault: z.boolean().optional(),
  rateIds: z.array(z.string().uuid()).min(1, "At least one tax rate is required"),
}).strict();

const updateTaxGroupSchema = z.object({
  name: userGroupName.optional(),
  description: z.string().max(500).optional(),
  isDefault: z.boolean().optional(),
  rateIds: z.array(z.string().uuid()).optional(),
}).strict();

// ========================================
// TAX RATES
// ========================================

/** GET /api/tax — List active tax rates */
router.get("/", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rates = await taxRepository.getTaxRates(req.companyId!);
  res.json(rates);
}));

/** POST /api/tax — Create a tax rate */
router.post("/", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = validateSchema(createTaxRateSchema, req.body);
  const created = await taxRepository.createTaxRate(req.companyId!, data);
  res.status(201).json(created);
}));

/** PUT /api/tax/:id — Update a tax rate */
router.put("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = validateSchema(updateTaxRateSchema, req.body);
  const existing = await taxRepository.getTaxRate(req.companyId!, req.params.id);
  if (!existing) throw createError(404, "Tax rate not found");

  const updated = await taxRepository.updateTaxRate(req.companyId!, req.params.id, data);
  res.json(updated);
}));

/** DELETE /api/tax/:id — Soft-delete a tax rate; friendly message if used on invoices */
router.delete("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const existing = await taxRepository.getTaxRate(req.companyId!, req.params.id);
  if (!existing) throw createError(404, "Tax rate not found");

  const result = await taxRepository.deleteTaxRate(req.companyId!, req.params.id);
  if (!result) throw createError(404, "Tax rate not found");

  res.json({
    success: true,
    deactivated: true,
    message: result.referencedByInvoices
      ? "Deactivated because it's used on invoices. Historical invoices are unaffected."
      : "Tax rate deleted.",
  });
}));

// ========================================
// TAX GROUPS
// ========================================

/** GET /api/tax/groups — List active tax groups with embedded rates */
router.get("/groups", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const groups = await taxRepository.getTaxGroups(req.companyId!);
  res.json(groups);
}));

/** GET /api/tax/groups/default — Get the default tax group */
router.get("/groups/default", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const group = await taxRepository.getDefaultTaxGroup(req.companyId!);
  res.json(group);
}));

/** POST /api/tax/groups — Create a tax group with rate IDs */
router.post("/groups", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = validateSchema(createTaxGroupSchema, req.body);
  const created = await taxRepository.createTaxGroup(req.companyId!, data);
  res.status(201).json(created);
}));

/** PUT /api/tax/groups/:id — Update a tax group */
router.put("/groups/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = validateSchema(updateTaxGroupSchema, req.body);
  const existing = await taxRepository.getTaxGroup(req.companyId!, req.params.id);
  if (!existing) throw createError(404, "Tax group not found");

  const updated = await taxRepository.updateTaxGroup(req.companyId!, req.params.id, data);
  res.json(updated);
}));

/** DELETE /api/tax/groups/:id — Soft-delete a tax group; friendly message if used on invoices */
router.delete("/groups/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const existing = await taxRepository.getTaxGroup(req.companyId!, req.params.id);
  if (!existing) throw createError(404, "Tax group not found");

  const result = await taxRepository.deleteTaxGroup(req.companyId!, req.params.id);
  if (!result) throw createError(404, "Tax group not found");

  res.json({
    success: true,
    deactivated: true,
    message: result.referencedByInvoices
      ? "Deactivated because it's used on invoices. Historical invoices are unaffected."
      : "Tax group deleted.",
  });
}));

/** POST /api/tax/groups/:id/set-default — Set a group as default */
router.post("/groups/:id/set-default", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const existing = await taxRepository.getTaxGroup(req.companyId!, req.params.id);
  if (!existing) throw createError(404, "Tax group not found");

  const updated = await taxRepository.setDefaultTaxGroup(req.companyId!, req.params.id);
  res.json(updated);
}));

export default router;
