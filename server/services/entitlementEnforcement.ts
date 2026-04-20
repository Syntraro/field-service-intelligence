/**
 * Entitlement enforcement helpers (2026-04-19).
 *
 * Route/service-layer guards for the canonical entitlement system. Wrap
 * `assertFeatureAccess` or `assertFeatureCapacity` around any capped/gated
 * operation so denial behavior is consistent across surfaces.
 *
 * Error shape matches the existing `requireFeature` middleware so frontend
 * error handling stays unchanged:
 *   { error: "Feature not available", code: "FEATURE_DISABLED", feature, message }
 *   { error: "Limit reached",         code: "FEATURE_LIMIT_REACHED", feature, current, limit }
 */

import { createError } from "../middleware/errorHandler";
import { entitlementService } from "./entitlementService";
import { usageMetricsService } from "./usageMetricsService";

/**
 * Factory for 403 errors carrying the feature-key + extra context fields
 * on the Error object. `handleApiError` already surfaces `.code`; the
 * `feature` / `current` / `limit` fields are attached for callers that
 * inspect the thrown error directly (e.g. structured UI handling).
 */
function featureError(
  status: 403 | 500,
  message: string,
  code: "FEATURE_DISABLED" | "FEATURE_LIMIT_REACHED" | "FEATURE_UNKNOWN",
  featureKey: string,
  extra?: Record<string, unknown>,
): Error {
  const err = createError(status, message, code) as any;
  err.feature = featureKey;
  if (extra) Object.assign(err, extra);
  return err;
}

/**
 * Throws a 403 if the feature is disabled for the tenant. Core features
 * always pass. Unknown feature keys (not in the catalog) throw 500 — that
 * indicates a programming error, not a tenant configuration issue.
 */
export async function assertFeatureAccess(companyId: string, featureKey: string): Promise<void> {
  const entitlement = await entitlementService.getEntitlement(companyId, featureKey);
  if (!entitlement) {
    throw featureError(500, `Unknown feature key: ${featureKey}`, "FEATURE_UNKNOWN", featureKey);
  }
  if (!entitlement.enabled) {
    throw featureError(
      403,
      `The ${entitlement.displayName} feature is not enabled on your plan.`,
      "FEATURE_DISABLED",
      featureKey,
    );
  }
}

/**
 * Throws 403 if the feature is disabled OR if adding `nextIncrement` more of
 * this feature would exceed the limit. `currentCount` must already count the
 * tenant's existing usage (caller responsibility — use usageMetricsService).
 *
 * Null limit = unlimited (always allowed). Core features never cap-deny.
 */
export async function assertFeatureCapacity(
  companyId: string,
  featureKey: string,
  currentCount: number,
  nextIncrement: number = 1,
): Promise<void> {
  const entitlement = await entitlementService.getEntitlement(companyId, featureKey);
  if (!entitlement) {
    throw featureError(500, `Unknown feature key: ${featureKey}`, "FEATURE_UNKNOWN", featureKey);
  }
  if (!entitlement.enabled) {
    throw featureError(
      403,
      `The ${entitlement.displayName} feature is not enabled on your plan.`,
      "FEATURE_DISABLED",
      featureKey,
    );
  }
  // Core features: always allowed regardless of cap (business-critical surfaces)
  if (entitlement.isCore) return;
  // Unlimited: always allowed
  if (entitlement.isUnlimited || entitlement.limitValue === null) return;
  const projected = currentCount + nextIncrement;
  if (projected > entitlement.limitValue) {
    throw featureError(
      403,
      `You've reached the ${entitlement.displayName} limit (${entitlement.limitValue}) on your plan.`,
      "FEATURE_LIMIT_REACHED",
      featureKey,
      { current: currentCount, limit: entitlement.limitValue },
    );
  }
}

/**
 * Convenience: auto-counts current usage via usageMetricsService before the
 * capacity check. Prefer the explicit `assertFeatureCapacity` above when the
 * caller already has the count in hand (saves a query).
 */
export async function assertFeatureCapacityAuto(
  companyId: string,
  featureKey: string,
  nextIncrement: number = 1,
): Promise<void> {
  const current = await usageMetricsService.getUsage(companyId, featureKey);
  await assertFeatureCapacity(companyId, featureKey, current, nextIncrement);
}

export const entitlementEnforcement = {
  assertFeatureAccess,
  assertFeatureCapacity,
  assertFeatureCapacityAuto,
};
