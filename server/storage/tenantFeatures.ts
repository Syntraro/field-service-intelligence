/**
 * Tenant Features Repository
 *
 * Handles tenant feature flags and billing state.
 * Used by requireFeature middleware and admin panel.
 */

import { db } from "../db";
import { eq, sql } from "drizzle-orm";
import { tenantFeatures, companies, type TenantFeatures, type UpdateTenantFeatures, type FeatureKey } from "@shared/schema";
import { cache, CacheKeys, CacheTTL } from "../services/cache";

// ============================================================================
// Types
// ============================================================================

export interface TenantBilling {
  companyId: string;
  companyName: string;
  subscriptionStatus: string;
  subscriptionPlan: string | null;
  billingInterval: string | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export interface TenantFeaturesWithBilling {
  features: TenantFeatures;
  billing: TenantBilling;
}

// Default feature flags for new tenants
const DEFAULT_FEATURES: Omit<TenantFeatures, 'id' | 'companyId' | 'createdAt' | 'updatedAt'> = {
  quotesEnabled: true,
  invoicesEnabled: true,
  calendarEnabled: true,
  qboEnabled: true,
  routeOptimizationEnabled: true,
  multiTechEnabled: true,
  customerPortalEnabled: false,
  customerPortalPaymentsEnabled: false,
};

// ============================================================================
// Cache Key Helper
// ============================================================================

// Add to cache keys if not present
function getTenantFeaturesCacheKey(companyId: string): string {
  return `tenant_features:${companyId}`;
}

// ============================================================================
// Repository Functions
// ============================================================================

/**
 * Get features for a company (with caching)
 * Returns default features if no record exists
 */
export async function getFeatures(companyId: string): Promise<TenantFeatures> {
  // Try cache first
  const cacheKey = getTenantFeaturesCacheKey(companyId);
  const cached = cache.get<TenantFeatures>(cacheKey);
  if (cached) {
    return cached;
  }

  // Query database
  const rows = await db
    .select()
    .from(tenantFeatures)
    .where(eq(tenantFeatures.companyId, companyId))
    .limit(1);

  let result = rows[0];

  // If no record exists, create one with defaults
  if (!result) {
    const [created] = await db
      .insert(tenantFeatures)
      .values({
        companyId,
        ...DEFAULT_FEATURES,
      })
      .returning();
    result = created;
  }

  // Cache for 15 minutes (features rarely change but should update promptly)
  cache.set(cacheKey, result, CacheTTL.MEDIUM);

  return result;
}

/**
 * Check if a specific feature is enabled for a company (with caching)
 */
export async function isFeatureEnabled(companyId: string, featureKey: FeatureKey): Promise<boolean> {
  const features = await getFeatures(companyId);
  return features[featureKey] === true;
}

/**
 * Get tenant billing information
 */
export async function getBilling(companyId: string): Promise<TenantBilling | null> {
  const rows = await db
    .select({
      companyId: companies.id,
      companyName: companies.name,
      subscriptionStatus: companies.subscriptionStatus,
      subscriptionPlan: companies.subscriptionPlan,
      billingInterval: companies.billingInterval,
      trialEndsAt: companies.trialEndsAt,
      currentPeriodEnd: companies.currentPeriodEnd,
      cancelAtPeriodEnd: companies.cancelAtPeriodEnd,
      stripeCustomerId: companies.stripeCustomerId,
      stripeSubscriptionId: companies.stripeSubscriptionId,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Get combined features and billing for admin view
 */
export async function getFeaturesWithBilling(companyId: string): Promise<TenantFeaturesWithBilling | null> {
  const billing = await getBilling(companyId);
  if (!billing) {
    return null;
  }

  const features = await getFeatures(companyId);

  return {
    features,
    billing,
  };
}

/**
 * Update tenant features (admin only)
 * Invalidates cache after update
 */
export async function updateFeatures(
  companyId: string,
  updates: UpdateTenantFeatures
): Promise<TenantFeatures> {
  // Ensure record exists first
  await getFeatures(companyId);

  // Update the record
  const [updated] = await db
    .update(tenantFeatures)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(tenantFeatures.companyId, companyId))
    .returning();

  // Invalidate cache
  const cacheKey = getTenantFeaturesCacheKey(companyId);
  cache.delete(cacheKey);

  return updated;
}

/**
 * Update tenant billing (admin only)
 * Only updates allowed billing fields, not Stripe IDs
 */
export async function updateBilling(
  companyId: string,
  updates: {
    subscriptionStatus?: string;
    subscriptionPlan?: string | null;
    billingInterval?: string | null;
    trialEndsAt?: Date | null;
    currentPeriodEnd?: Date | null;
    cancelAtPeriodEnd?: boolean;
  }
): Promise<TenantBilling | null> {
  const [updated] = await db
    .update(companies)
    .set(updates)
    .where(eq(companies.id, companyId))
    .returning({
      companyId: companies.id,
      companyName: companies.name,
      subscriptionStatus: companies.subscriptionStatus,
      subscriptionPlan: companies.subscriptionPlan,
      billingInterval: companies.billingInterval,
      trialEndsAt: companies.trialEndsAt,
      currentPeriodEnd: companies.currentPeriodEnd,
      cancelAtPeriodEnd: companies.cancelAtPeriodEnd,
      stripeCustomerId: companies.stripeCustomerId,
      stripeSubscriptionId: companies.stripeSubscriptionId,
    });

  return updated ?? null;
}

/**
 * Get all tenants with features summary (for admin listing)
 */
export async function getAllTenantsFeaturesSummary(): Promise<Array<{
  companyId: string;
  companyName: string;
  subscriptionStatus: string;
  features: TenantFeatures | null;
}>> {
  // Get all companies with their features (left join)
  const rows = await db
    .select({
      companyId: companies.id,
      companyName: companies.name,
      subscriptionStatus: companies.subscriptionStatus,
    })
    .from(companies)
    .orderBy(companies.name);

  // Batch fetch features
  const results = await Promise.all(
    rows.map(async (row) => {
      const features = await db
        .select()
        .from(tenantFeatures)
        .where(eq(tenantFeatures.companyId, row.companyId))
        .limit(1);

      return {
        ...row,
        features: features[0] ?? null,
      };
    })
  );

  return results;
}

// ============================================================================
// Export Repository Object
// ============================================================================

export const tenantFeaturesRepository = {
  getFeatures,
  isFeatureEnabled,
  getBilling,
  getFeaturesWithBilling,
  updateFeatures,
  updateBilling,
  getAllTenantsFeaturesSummary,
};
