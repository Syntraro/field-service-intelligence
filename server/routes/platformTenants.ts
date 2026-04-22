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
import { platformTenantsService } from "../services/platformTenantsService";
import { requirePlatformRole } from "../auth/requirePlatformRole";
// 2026-04-22 Admin Phase A4: canonical tenant-health service for the
// dedicated single-tenant read endpoint.
import { tenantHealthService } from "../services/tenantHealthService";
// 2026-04-22 Admin Phase A6.1: bulk tenant-operation orchestrator.
import { bulkTenantOpsService, type BulkRequest } from "../services/bulkTenantOpsService";

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
  // 2026-04-22 Admin Phase A4: when `health` is selected, the service
  // overfetches and sorts worst-first. Default keeps createdAt ordering.
  sortBy: z.enum(["createdAt", "health"]).optional(),
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

// GET /api/platform/tenants/:tenantId/health — single-tenant canonical
// health snapshot. Read-only; score / status / reasons / last-activity.
// Separate from the list-enriched shape so the tenant-detail page can
// refresh health independently after a lifecycle action.
platformTenantsRouter.get(
  "/:tenantId/health",
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = validateSchema(tenantIdParamSchema, req.params);
    const health = await tenantHealthService.getHealthForCompany(tenantId);
    if (!health) throw createError(404, "Tenant not found");
    res.json(health);
  }),
);

// 2026-04-21 Phase 3 canonical policy architecture:
//   GET + PATCH /api/platform/tenants/:tenantId/features have been
//   deleted. Platform-admin feature reads/writes flow through the
//   canonical entitlement surfaces on platformEntitlements.ts:
//     GET /api/platform/tenants/:tenantId/entitlements
//     PUT /api/platform/tenants/:tenantId/overrides/:featureKey
//     DELETE /api/platform/tenants/:tenantId/overrides/:featureKey
//   The tenant_features boolean-column table is being dropped.

// ============================================================================
// 2026-04-22 Admin Phase A6.1 — Bulk tenant actions
// ============================================================================
//
// POST /api/platform/tenants/bulk
//
// Six whitelisted actions: extend_trial | assign_plan | pause_subscription
// | reactivate_subscription | add_override | remove_override. Each action's
// per-tenant write flows through the exact same canonical writer as the
// single-tenant path — no duplicate write roots, no new tables.
//
// Response is a per-tenant result list so the operator UI can surface
// success / failure per row without hiding partial outcomes.

const BULK_WRITE_ROLES = ["platform_admin", "platform_support", "platform_billing"] as const;

const tenantIdsSchema = z.array(z.string().min(1)).min(1).max(200);

const bulkBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("extend_trial"),
    tenantIds: tenantIdsSchema,
    params: z.object({
      extendDays: z.union([z.literal(7), z.literal(14)]),
    }),
  }),
  z.object({
    action: z.literal("assign_plan"),
    tenantIds: tenantIdsSchema,
    params: z.object({
      planName: z.string().min(1),
    }),
  }),
  z.object({
    action: z.literal("pause_subscription"),
    tenantIds: tenantIdsSchema,
    params: z.object({
      reason: z.string().max(500).nullable().optional(),
    }),
  }),
  z.object({
    action: z.literal("reactivate_subscription"),
    tenantIds: tenantIdsSchema,
    params: z.object({
      reason: z.string().max(500).nullable().optional(),
    }),
  }),
  z.object({
    action: z.literal("add_override"),
    tenantIds: tenantIdsSchema,
    params: z.object({
      featureKey: z.string().min(1),
      enabled: z.boolean().nullable().optional(),
      limitValue: z.number().int().min(0).nullable().optional(),
      reason: z.string().max(500).nullable().optional(),
    }).refine(
      (d) => d.enabled !== undefined || Object.prototype.hasOwnProperty.call(d, "limitValue"),
      { message: "Override must set at least one of `enabled` or `limitValue`" },
    ),
  }),
  z.object({
    action: z.literal("remove_override"),
    tenantIds: tenantIdsSchema,
    params: z.object({
      featureKey: z.string().min(1),
    }),
  }),
]);

platformTenantsRouter.post(
  "/bulk",
  requirePlatformRole(BULK_WRITE_ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const body = validateSchema(bulkBodySchema, req.body);

    const actorSource = (req as any).isImpersonating ? (req as any).realUser : req.user;
    if (!actorSource?.id) throw createError(401, "Unauthorized");

    // Build the BulkRequest discriminated union. We branch on action so the
    // `params` field carries the right shape — including `limitProvided` for
    // add_override, which matches the single-tenant upsert contract.
    let bulkReq: BulkRequest;
    const actor = { id: actorSource.id as string, email: (actorSource.email as string) ?? "unknown" };
    switch (body.action) {
      case "extend_trial":
        bulkReq = { action: "extend_trial", tenantIds: body.tenantIds, params: body.params, actor, req };
        break;
      case "assign_plan":
        bulkReq = { action: "assign_plan", tenantIds: body.tenantIds, params: body.params, actor, req };
        break;
      case "pause_subscription":
        bulkReq = { action: "pause_subscription", tenantIds: body.tenantIds, params: body.params, actor, req };
        break;
      case "reactivate_subscription":
        bulkReq = { action: "reactivate_subscription", tenantIds: body.tenantIds, params: body.params, actor, req };
        break;
      case "add_override": {
        const limitProvided = Object.prototype.hasOwnProperty.call(body.params, "limitValue");
        bulkReq = {
          action: "add_override",
          tenantIds: body.tenantIds,
          params: { ...body.params, limitProvided },
          actor,
          req,
        };
        break;
      }
      case "remove_override":
        bulkReq = { action: "remove_override", tenantIds: body.tenantIds, params: body.params, actor, req };
        break;
    }

    const result = await bulkTenantOpsService.run(bulkReq);
    res.json(result);
  }),
);

export default platformTenantsRouter;
