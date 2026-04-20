import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { clients, companies, subscriptionPlans } from "@shared/schema";
import { BaseRepository } from "./base";
import { cache, CacheKeys, CacheTTL } from "../services/cache";

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
   * Check if company can add more locations
   */
  async canAddLocation(companyId: string) {
    const usage = await this.getSubscriptionUsage(companyId);

    if (!usage.plan) {
      return {
        allowed: false,
        reason: "No active plan found",
        current: usage.usage.locations,
        limit: 0,
      };
    }

    // Check if subscription is active
    const company = await db
      .select()
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);

    if (!company[0]) {
      return {
        allowed: false,
        reason: "Company not found",
        current: 0,
        limit: 0,
      };
    }

    // Check trial expiration
    if (
      company[0].subscriptionStatus === "trial" &&
      company[0].trialEndsAt &&
      new Date(company[0].trialEndsAt) < new Date()
    ) {
      return {
        allowed: false,
        reason: "Your free trial has expired. Please upgrade to continue.",
        current: usage.usage.locations,
        limit: usage.plan.locationLimit,
      };
    }

    // Check active subscription
    const activeStatuses = ["trial", "trialing", "active"];
    if (!activeStatuses.includes(company[0].subscriptionStatus)) {
      return {
        allowed: false,
        reason:
          "Your subscription is not active. Please update your payment method.",
        current: usage.usage.locations,
        limit: usage.plan.locationLimit,
      };
    }

    // Unlimited plans bypass location limit check
    if (usage.plan.isUnlimited) {
      return {
        allowed: true,
        current: usage.usage.locations,
        limit: usage.plan.locationLimit,
        unlimited: true,
      };
    }

    // Check location limit
    if (usage.usage.locations >= usage.plan.locationLimit) {
      return {
        allowed: false,
        reason: `You've reached your plan limit of ${usage.plan.locationLimit} locations. Upgrade to add more.`,
        current: usage.usage.locations,
        limit: usage.plan.locationLimit,
      };
    }

    return {
      allowed: true,
      current: usage.usage.locations,
      limit: usage.plan.locationLimit,
    };
  }
}

export const subscriptionRepository = new SubscriptionRepository();