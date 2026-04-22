/**
 * /api/me — Routes that operate on the currently authenticated user's scope.
 *
 * 2026-04-21 Phase 1 canonical policy architecture:
 *   - GET /api/me/entitlements: single canonical read path for feature +
 *     limit + usage + account state. Consumed by the Phase 1 `useEntitlements`
 *     client hook. Phase 2 migrates existing `useTenantFeatures` callers onto
 *     it.
 *   - GET /api/me/permissions: current user's effective permission set (role
 *     permissions + user overrides). Consumed by the Phase 1
 *     `useEffectivePermissions` client hook.
 */

import { Router, Response } from "express";
import { asyncHandler, createError } from "../middleware/errorHandler";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { entitlementService } from "../services/entitlementService";
import { usageMetricsService } from "../services/usageMetricsService";
import { subscriptionRepository } from "../storage/subscriptions";
import { permissionRepository } from "../storage/permissions";

const router = Router();

/**
 * GET /api/me/entitlements
 *
 * Returns the canonical entitlement matrix for the current user's company:
 *   - `features`:  map of featureKey → { enabled, source, ... }
 *   - `limits`:    map of featureKey → { limit, usage, isUnlimited }
 *   - `usage`:     raw per-feature count map (mirrors limits.usage for
 *                  callers that only need counts)
 *   - `accountState`: derived from companies.subscriptionStatus +
 *                     trialEndsAt, matches existing SubscriptionBanner shape
 *   - `plan`:      the resolved plan name (null if none)
 *
 * Designed to be the ONE thing the client reads to drive feature UI +
 * subscription banner + limit displays. Existing legacy surfaces
 * (`useTenantFeatures` → `/api/company-settings/features`,
 * `useQuery(["/api/subscriptions/usage"])`) are unchanged in Phase 1.
 */
router.get(
  "/entitlements",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) throw createError(401, "Unauthorized");

    const [entitlements, usageSummary, subUsage] = await Promise.all([
      entitlementService.getTenantEntitlements(companyId),
      usageMetricsService.getUsageSummary(companyId),
      subscriptionRepository.getSubscriptionUsage(companyId),
    ]);

    // Shape features as { [featureKey]: { enabled, source, ... } } so
    // callers can do `features[key].enabled` instead of Array.find().
    const features: Record<string, {
      enabled: boolean;
      source: string;
      isCore: boolean;
      category: string;
      displayName: string;
    }> = {};
    const limits: Record<string, {
      limit: number | null;
      usage: number;
      isUnlimited: boolean;
      limitType: string;
    }> = {};

    for (const e of entitlements.entitlements) {
      features[e.featureKey] = {
        enabled: e.enabled,
        source: e.source,
        isCore: e.isCore,
        category: e.category,
        displayName: e.displayName,
      };
      const usage = usageSummary[e.featureKey] ?? 0;
      limits[e.featureKey] = {
        limit: e.limitValue,
        usage,
        isUnlimited: e.isUnlimited,
        limitType: e.limitType,
      };
    }

    res.json({
      companyId,
      plan: {
        id: entitlements.planId,
        name: entitlements.planName,
      },
      accountState: {
        subscriptionStatus: subUsage.subscriptionStatus,
        entitled: subUsage.entitled,
        reason: subUsage.entitlementReason,
        trialEndsAt: subUsage.trialEndsAt,
      },
      features,
      limits,
      usage: usageSummary,
    });
  }),
);

/**
 * GET /api/me/permissions
 *
 * Returns the effective permission key set for the currently authenticated
 * user (role permissions merged with user-specific overrides).
 *
 * Not a policy-enforcement surface — this is a READ endpoint so the client
 * can fetch the user's permission list for UI affordance decisions.
 * Enforcement continues to run server-side via requireRole +
 * requirePermission middleware on every protected route.
 */
router.get(
  "/permissions",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) throw createError(401, "Unauthorized");

    const perms = await permissionRepository.getUserEffectivePermissions(userId);
    res.json({
      userId,
      permissions: Array.from(perms).sort(),
    });
  }),
);

export default router;
