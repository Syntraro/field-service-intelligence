/**
 * Entitlement Storage — canonical CRUD for the new plan/feature/override
 * system (2026-04-19). Single file owns features, plan-features, overrides,
 * and plan metadata. All methods return raw rows; audit / resolver concerns
 * live in the service layer (`server/services/entitlementService.ts`).
 *
 * No business logic beyond the immutable-key guard on featureKey updates.
 */

import { db } from "../db";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  subscriptionPlans,
  subscriptionFeatures,
  subscriptionPlanFeatures,
  tenantFeatureOverrides,
  subscriptionPlanMetadata,
  type SubscriptionPlan,
  type SubscriptionFeature,
  type SubscriptionPlanFeature,
  type TenantFeatureOverride,
  type SubscriptionPlanMetadata,
  type InsertSubscriptionFeature,
  type UpdateSubscriptionFeature,
  type UpsertPlanFeatureInput,
  type UpsertTenantOverrideInput,
  type UpsertPlanMetadataInput,
  type CreatePlanInput,
  type UpdatePlanInput,
} from "@shared/schema";

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export async function listPlans(): Promise<SubscriptionPlan[]> {
  return db.select().from(subscriptionPlans).orderBy(asc(subscriptionPlans.sortOrder), asc(subscriptionPlans.name));
}

export async function getPlanById(planId: string): Promise<SubscriptionPlan | null> {
  const rows = await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, planId)).limit(1);
  return rows[0] ?? null;
}

export async function getPlanByName(name: string): Promise<SubscriptionPlan | null> {
  const rows = await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.name, name)).limit(1);
  return rows[0] ?? null;
}

export async function createPlan(input: CreatePlanInput): Promise<SubscriptionPlan> {
  const [row] = await db.insert(subscriptionPlans).values({
    name: input.name,
    displayName: input.displayName,
    monthlyPriceCents: input.monthlyPriceCents ?? null,
    locationLimit: input.locationLimit,
    isTrial: input.isTrial ?? false,
    trialDays: input.trialDays ?? null,
    sortOrder: input.sortOrder ?? 0,
    active: input.active ?? true,
  }).returning();
  return row;
}

export async function updatePlan(planId: string, patch: UpdatePlanInput): Promise<SubscriptionPlan | null> {
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.displayName !== undefined) updates.displayName = patch.displayName;
  if (patch.monthlyPriceCents !== undefined) updates.monthlyPriceCents = patch.monthlyPriceCents;
  if (patch.locationLimit !== undefined) updates.locationLimit = patch.locationLimit;
  if (patch.isTrial !== undefined) updates.isTrial = patch.isTrial;
  if (patch.trialDays !== undefined) updates.trialDays = patch.trialDays;
  if (patch.sortOrder !== undefined) updates.sortOrder = patch.sortOrder;
  if (patch.active !== undefined) updates.active = patch.active;

  const [row] = await db.update(subscriptionPlans).set(updates).where(eq(subscriptionPlans.id, planId)).returning();
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Plan metadata (1:1 with plans, created lazily)
// ---------------------------------------------------------------------------

export async function getPlanMetadata(planId: string): Promise<SubscriptionPlanMetadata | null> {
  const rows = await db.select().from(subscriptionPlanMetadata).where(eq(subscriptionPlanMetadata.planId, planId)).limit(1);
  return rows[0] ?? null;
}

export async function upsertPlanMetadata(
  planId: string,
  patch: UpsertPlanMetadataInput,
): Promise<SubscriptionPlanMetadata> {
  const existing = await getPlanMetadata(planId);
  if (!existing) {
    const [row] = await db.insert(subscriptionPlanMetadata).values({
      planId,
      description: patch.description ?? null,
      isPublic: patch.isPublic ?? false,
      annualPriceCents: patch.annualPriceCents ?? null,
      trialEligible: patch.trialEligible ?? false,
      displayBadge: patch.displayBadge ?? null,
      marketingSortOrder: patch.marketingSortOrder ?? null,
    }).returning();
    return row;
  }
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.isPublic !== undefined) updates.isPublic = patch.isPublic;
  if (patch.annualPriceCents !== undefined) updates.annualPriceCents = patch.annualPriceCents;
  if (patch.trialEligible !== undefined) updates.trialEligible = patch.trialEligible;
  if (patch.displayBadge !== undefined) updates.displayBadge = patch.displayBadge;
  if (patch.marketingSortOrder !== undefined) updates.marketingSortOrder = patch.marketingSortOrder;
  const [row] = await db.update(subscriptionPlanMetadata).set(updates).where(eq(subscriptionPlanMetadata.planId, planId)).returning();
  return row;
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

export async function listFeatures(): Promise<SubscriptionFeature[]> {
  return db.select().from(subscriptionFeatures)
    .orderBy(asc(subscriptionFeatures.sortOrder), asc(subscriptionFeatures.featureKey));
}

export async function getFeatureById(featureId: string): Promise<SubscriptionFeature | null> {
  const rows = await db.select().from(subscriptionFeatures).where(eq(subscriptionFeatures.id, featureId)).limit(1);
  return rows[0] ?? null;
}

export async function getFeatureByKey(featureKey: string): Promise<SubscriptionFeature | null> {
  const rows = await db.select().from(subscriptionFeatures).where(eq(subscriptionFeatures.featureKey, featureKey)).limit(1);
  return rows[0] ?? null;
}

export async function createFeature(input: InsertSubscriptionFeature): Promise<SubscriptionFeature> {
  const [row] = await db.insert(subscriptionFeatures).values({
    featureKey: input.featureKey,
    displayName: input.displayName,
    description: input.description ?? null,
    category: input.category,
    limitType: input.limitType ?? "none",
    isCore: input.isCore ?? false,
    active: input.active ?? true,
    sortOrder: input.sortOrder ?? 0,
    metadata: input.metadata ?? null,
  }).returning();
  return row;
}

/**
 * Update a feature. `featureKey` is IMMUTABLE after creation — the update
 * schema does not accept it, and this function deliberately ignores any
 * featureKey in the patch to be defense-in-depth.
 */
export async function updateFeature(
  featureId: string,
  patch: UpdateSubscriptionFeature,
): Promise<SubscriptionFeature | null> {
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.displayName !== undefined) updates.displayName = patch.displayName;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.category !== undefined) updates.category = patch.category;
  if (patch.limitType !== undefined) updates.limitType = patch.limitType;
  if (patch.isCore !== undefined) updates.isCore = patch.isCore;
  if (patch.active !== undefined) updates.active = patch.active;
  if (patch.sortOrder !== undefined) updates.sortOrder = patch.sortOrder;
  if (patch.metadata !== undefined) updates.metadata = patch.metadata;
  const [row] = await db.update(subscriptionFeatures).set(updates).where(eq(subscriptionFeatures.id, featureId)).returning();
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Plan-feature matrix
// ---------------------------------------------------------------------------

export async function listPlanFeatures(planId: string): Promise<SubscriptionPlanFeature[]> {
  return db.select().from(subscriptionPlanFeatures).where(eq(subscriptionPlanFeatures.planId, planId));
}

export async function upsertPlanFeature(
  planId: string,
  featureId: string,
  patch: UpsertPlanFeatureInput,
): Promise<SubscriptionPlanFeature> {
  const [row] = await db.insert(subscriptionPlanFeatures).values({
    planId,
    featureId,
    enabled: patch.enabled,
    limitValue: patch.limitValue ?? null,
    metadata: patch.metadata ?? null,
  }).onConflictDoUpdate({
    target: [subscriptionPlanFeatures.planId, subscriptionPlanFeatures.featureId],
    set: {
      enabled: patch.enabled,
      limitValue: patch.limitValue ?? null,
      metadata: patch.metadata ?? null,
      updatedAt: new Date(),
    },
  }).returning();
  return row;
}

// ---------------------------------------------------------------------------
// Tenant overrides
// ---------------------------------------------------------------------------

export async function listOverrides(companyId: string): Promise<TenantFeatureOverride[]> {
  return db.select().from(tenantFeatureOverrides).where(eq(tenantFeatureOverrides.companyId, companyId));
}

export async function upsertOverride(
  companyId: string,
  featureId: string,
  patch: UpsertTenantOverrideInput,
): Promise<TenantFeatureOverride> {
  // 2026-04-20: limit_overridden discriminates "caller explicitly provided
  // limitValue (null or number)" from "caller did not mention limitValue".
  // "limitValue" in patch is true when the key was present on the input
  // (matches JSON semantics preserved through Zod `.nullable().optional()`).
  // An explicit null with limitOverridden = true means "unlimited for this
  // tenant"; absence means "inherit from plan / core / default".
  //
  // PUT is a full-state write (not a partial patch): if the caller omits
  // limitValue in a follow-up PUT, limit_overridden resets to false so the
  // row returns to the "inherit" state.
  const limitOverridden = Object.prototype.hasOwnProperty.call(patch, "limitValue");
  const limitValue = limitOverridden ? (patch.limitValue ?? null) : null;

  const [row] = await db.insert(tenantFeatureOverrides).values({
    companyId,
    featureId,
    enabled: patch.enabled ?? null,
    limitValue,
    limitOverridden,
    reason: patch.reason ?? null,
  }).onConflictDoUpdate({
    target: [tenantFeatureOverrides.companyId, tenantFeatureOverrides.featureId],
    set: {
      enabled: patch.enabled ?? null,
      limitValue,
      limitOverridden,
      reason: patch.reason ?? null,
      updatedAt: new Date(),
    },
  }).returning();
  return row;
}

export async function deleteOverride(companyId: string, featureId: string): Promise<TenantFeatureOverride | null> {
  const [row] = await db.delete(tenantFeatureOverrides).where(
    and(eq(tenantFeatureOverrides.companyId, companyId), eq(tenantFeatureOverrides.featureId, featureId)),
  ).returning();
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Batch lookup helpers for the resolver
// ---------------------------------------------------------------------------

export async function getActiveFeatures(): Promise<SubscriptionFeature[]> {
  return db.select().from(subscriptionFeatures).where(eq(subscriptionFeatures.active, true));
}

export async function getPlanFeaturesForPlanIds(planIds: string[]): Promise<SubscriptionPlanFeature[]> {
  if (planIds.length === 0) return [];
  return db.select().from(subscriptionPlanFeatures).where(inArray(subscriptionPlanFeatures.planId, planIds));
}

export const entitlementStorage = {
  listPlans, getPlanById, getPlanByName, createPlan, updatePlan,
  getPlanMetadata, upsertPlanMetadata,
  listFeatures, getFeatureById, getFeatureByKey, createFeature, updateFeature,
  listPlanFeatures, upsertPlanFeature,
  listOverrides, upsertOverride, deleteOverride,
  getActiveFeatures, getPlanFeaturesForPlanIds,
};
