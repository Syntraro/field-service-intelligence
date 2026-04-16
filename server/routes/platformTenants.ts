/**
 * Platform Tenants Routes — Phase 2 (Ops Portal Core).
 *
 * Mounted at /api/platform/tenants (see server/routes/platform.ts).
 * All routes run behind requirePlatformRole(); tenant scoping does not apply
 * to /api/platform/* (see ensureTenantContext skip).
 *
 * Thin routes — validate input, delegate to platformTenantsService, return JSON.
 * No DB access here, no business logic.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { updateTenantFeaturesSchema } from "@shared/schema";
import { platformTenantsService } from "../services/platformTenantsService";
import { requirePlatformRole } from "../auth/requirePlatformRole";

const platformTenantsRouter = Router();

// Defense-in-depth: the parent /api/platform router already applies
// requirePlatformRole; repeat here so this file cannot be mis-mounted.
platformTenantsRouter.use(requirePlatformRole());

// --- Validation schemas ---

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.string().trim().max(50).optional(),
  plan: z.string().trim().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const tenantIdParamSchema = z.object({
  tenantId: z.string().min(1, "tenantId required"),
});

// --- Routes ---

// GET /api/platform/tenants — lightweight search list
platformTenantsRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const params = validateSchema(listQuerySchema, req.query);
    const result = await platformTenantsService.searchTenants(params);
    res.json(result);
  }),
);

// GET /api/platform/tenants/:tenantId — full detail
platformTenantsRouter.get(
  "/:tenantId",
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = validateSchema(tenantIdParamSchema, req.params);
    const detail = await platformTenantsService.getTenantDetail(tenantId);
    if (!detail) throw createError(404, "Tenant not found");
    res.json(detail);
  }),
);

// GET /api/platform/tenants/:tenantId/features
platformTenantsRouter.get(
  "/:tenantId/features",
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = validateSchema(tenantIdParamSchema, req.params);
    const features = await platformTenantsService.getTenantFeatures(tenantId);
    if (!features) throw createError(404, "Tenant not found");
    res.json(features);
  }),
);

// PATCH /api/platform/tenants/:tenantId/features — audited mutation.
// Phase 3: platform_readonly_audit is explicitly denied. Carryover role-matrix
// fix from Phase 2 (risk #6).
platformTenantsRouter.patch(
  "/:tenantId/features",
  requirePlatformRole(["platform_admin", "platform_support", "platform_billing"]),
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = validateSchema(tenantIdParamSchema, req.params);
    const updates = validateSchema(updateTenantFeaturesSchema, req.body);

    // Real actor (matches platform/requireRole semantics under impersonation).
    const actorSource = (req as any).isImpersonating ? (req as any).realUser : req.user;
    if (!actorSource?.id) throw createError(401, "Unauthorized");

    const updated = await platformTenantsService.updateTenantFeatures({
      tenantId,
      updates,
      actor: { id: actorSource.id, email: actorSource.email ?? "unknown" },
      req,
    });

    if (!updated) throw createError(404, "Tenant not found");
    res.json(updated);
  }),
);

export default platformTenantsRouter;
