import { Request, Response, NextFunction } from "express";
import type { FeatureKey } from "@shared/schema";
import { isPlatformRole } from "./roles";
import { entitlementService } from "../services/entitlementService";

/**
 * Feature gate middleware.
 *
 * 2026-04-21 Phase 1 canonical policy architecture:
 *   - Read path is now `entitlementService.getTenantEntitlements()`, NOT the
 *     legacy `tenantFeaturesRepository.isFeatureEnabled()` boolean-column
 *     table. The legacy table is preserved during Phase 1 as a compatibility
 *     surface; the migration `2026_04_21_feature_catalog_alignment.sql`
 *     backfilled tenant_feature_overrides from it so every tenant's
 *     effective answer is unchanged.
 *   - Legacy camelCase keys that callers pass in (`quotesEnabled`,
 *     `calendarEnabled`, etc.) are translated to canonical snake_case
 *     feature_keys via `LEGACY_TO_CANONICAL_KEY`. Callers do NOT need to
 *     migrate their middleware calls in Phase 1.
 *   - FAIL-CLOSED: if the resolver throws, the request is denied with a
 *     structured 500. Previously fell through to `next()` on error — that
 *     silent bypass is closed (audit Finding #7).
 *   - Platform-role bypass is preserved (support/debugging).
 *
 * Usage (unchanged):
 *   router.use(requireFeature("invoicesEnabled"));
 *   router.get("/...", requireFeature("multiTechEnabled"), handler);
 */

// Translation map: legacy camelCase key → canonical snake_case feature_key.
// Legacy keys are what FeatureKey (from tenant_features columns) exposes;
// canonical keys are what `subscription_features.feature_key` stores.
// Phase 1 keeps both alive; Phase 3 deletes the legacy layer and this map.
export const LEGACY_TO_CANONICAL_KEY: Record<FeatureKey, string> = {
  quotesEnabled: "quotes",
  invoicesEnabled: "invoices",
  calendarEnabled: "scheduling_calendar",
  qboEnabled: "quickbooks_online",
  routeOptimizationEnabled: "route_optimization",
  multiTechEnabled: "multi_tech_scheduling",
  liveMapEnabled: "live_map",
  customerPortalEnabled: "customer_portal",
  customerPortalPaymentsEnabled: "customer_portal_payments",
};

/** Resolve a legacy or canonical key to the canonical form used by the resolver. */
export function resolveCanonicalFeatureKey(key: string): string {
  return (LEGACY_TO_CANONICAL_KEY as Record<string, string>)[key] ?? key;
}

export function requireFeature(featureKey: FeatureKey | string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Platform roles bypass feature gates (for support/debugging). Uses the
    // REAL actor during impersonation to match requireRole / requirePlatformRole.
    const effectiveUser = (req as any).isImpersonating ? (req as any).realUser : req.user;
    if (isPlatformRole(effectiveUser?.role)) {
      return next();
    }

    const companyId = req.companyId;
    if (!companyId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const canonicalKey = resolveCanonicalFeatureKey(featureKey);

    try {
      const entitlement = await entitlementService.getEntitlement(companyId, canonicalKey);

      // Unknown canonical key = programming error (missing from catalog /
      // unseeded migration). Surface as 500 — not a tenant configuration
      // issue, not a silent pass.
      if (!entitlement) {
        console.error(
          `[requireFeature] Unknown feature key: passed="${featureKey}" canonical="${canonicalKey}" company=${companyId}`,
        );
        return res.status(500).json({
          error: "Feature configuration error",
          code: "FEATURE_UNKNOWN",
          feature: canonicalKey,
          message: "This feature is not configured on the server. Please contact support.",
        });
      }

      if (!entitlement.enabled) {
        return res.status(403).json({
          error: "Feature not available",
          code: "FEATURE_DISABLED",
          feature: canonicalKey,
          message: `The ${entitlement.displayName} feature is not enabled on your plan.`,
        });
      }

      next();
    } catch (error) {
      // 2026-04-21 Phase 1: fail-closed. The old fail-open branch silently
      // bypassed the gate on transient DB errors. That's wrong for a
      // security gate; surface as 500 and log for observability.
      console.error(
        `[requireFeature] Resolver error for feature="${canonicalKey}" company=${companyId}:`,
        error,
      );
      return res.status(500).json({
        error: "Feature check failed",
        code: "FEATURE_CHECK_ERROR",
        feature: canonicalKey,
        message: "Could not verify feature access. Please try again or contact support.",
      });
    }
  };
}
