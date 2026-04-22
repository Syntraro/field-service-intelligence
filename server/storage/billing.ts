/**
 * Billing Repository (2026-04-21 Phase 3).
 *
 * Reads and writes the canonical billing fields on the `companies` table.
 * This module replaced the billing half of the deleted `tenantFeaturesRepository`
 * — the name "tenantFeatures" was misleading because these columns always
 * lived on `companies`, not on `tenant_features`.
 *
 * Responsibilities:
 *   - READ:  subscription status + plan + interval + trial / period dates
 *            + Stripe IDs.
 *   - WRITE: plan name, billing interval, current-period-end,
 *            cancel-at-period-end. SubscriptionStatus + trialEndsAt are
 *            NOT written here — those route through
 *            `subscriptionLifecycleService.transition()` so the audit
 *            event + cache eviction land in one place.
 *
 * Non-goals:
 *   - Does NOT touch Stripe IDs (that's Stripe webhooks' job).
 *   - Does NOT touch feature flags (those live in the entitlement catalog).
 */

import { db } from "../db";
import { eq } from "drizzle-orm";
import { companies } from "@shared/schema";

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

export interface UpdateTenantBillingInput {
  subscriptionPlan?: string | null;
  billingInterval?: string | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
}

async function getBilling(companyId: string): Promise<TenantBilling | null> {
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
 * Update non-lifecycle billing fields. Does NOT write `subscriptionStatus`
 * or `trialEndsAt` — those flow through `subscriptionLifecycleService.transition()`.
 */
async function updateBilling(
  companyId: string,
  updates: UpdateTenantBillingInput,
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

export const billingRepository = {
  getBilling,
  updateBilling,
};
