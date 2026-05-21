/**
 * Canonical entitlement resolver (2026-04-19).
 *
 * Single source of truth for "is feature X enabled / what's the cap" for any
 * tenant going forward. Parallel to the legacy `tenant_features` boolean-
 * column table + `requireFeature` middleware — those keep working unchanged;
 * new checks should go through this service.
 *
 * Resolution precedence (strict, no fallbacks):
 *   1. tenant_feature_overrides row exists with enabled != null → use override
 *   2. subscription_plan_features row exists for the tenant's plan → use plan
 *   3. feature.is_core = true → always enabled, unlimited
 *   4. else → denied (enabled: false)
 *
 * Limit precedence (same tiers):
 *   1. override.limit_value (if non-null)
 *   2. plan_feature.limit_value (if non-null)
 *   3. null (unlimited) — for core features or unspecified non-core
 *
 * Null limit_value = unlimited.
 * Core features bypass plan/override enablement — they are always enabled.
 */

import { db } from "../db";
import { eq } from "drizzle-orm";
import { companies } from "@shared/schema";
import { entitlementStorage } from "../storage/entitlements";
import type {
  SubscriptionFeature,
  SubscriptionPlanFeature,
  TenantFeatureOverride,
  FeatureLimitType,
} from "@shared/schema";
import { cache, CacheTTL } from "./cache";

export type EntitlementSource = "override" | "plan" | "core" | "default";

export interface Entitlement {
  featureKey: string;
  featureId: string;
  displayName: string;
  category: string;
  isCore: boolean;
  enabled: boolean;
  limitType: FeatureLimitType;
  limitValue: number | null;
  isUnlimited: boolean;
  source: EntitlementSource;
  reason: string | null;
}

export interface TenantEntitlements {
  companyId: string;
  planId: string | null;
  planName: string | null;
  entitlements: Entitlement[];
}

const CACHE_PREFIX = "entitlements:";
function cacheKey(companyId: string): string {
  return `${CACHE_PREFIX}${companyId}`;
}

export function invalidateEntitlementsCache(companyId: string): void {
  cache.delete(cacheKey(companyId));
}

/**
 * Invalidate the resolver cache for every tenant. Used after plan or feature
 * catalog changes that would shift entitlements globally.
 */
export function invalidateAllEntitlementsCache(): void {
  // Cache impl has no namespace wipe — safest is to bump a generation token.
  // Every write path that touches plans/features/plan_features calls this;
  // short-TTL (5 min) cache means stale entries age out quickly.
  cache.clear();
}

/**
 * Resolve every entitlement for a tenant. Builds the matrix over ALL active
 * features in the catalog (not just those the plan explicitly configures),
 * so callers always get a complete answer for any feature_key the system
 * knows about.
 */
export async function getTenantEntitlements(companyId: string): Promise<TenantEntitlements> {
  const cached = cache.get<TenantEntitlements>(cacheKey(companyId));
  if (cached) return cached;

  const [companyRow] = await db.select({
    subscriptionPlan: companies.subscriptionPlan,
  }).from(companies).where(eq(companies.id, companyId)).limit(1);

  const planName = companyRow?.subscriptionPlan ?? null;
  const plan = planName ? await entitlementStorage.getPlanByName(planName) : null;
  const planId = plan?.id ?? null;

  const [features, planFeatures, overrides] = await Promise.all([
    entitlementStorage.getActiveFeatures(),
    planId ? entitlementStorage.getPlanFeaturesForPlanIds([planId]) : Promise.resolve([] as SubscriptionPlanFeature[]),
    entitlementStorage.listOverrides(companyId),
  ]);

  const planFeatureByFeatureId = new Map<string, SubscriptionPlanFeature>();
  for (const pf of planFeatures) planFeatureByFeatureId.set(pf.featureId, pf);
  const overrideByFeatureId = new Map<string, TenantFeatureOverride>();
  for (const o of overrides) overrideByFeatureId.set(o.featureId, o);

  const entitlements = features.map((f) => resolveOne(f, planFeatureByFeatureId.get(f.id), overrideByFeatureId.get(f.id)));

  const result: TenantEntitlements = { companyId, planId, planName, entitlements };
  cache.set(cacheKey(companyId), result, CacheTTL.MEDIUM);
  return result;
}

/**
 * 2026-04-20: canonical limit-value precedence across all enablement sources.
 *
 *   - override.limit_overridden = true  → override.limit_value wins (NULL here
 *                                           = unlimited for this tenant).
 *   - else if plan_feature exists       → plan_feature.limit_value
 *   - else                              → null (unlimited)
 *
 * The override branch is flag-gated, not value-gated, so the "enabled via
 * override, inherit limit from plan" use case is still expressible
 * (leave limitValue out of the PUT body → limitOverridden stays false).
 */
function resolveLimit(
  override: TenantFeatureOverride | undefined,
  planFeature: SubscriptionPlanFeature | undefined,
): number | null {
  if (override?.limitOverridden) return override.limitValue;
  if (planFeature) return planFeature.limitValue;
  return null;
}

function resolveOne(
  feature: SubscriptionFeature,
  planFeature: SubscriptionPlanFeature | undefined,
  override: TenantFeatureOverride | undefined,
): Entitlement {
  // Core features are always enabled, unlimited, regardless of plan/override
  // on the enabled dimension. Limits can still be set via override.
  if (feature.isCore) {
    const limitValue = resolveLimit(override, planFeature);
    return {
      featureKey: feature.featureKey,
      featureId: feature.id,
      displayName: feature.displayName,
      category: feature.category,
      isCore: true,
      enabled: true,
      limitType: feature.limitType as FeatureLimitType,
      limitValue,
      isUnlimited: limitValue === null,
      source: "core",
      reason: "is_core",
    };
  }

  // Override wins if it sets enabled
  if (override && override.enabled !== null) {
    const limitValue = resolveLimit(override, planFeature);
    return {
      featureKey: feature.featureKey,
      featureId: feature.id,
      displayName: feature.displayName,
      category: feature.category,
      isCore: false,
      enabled: override.enabled,
      limitType: feature.limitType as FeatureLimitType,
      limitValue,
      isUnlimited: limitValue === null,
      source: "override",
      reason: override.reason,
    };
  }

  // Plan feature row wins next (override's limit may still apply via resolveLimit)
  if (planFeature) {
    const limitValue = resolveLimit(override, planFeature);
    return {
      featureKey: feature.featureKey,
      featureId: feature.id,
      displayName: feature.displayName,
      category: feature.category,
      isCore: false,
      enabled: planFeature.enabled,
      limitType: feature.limitType as FeatureLimitType,
      limitValue,
      isUnlimited: limitValue === null,
      source: "plan",
      reason: null,
    };
  }

  // Default deny for non-core features the plan has not explicitly granted
  const limitValue = resolveLimit(override, undefined);
  return {
    featureKey: feature.featureKey,
    featureId: feature.id,
    displayName: feature.displayName,
    category: feature.category,
    isCore: false,
    enabled: false,
    limitType: feature.limitType as FeatureLimitType,
    limitValue,
    isUnlimited: limitValue === null,
    source: "default",
    reason: null,
  };
}

export async function isFeatureEnabled(companyId: string, featureKey: string): Promise<boolean> {
  const ent = await getTenantEntitlements(companyId);
  return ent.entitlements.find((e) => e.featureKey === featureKey)?.enabled === true;
}

export async function getFeatureLimit(companyId: string, featureKey: string): Promise<{
  limitType: FeatureLimitType;
  limitValue: number | null;
  isUnlimited: boolean;
} | null> {
  const ent = await getTenantEntitlements(companyId);
  const e = ent.entitlements.find((x) => x.featureKey === featureKey);
  if (!e) return null;
  return { limitType: e.limitType, limitValue: e.limitValue, isUnlimited: e.isUnlimited };
}

export async function getEntitlement(companyId: string, featureKey: string): Promise<Entitlement | null> {
  const ent = await getTenantEntitlements(companyId);
  return ent.entitlements.find((e) => e.featureKey === featureKey) ?? null;
}

export const entitlementService = {
  getTenantEntitlements,
  isFeatureEnabled,
  getFeatureLimit,
  getEntitlement,
  invalidateEntitlementsCache,
  invalidateAllEntitlementsCache,
};
