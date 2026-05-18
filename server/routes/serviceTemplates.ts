/**
 * Service Templates API (2026-05-18 RALPH Phase 1).
 *
 * Mounted at `/api/service-templates`.
 * Reads are open (any authed staff may read templates for picker use).
 * Writes require requireRole(MANAGER_ROLES) + requirePermission("pricing.edit"),
 * mirroring the /api/pricebook-groups write contract.
 *
 * Endpoints
 * ---------
 *   GET    /api/service-templates
 *           Returns all active (non-deleted) templates for the tenant
 *           with their components, ordered by usage_count DESC, name ASC.
 *
 *   POST   /api/service-templates
 *           Creates a new template (no components). Name collision → 409.
 *           Returns the created template (201).
 *
 *   GET    /api/service-templates/:id
 *           Returns a single template with components. 404 if not found.
 *
 *   PATCH  /api/service-templates/:id
 *           Updates mutable fields. Name collision → 409. 404 if not found.
 *
 *   PUT    /api/service-templates/:id/components
 *           Replaces the full component list in one transaction.
 *           Cross-tenant item id → 400.
 *
 *   DELETE /api/service-templates/:id
 *           Soft-deletes the template (sets deleted_at). 404 if not found.
 *
 *   POST   /api/service-templates/:id/usage
 *           Atomically increments usage_count. Open to any authed user.
 */
import { Router, type Response } from "express";
import { z } from "zod";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { requirePermission } from "../permissions";
import {
  serviceTemplateRepository,
  ServiceTemplateNameConflictError,
  ServiceTemplateComponentItemError,
} from "../storage/serviceTemplates";

const router = Router();

// ─── Validation schemas ─────────────────────────────────────────────

const numericPriceSchema = z.preprocess(
  (v) => (typeof v === "number" ? String(v) : v),
  z.string().refine((v) => /^\d+(\.\d{1,2})?$/.test(v), {
    message: "Must be a non-negative numeric value with up to 2 decimal places",
  }),
);

const createTemplateSchema = z
  .object({
    name: z.string().min(1).max(200),
    internalName: z.string().max(200).optional().nullable(),
    description: z.string().max(2000).optional().nullable(),
    internalNotes: z.string().max(2000).optional().nullable(),
    category: z.string().max(120).optional().nullable(),
    subcategory: z.string().max(120).optional().nullable(),
    flatRatePrice: numericPriceSchema,
    estimatedDurationMinutes: z.number().int().positive().optional().nullable(),
    requiredSkillTags: z.array(z.string().max(100)).max(20).optional(),
    teamSizeRequired: z.number().int().min(1).max(20).optional(),
  })
  .strict();

const updateTemplateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    internalName: z.string().max(200).optional().nullable(),
    description: z.string().max(2000).optional().nullable(),
    internalNotes: z.string().max(2000).optional().nullable(),
    category: z.string().max(120).optional().nullable(),
    subcategory: z.string().max(120).optional().nullable(),
    flatRatePrice: numericPriceSchema.optional(),
    estimatedDurationMinutes: z.number().int().positive().optional().nullable(),
    requiredSkillTags: z.array(z.string().max(100)).max(20).optional(),
    teamSizeRequired: z.number().int().min(1).max(20).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const componentSchema = z
  .object({
    itemId: z.string().uuid(),
    quantity: z.preprocess(
      (v) => (typeof v === "number" ? String(v) : v),
      z.string().refine((v) => /^[1-9]\d*(\.\d{1,2})?$/.test(v), {
        message: "quantity must be a positive numeric string",
      }),
    ),
    unitCostSnapshot: z.preprocess(
      (v) => (typeof v === "number" ? String(v) : v),
      z.string().refine((v) => /^\d+(\.\d{1,2})?$/.test(v)).optional(),
    ).optional().nullable(),
    sortOrder: z.number().int().min(0).max(999).optional(),
    notes: z.string().max(500).optional().nullable(),
  })
  .strict();

const setComponentsSchema = z
  .object({
    components: z.array(componentSchema).max(50),
  })
  .strict();

// ─── GET / ──────────────────────────────────────────────────────────

router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) throw createError(401, "Unauthorized");
    const templates = await serviceTemplateRepository.listForCompany(companyId);
    res.json(templates);
  }),
);

// ─── POST / ─────────────────────────────────────────────────────────

router.post(
  "/",
  requireRole(MANAGER_ROLES),
  requirePermission("pricing.edit"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const userId = req.user?.id ?? null;
    if (!companyId) throw createError(401, "Unauthorized");
    const body = validateSchema(createTemplateSchema, req.body);
    try {
      const created = await serviceTemplateRepository.create(companyId, userId, body as any);
      res.status(201).json(created);
    } catch (err) {
      if (err instanceof ServiceTemplateNameConflictError) throw createError(409, err.message);
      throw err;
    }
  }),
);

// ─── GET /:id ───────────────────────────────────────────────────────

router.get(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) throw createError(401, "Unauthorized");
    const template = await serviceTemplateRepository.getById(companyId, req.params.id);
    if (!template) throw createError(404, "Service template not found");
    res.json(template);
  }),
);

// ─── PATCH /:id ─────────────────────────────────────────────────────

router.patch(
  "/:id",
  requireRole(MANAGER_ROLES),
  requirePermission("pricing.edit"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) throw createError(401, "Unauthorized");
    const body = validateSchema(updateTemplateSchema, req.body);
    try {
      const updated = await serviceTemplateRepository.update(companyId, req.params.id, body as any);
      if (!updated) throw createError(404, "Service template not found");
      res.json(updated);
    } catch (err) {
      if (err instanceof ServiceTemplateNameConflictError) throw createError(409, err.message);
      throw err;
    }
  }),
);

// ─── PUT /:id/components ────────────────────────────────────────────

router.put(
  "/:id/components",
  requireRole(MANAGER_ROLES),
  requirePermission("pricing.edit"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) throw createError(401, "Unauthorized");
    const body = validateSchema(setComponentsSchema, req.body);
    try {
      const result = await serviceTemplateRepository.setComponents(
        companyId,
        req.params.id,
        body.components as any,
      );
      if (!result) throw createError(404, "Service template not found");
      res.json(result);
    } catch (err) {
      if (err instanceof ServiceTemplateComponentItemError) throw createError(400, err.message);
      throw err;
    }
  }),
);

// ─── DELETE /:id ────────────────────────────────────────────────────

router.delete(
  "/:id",
  requireRole(MANAGER_ROLES),
  requirePermission("pricing.edit"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) throw createError(401, "Unauthorized");
    const ok = await serviceTemplateRepository.softDelete(companyId, req.params.id);
    if (!ok) throw createError(404, "Service template not found");
    res.json({ ok: true });
  }),
);

// ─── POST /:id/usage ────────────────────────────────────────────────

router.post(
  "/:id/usage",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) throw createError(401, "Unauthorized");
    await serviceTemplateRepository.incrementUsage(companyId, req.params.id);
    res.status(204).end();
  }),
);

export default router;
