/**
 * Platform Entitlement Admin Routes (2026-04-19).
 *
 * All endpoints mount under /api/platform/* (via server/routes/platform.ts)
 * and are guarded by requirePlatformRole. Thin routes — validate, delegate,
 * audit, return.
 *
 * No hard deletes. Plans + features are deactivated (active=false) rather
 * than removed.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { requirePlatformRole } from "../auth/requirePlatformRole";
import { entitlementStorage } from "../storage/entitlements";
import { entitlementService } from "../services/entitlementService";
import { usageMetricsService } from "../services/usageMetricsService";
import { platformAuditService } from "../services/platformAuditService";
// 2026-04-22 Admin Phase A1: canonical per-tenant timeline reader.
import { tenantTimelineService, TIMELINE_GROUPS } from "../services/tenantTimelineService";
// 2026-04-21 Phase 3: billing reads/writes on the `companies` table now live
// in the dedicated billingRepository (previously misnamed half of
// tenantFeaturesRepository).
import { billingRepository } from "../storage/billing";
// 2026-04-21 Phase 1 canonical policy architecture: subscriptionStatus +
// trialEndsAt writes route through the lifecycle service.
import { subscriptionLifecycleService } from "../services/subscriptionLifecycleService";
import {
  insertSubscriptionFeatureSchema,
  updateSubscriptionFeatureSchema,
  upsertPlanFeatureSchema,
  upsertTenantOverrideSchema,
  upsertPlanMetadataSchema,
  createPlanSchema,
  updatePlanSchema,
} from "@shared/schema";
import { db } from "../db";
import { companies } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

const router = Router();

// Defense-in-depth: parent router also applies requirePlatformRole.
router.use(requirePlatformRole());

// 2026-04-22 Revised Phase 1: mutation guards are per-capability now,
// applied per-route below. The legacy `canMutate` umbrella (allowed support
// + billing alongside admin) is gone — support can no longer write plans,
// features, overrides, or subscription state. Billing retains plan +
// lifecycle writes but LOSES feature-catalog + override writes.
import { requireCapability } from "../auth/requireCapability";

function auditActor(req: Request) {
  const user = (req as any).user;
  return {
    platformAdminId: user?.id ?? "unknown",
    platformAdminEmail: user?.email ?? "unknown",
  };
}

/**
 * 2026-04-20: precheck that a tenantId refers to a real company before any
 * mutating write. Without this, writes against a nonexistent UUID surface
 * as a raw Postgres FK violation (500) instead of a clean 404. Read-only
 * endpoints don't use this (returning an empty list / zero usage for an
 * unknown tenant is harmless and lets admins probe without fear).
 */
async function assertTenantExists(tenantId: string): Promise<void> {
  const [row] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, tenantId)).limit(1);
  if (!row) throw createError(404, "Tenant not found");
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

router.get("/plans", asyncHandler(async (_req: Request, res: Response) => {
  const plans = await entitlementStorage.listPlans();
  // Attach feature + tenant counts for the list surface. Single grouped
  // tenant-count query keeps the N+1 down.
  const tenantCountsRaw = await db
    .select({
      planName: companies.subscriptionPlan,
      count: sql<number>`count(*)::int`,
    })
    .from(companies)
    .groupBy(companies.subscriptionPlan);
  const tenantCountByPlanName = new Map<string, number>();
  for (const row of tenantCountsRaw) {
    if (row.planName) tenantCountByPlanName.set(row.planName, row.count);
  }
  const withCounts = await Promise.all(plans.map(async (p) => {
    const [planFeatures, metadata] = await Promise.all([
      entitlementStorage.listPlanFeatures(p.id),
      entitlementStorage.getPlanMetadata(p.id),
    ]);
    return {
      ...p,
      featureCount: planFeatures.length,
      enabledFeatureCount: planFeatures.filter((pf) => pf.enabled).length,
      tenantCount: tenantCountByPlanName.get(p.name) ?? 0,
      metadata,
    };
  }));
  res.json(withCounts);
}));

router.get("/plans/:planId", asyncHandler(async (req: Request, res: Response) => {
  const planId = req.params.planId;
  const plan = await entitlementStorage.getPlanById(planId);
  if (!plan) throw createError(404, "Plan not found");
  const [features, metadata] = await Promise.all([
    entitlementStorage.listPlanFeatures(planId),
    entitlementStorage.getPlanMetadata(planId),
  ]);
  res.json({ plan, metadata, features });
}));

router.post("/plans", requireCapability("plan:write"), asyncHandler(async (req: Request, res: Response) => {
  const data = validateSchema(createPlanSchema, req.body);
  const existing = await entitlementStorage.getPlanByName(data.name);
  if (existing) throw createError(400, `Plan name '${data.name}' already exists`);
  const plan = await entitlementStorage.createPlan(data);
  await platformAuditService.log({
    ...auditActor(req),
    action: "entitlement_plan_created",
    details: { planId: plan.id, name: plan.name, input: data },
    req,
  });
  res.status(201).json(plan);
}));

router.patch("/plans/:planId", requireCapability("plan:write"), asyncHandler(async (req: Request, res: Response) => {
  const planId = req.params.planId;
  const data = validateSchema(updatePlanSchema, req.body);
  const before = await entitlementStorage.getPlanById(planId);
  if (!before) throw createError(404, "Plan not found");
  const after = await entitlementStorage.updatePlan(planId, data);
  entitlementService.invalidateAllEntitlementsCache();
  await platformAuditService.log({
    ...auditActor(req),
    action: "entitlement_plan_updated",
    details: { planId, before, after, patch: data },
    req,
  });
  res.json(after);
}));

// ---------------------------------------------------------------------------
// Plan metadata
// ---------------------------------------------------------------------------

router.get("/plans/:planId/metadata", asyncHandler(async (req: Request, res: Response) => {
  const metadata = await entitlementStorage.getPlanMetadata(req.params.planId);
  res.json(metadata);
}));

router.put("/plans/:planId/metadata", requireCapability("plan:write"), asyncHandler(async (req: Request, res: Response) => {
  const planId = req.params.planId;
  const data = validateSchema(upsertPlanMetadataSchema, req.body);
  const plan = await entitlementStorage.getPlanById(planId);
  if (!plan) throw createError(404, "Plan not found");
  const before = await entitlementStorage.getPlanMetadata(planId);
  const after = await entitlementStorage.upsertPlanMetadata(planId, data);
  await platformAuditService.log({
    ...auditActor(req),
    action: "entitlement_plan_metadata_updated",
    details: { planId, before, after, patch: data },
    req,
  });
  res.json(after);
}));

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

router.get("/features", asyncHandler(async (_req: Request, res: Response) => {
  const features = await entitlementStorage.listFeatures();
  res.json(features);
}));

router.get("/features/:featureId", asyncHandler(async (req: Request, res: Response) => {
  const feature = await entitlementStorage.getFeatureById(req.params.featureId);
  if (!feature) throw createError(404, "Feature not found");
  res.json(feature);
}));

router.post("/features", requireCapability("feature:catalog:write"), asyncHandler(async (req: Request, res: Response) => {
  const data = validateSchema(insertSubscriptionFeatureSchema, req.body);
  const existing = await entitlementStorage.getFeatureByKey(data.featureKey);
  if (existing) throw createError(400, `Feature key '${data.featureKey}' already exists`);
  const feature = await entitlementStorage.createFeature(data);
  entitlementService.invalidateAllEntitlementsCache();
  await platformAuditService.log({
    ...auditActor(req),
    action: "entitlement_feature_created",
    details: { featureId: feature.id, featureKey: feature.featureKey, input: data },
    req,
  });
  res.status(201).json(feature);
}));

// NOTE: feature_key is IMMUTABLE — updateSubscriptionFeatureSchema does not
// accept it. Attempts to include it in the PATCH body are ignored by Zod's
// unknown-key stripping.
router.patch("/features/:featureId", requireCapability("feature:catalog:write"), asyncHandler(async (req: Request, res: Response) => {
  const featureId = req.params.featureId;
  const data = validateSchema(updateSubscriptionFeatureSchema, req.body);
  const before = await entitlementStorage.getFeatureById(featureId);
  if (!before) throw createError(404, "Feature not found");
  const after = await entitlementStorage.updateFeature(featureId, data);
  entitlementService.invalidateAllEntitlementsCache();
  await platformAuditService.log({
    ...auditActor(req),
    action: "entitlement_feature_updated",
    details: { featureId, before, after, patch: data },
    req,
  });
  res.json(after);
}));

// ---------------------------------------------------------------------------
// Plan-feature matrix
// ---------------------------------------------------------------------------

router.put(
  "/plans/:planId/features/:featureId",
  requireCapability("plan:write"),
  asyncHandler(async (req: Request, res: Response) => {
    const { planId, featureId } = req.params;
    const data = validateSchema(upsertPlanFeatureSchema, req.body);
    const [plan, feature] = await Promise.all([
      entitlementStorage.getPlanById(planId),
      entitlementStorage.getFeatureById(featureId),
    ]);
    if (!plan) throw createError(404, "Plan not found");
    if (!feature) throw createError(404, "Feature not found");
    // Core-feature protection: cannot be disabled in plan-feature table.
    // Resolver would override anyway, but reject at the write boundary so
    // audit trails don't show phantom "disable core" events.
    if (feature.isCore && data.enabled === false) {
      throw createError(400, `Cannot disable core feature '${feature.featureKey}' on a plan`);
    }
    const row = await entitlementStorage.upsertPlanFeature(planId, featureId, data);
    entitlementService.invalidateAllEntitlementsCache();
    await platformAuditService.log({
      ...auditActor(req),
      action: "entitlement_plan_feature_upsert",
      details: { planId, featureId, featureKey: feature.featureKey, input: data, row },
      req,
    });
    res.json(row);
  }),
);

router.post(
  "/plans/:planId/features/bulk",
  requireCapability("plan:write"),
  asyncHandler(async (req: Request, res: Response) => {
    const planId = req.params.planId;
    const bulkSchema = z.array(z.object({
      featureId: z.string().min(1),
      enabled: z.boolean(),
      limitValue: z.number().int().min(0).nullable().optional(),
    })).max(200);
    const items = validateSchema(bulkSchema, req.body);
    const plan = await entitlementStorage.getPlanById(planId);
    if (!plan) throw createError(404, "Plan not found");
    const results = [];
    for (const item of items) {
      const feature = await entitlementStorage.getFeatureById(item.featureId);
      if (!feature) continue;
      if (feature.isCore && item.enabled === false) continue; // silently skip (see single-upsert note)
      const row = await entitlementStorage.upsertPlanFeature(planId, item.featureId, item);
      results.push(row);
    }
    entitlementService.invalidateAllEntitlementsCache();
    await platformAuditService.log({
      ...auditActor(req),
      action: "entitlement_plan_feature_upsert",
      details: { planId, bulk: true, count: results.length },
      req,
    });
    res.json({ upserted: results.length, rows: results });
  }),
);

// ---------------------------------------------------------------------------
// Tenant subscription (plan assignment)
// ---------------------------------------------------------------------------

// 2026-04-26: subscriptionPlan made optional so trial-extend (sets only
// trialEndsAt) can route through this canonical platform endpoint after
// the legacy `PATCH /api/admin/tenants/:companyId/billing` was removed.
// At least one mutable field must be present — enforced post-parse.
const assignPlanSchema = z.object({
  subscriptionPlan: z.string().min(1).optional(),
  subscriptionStatus: z.enum(["trial", "active", "past_due", "cancelled", "paused"]).optional(),
  trialEndsAt: z.string().datetime().nullable().optional(),
});

router.get("/tenants/:tenantId/subscription", asyncHandler(async (req: Request, res: Response) => {
  const billing = await billingRepository.getBilling(req.params.tenantId);
  if (!billing) throw createError(404, "Tenant not found");
  res.json(billing);
}));

router.patch(
  "/tenants/:tenantId/subscription",
  requireCapability("tenant:lifecycle:write"),
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = req.params.tenantId;
    const data = validateSchema(assignPlanSchema, req.body);

    if (
      data.subscriptionPlan === undefined &&
      data.subscriptionStatus === undefined &&
      data.trialEndsAt === undefined
    ) {
      throw createError(
        400,
        "At least one of subscriptionPlan, subscriptionStatus, or trialEndsAt is required",
      );
    }

    if (data.subscriptionPlan !== undefined) {
      const plan = await entitlementStorage.getPlanByName(data.subscriptionPlan);
      if (!plan) throw createError(400, `Unknown plan '${data.subscriptionPlan}'`);
    }
    const before = await billingRepository.getBilling(tenantId);
    if (!before) throw createError(404, "Tenant not found");

    // 2026-04-21 Phase 1 canonical policy architecture:
    //   subscriptionStatus + trialEndsAt go through the lifecycle service.
    //   subscriptionPlan (plan assignment) is a non-lifecycle field and
    //   writes through the billingRepository.
    const trialEndsAtValue = data.trialEndsAt !== undefined
      ? (data.trialEndsAt ? new Date(data.trialEndsAt) : null)
      : undefined;

    if (data.subscriptionStatus !== undefined || trialEndsAtValue !== undefined) {
      await subscriptionLifecycleService.transition({
        companyId: tenantId,
        to: data.subscriptionStatus ?? (before.subscriptionStatus as any),
        ...(trialEndsAtValue !== undefined && { trialEndsAt: trialEndsAtValue }),
        source: "platform_plan_assign",
        actorUserId: (req as any).user?.id,
        reason: data.subscriptionPlan
          ? `Platform plan assignment → ${data.subscriptionPlan}`
          : "Platform subscription update",
      });
    }

    if (data.subscriptionPlan !== undefined) {
      await billingRepository.updateBilling(tenantId, {
        subscriptionPlan: data.subscriptionPlan,
      });
    }

    const after = await billingRepository.getBilling(tenantId);
    entitlementService.invalidateEntitlementsCache(tenantId);
    await platformAuditService.log({
      ...auditActor(req),
      action: "entitlement_tenant_plan_assigned",
      targetCompanyId: tenantId,
      details: { tenantId, before, after, patch: data },
      req,
    });
    res.json(after);
  }),
);

// ---------------------------------------------------------------------------
// Tenant overrides
// ---------------------------------------------------------------------------

router.get("/tenants/:tenantId/overrides", asyncHandler(async (req: Request, res: Response) => {
  const overrides = await entitlementStorage.listOverrides(req.params.tenantId);
  res.json(overrides);
}));

router.put(
  "/tenants/:tenantId/overrides/:featureKey",
  requireCapability("entitlement:override:write"),
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId, featureKey } = req.params;
    const data = validateSchema(upsertTenantOverrideSchema, req.body);
    await assertTenantExists(tenantId);
    const feature = await entitlementStorage.getFeatureByKey(featureKey);
    if (!feature) throw createError(404, `Unknown feature '${featureKey}'`);
    if (feature.isCore && data.enabled === false) {
      throw createError(400, `Cannot disable core feature '${featureKey}' via override`);
    }
    const row = await entitlementStorage.upsertOverride(tenantId, feature.id, data);
    entitlementService.invalidateEntitlementsCache(tenantId);
    await platformAuditService.log({
      ...auditActor(req),
      action: "entitlement_tenant_override_upsert",
      targetCompanyId: tenantId,
      details: { tenantId, featureKey, featureId: feature.id, input: data, row },
      req,
    });
    res.json(row);
  }),
);

router.delete(
  "/tenants/:tenantId/overrides/:featureKey",
  requireCapability("entitlement:override:write"),
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId, featureKey } = req.params;
    await assertTenantExists(tenantId);
    const feature = await entitlementStorage.getFeatureByKey(featureKey);
    if (!feature) throw createError(404, `Unknown feature '${featureKey}'`);
    const removed = await entitlementStorage.deleteOverride(tenantId, feature.id);
    entitlementService.invalidateEntitlementsCache(tenantId);
    await platformAuditService.log({
      ...auditActor(req),
      action: "entitlement_tenant_override_removed",
      targetCompanyId: tenantId,
      details: { tenantId, featureKey, featureId: feature.id, removed },
      req,
    });
    res.json({ removed: removed !== null });
  }),
);

// ---------------------------------------------------------------------------
// Entitlements + usage read surfaces
// ---------------------------------------------------------------------------

router.get("/tenants/:tenantId/entitlements", asyncHandler(async (req: Request, res: Response) => {
  const entitlements = await entitlementService.getTenantEntitlements(req.params.tenantId);
  res.json(entitlements);
}));

router.get("/tenants/:tenantId/usage", asyncHandler(async (req: Request, res: Response) => {
  const usage = await usageMetricsService.getUsageSummary(req.params.tenantId);
  res.json(usage);
}));

// ---------------------------------------------------------------------------
// Canonical per-tenant timeline (2026-04-22 Admin Phase A1)
// ---------------------------------------------------------------------------
//
// Unifies subscription_events + audit_logs + impersonation_sessions +
// tenant_feature_overrides + feedback + issue_reports into one chronological
// stream. See server/services/tenantTimelineService.ts for the normalized
// event shape. Read-only; mounted here (not on a new router) because it's a
// platform-admin tenant-detail read and shares auth / params with its
// siblings.

const timelineQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  before: z.string().datetime().optional(),
  // Express delivers repeated `?kinds[]=subscription&kinds[]=audit` as a
  // string[], a bare `?kinds=subscription` as a string. Accept either +
  // comma-separated for operator convenience; normalize in the handler.
  kinds: z.union([z.string(), z.array(z.string())]).optional(),
});

router.get(
  "/tenants/:tenantId/timeline",
  asyncHandler(async (req: Request, res: Response) => {
    const params = validateSchema(timelineQuerySchema, req.query);

    const rawKinds = params.kinds;
    const kindsArr: string[] =
      rawKinds === undefined ? []
        : Array.isArray(rawKinds) ? rawKinds
        : rawKinds.split(",");
    const kinds = kindsArr
      .map((s) => s.trim())
      .filter((k): k is (typeof TIMELINE_GROUPS)[number] =>
        (TIMELINE_GROUPS as readonly string[]).includes(k),
      );

    const result = await tenantTimelineService.getTimeline({
      companyId: req.params.tenantId,
      limit: params.limit,
      before: params.before ? new Date(params.before) : undefined,
      kinds: kinds.length > 0 ? kinds : undefined,
    });

    res.json(result);
  }),
);

export default router;
