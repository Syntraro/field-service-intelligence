import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { clients, companies, subscriptionPlans } from "@shared/schema";
import { BaseRepository } from "./base";
import { cache, CacheKeys, CacheTTL } from "../services/cache";
// 2026-04-21 Phase 1 canonical policy architecture: locations cap is now
// resolved via the entitlement service so plan-feature overrides and
// tenant overrides are honored uniformly with the rest of the feature gate.
import { entitlementService } from "../services/entitlementService";
import { usageMetricsService } from "../services/usageMetricsService";

// Sentinel value: plans with locationLimit >= this are treated as unlimited
const UNLIMITED_THRESHOLD = 999999;

// Subscription usage response types
interface PlanInfo {
  name: string;
  displayName: string | null;
  locationLimit: number;
  isUnlimited: boolean;
  price: number;
}

interface UsageInfo {
  locations: number;
}

// Entitlement reasons - explains WHY tenant is/isn't entitled
export type EntitlementReason =
  | "PAID_ACTIVE"       // Has active paid subscription
  | "TRIAL_ACTIVE"      // In valid trial period
  | "TRIAL_EXPIRED"     // Trial has expired
  | "SUBSCRIPTION_INACTIVE" // Subscription not active (cancelled, paused, etc.)
  | "NO_PLAN";          // No plan configured

interface SubscriptionUsage {
  plan: PlanInfo | null;
  usage: UsageInfo;
  percentUsed: number;
  trialEndsAt: string | null;
  subscriptionStatus: string | null;
  // Entitlement fields - single source of truth for "is tenant allowed to use the app"
  entitled: boolean;
  entitlementReason: EntitlementReason;
}

/**
 * Compute entitlement status for a tenant
 * IMPORTANT: ACTIVE status ALWAYS means entitled, regardless of trialEndsAt
 * Trial expiration only matters if status is "trial" or "trialing"
 */
function computeEntitlement(subscriptionStatus: string | null, trialEndsAt: Date | null): { entitled: boolean; reason: EntitlementReason } {
  // Active paid subscriptions are always entitled
  if (subscriptionStatus === "active") {
    return { entitled: true, reason: "PAID_ACTIVE" };
  }

  // Trial status - check expiration
  if (subscriptionStatus === "trial" || subscriptionStatus === "trialing") {
    if (!trialEndsAt) {
      // No trial end date set = trial active indefinitely (unlikely but handle gracefully)
      return { entitled: true, reason: "TRIAL_ACTIVE" };
    }

    const now = new Date();
    if (trialEndsAt >= now) {
      return { entitled: true, reason: "TRIAL_ACTIVE" };
    } else {
      return { entitled: false, reason: "TRIAL_EXPIRED" };
    }
  }

  // Other statuses (past_due, cancelled, paused) - not entitled
  if (subscriptionStatus === "past_due" || subscriptionStatus === "cancelled" || subscriptionStatus === "paused") {
    return { entitled: false, reason: "SUBSCRIPTION_INACTIVE" };
  }

  // No status or unknown - treat as no plan
  return { entitled: false, reason: "NO_PLAN" };
}

export class SubscriptionRepository extends BaseRepository {
  /**
   * Get subscription usage info for a company (with caching)
   */
  async getSubscriptionUsage(companyId: string): Promise<SubscriptionUsage> {
    // Try cache first (cache for 1 minute - balance freshness vs performance)
    const cacheKey = CacheKeys.subscription(companyId);
    const cached = cache.get<SubscriptionUsage>(cacheKey);
    if (cached) {
      return cached;
    }

    // Cache miss - query database
    // Get company info
    const company = await db
      .select()
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);

    if (!company[0]) {
      throw this.notFoundError("Company");
    }

    // Get active client count
    const clientCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(clients)
      .where(and(eq(clients.companyId, companyId), eq(clients.inactive, false)));

    // Resolve plan strictly from the canonical pointer
    // (`companies.subscription_plan` → `subscription_plans.name`).
    //
    // 2026-04-19: removed the silent "if no plan set, default to trial"
    // fallback. Every tenant now carries an explicit plan name on the
    // companies row (signup writes it; the matching backfill migration
    // populated legacy rows). A null `plan` here is a real misconfiguration
    // and must surface — not be papered over — per the no-pretend rule.
    let plan = null;
    if (company[0].subscriptionPlan) {
      const planRows = await db
        .select()
        .from(subscriptionPlans)
        .where(
          and(
            eq(subscriptionPlans.name, company[0].subscriptionPlan),
            eq(subscriptionPlans.active, true)
          )
        )
        .limit(1);

      plan = planRows[0] ?? null;
    }

    const locations = Number(clientCount[0]?.count || 0);
    const isUnlimited = plan ? plan.locationLimit >= UNLIMITED_THRESHOLD : false;
    const percentUsed =
      plan && plan.locationLimit > 0 && !isUnlimited
        ? Math.round((locations / plan.locationLimit) * 100)
        : 0;

    // Compute entitlement (canonical single source of truth)
    const { entitled, reason: entitlementReason } = computeEntitlement(
      company[0].subscriptionStatus,
      company[0].trialEndsAt
    );

    const result: SubscriptionUsage = {
      plan: plan
        ? {
            name: plan.name,
            displayName: plan.displayName,
            locationLimit: plan.locationLimit,
            isUnlimited,
            price: plan.monthlyPriceCents ? plan.monthlyPriceCents / 100 : 0,
          }
        : null,
      usage: {
        locations,
      },
      percentUsed,
      trialEndsAt: company[0].trialEndsAt?.toISOString() || null,
      subscriptionStatus: company[0].subscriptionStatus || null,
      entitled,
      entitlementReason,
    };

    // Cache for 1 minute (subscription data checked frequently)
    cache.set(cacheKey, result, CacheTTL.SHORT);

    return result;
  }

  /**
   * Check if company can add more locations.
   *
   * 2026-04-21 Phase 1 canonical policy architecture:
   *   Account-state short-circuits (no plan / trial expired / subscription
   *   inactive) continue to run off `getSubscriptionUsage`, which is the
   *   canonical entitlement state read for the tenant. The per-feature cap
   *   check delegates to `entitlementService` + `usageMetricsService` so
   *   plan_feature overrides and tenant_feature_overrides are honored the
   *   same way as every other feature gate. This replaces the previous
   *   `subscription_plans.locationLimit` column lookup which cannot see
   *   overrides.
   *
   * Response shape preserved for existing callers (clients.ts, techField.ts,
   * clientImport.ts, subscriptions.ts API surface).
   */
  async canAddLocation(companyId: string) {
    const usage = await this.getSubscriptionUsage(companyId);
    const currentLocations = usage.usage.locations;

    if (!usage.plan) {
      return {
        allowed: false,
        reason: "No active plan found",
        current: currentLocations,
        limit: 0,
      };
    }

    // Entitlement-gate account-state. `entitled=false` means either trial
    // expired or subscription not active — reuse the canonical entitlement
    // reason so copy stays consistent with the subscription banner.
    if (!usage.entitled) {
      const reason =
        usage.entitlementReason === "TRIAL_EXPIRED"
          ? "Your free trial has expired. Please upgrade to continue."
          : "Your subscription is not active. Please update your payment method.";
      return {
        allowed: false,
        reason,
        current: currentLocations,
        limit: usage.plan.locationLimit,
      };
    }

    // Canonical cap check: resolve via the entitlement service so tenant +
    // plan overrides apply. Core / unlimited entitlements short-circuit to
    // allowed.
    const locationEntitlement = await entitlementService.getEntitlement(
      companyId,
      "locations",
    );
    if (!locationEntitlement) {
      // Catalog misconfiguration (feature_key missing). Fail-closed at the
      // gate; surface a reason the admin can act on.
      return {
        allowed: false,
        reason: "Location feature is not configured. Please contact support.",
        current: currentLocations,
        limit: usage.plan.locationLimit,
      };
    }

    if (locationEntitlement.isCore || locationEntitlement.isUnlimited || locationEntitlement.limitValue === null) {
      return {
        allowed: true,
        current: currentLocations,
        limit: locationEntitlement.limitValue ?? usage.plan.locationLimit,
        unlimited: true,
      };
    }

    // Use the canonical usage counter (indexed COUNT, 1-minute cached) so
    // we don't diverge from the entitlement snapshot the gate enforces.
    const canonicalCurrent = await usageMetricsService.getUsage(companyId, "locations");

    if (canonicalCurrent >= locationEntitlement.limitValue) {
      return {
        allowed: false,
        reason: `You've reached your plan limit of ${locationEntitlement.limitValue} locations. Upgrade to add more.`,
        current: canonicalCurrent,
        limit: locationEntitlement.limitValue,
      };
    }

    return {
      allowed: true,
      current: canonicalCurrent,
      limit: locationEntitlement.limitValue,
    };
  }
}

export const subscriptionRepository = new SubscriptionRepository();