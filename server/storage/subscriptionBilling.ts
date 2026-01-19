/**
 * Subscription Billing Storage
 *
 * Repository for tenant subscription lifecycle management.
 * Handles signup, cancellation, renewal, and event tracking.
 *
 * IMPORTANT: All operations are tenant-scoped via companyId.
 */

import { db } from "../db";
import { eq, and, sql, lte, gte, isNull, isNotNull } from "drizzle-orm";
import {
  tenantSubscriptions,
  subscriptionEvents,
  subscriptionPlans,
  type TenantSubscription,
  type SubscriptionEvent,
  type InsertTenantSubscription,
  type InsertSubscriptionEvent,
  type BillingCycle,
  type SubscriptionStatus,
  type SubscriptionEventType,
} from "@shared/schema";
import { BaseRepository } from "./base";

// ============================================================================
// Types
// ============================================================================

export interface SignupParams {
  companyId: string;
  planId?: string;
  billingCycle: BillingCycle;
  autoRenewAnnual?: boolean;
}

export interface SubscriptionWithPlan extends TenantSubscription {
  plan: {
    id: string;
    name: string;
    displayName: string;
    monthlyPriceCents: number | null;
    locationLimit: number;
  } | null;
}

export interface SubscriptionInfo {
  subscription: SubscriptionWithPlan;
  daysUntilEnd: number | null;
  isInRenewalWindow: boolean;
  willAutoRenew: boolean;
  willRevertToMonthly: boolean;
}

export interface AnnualSubscriptionForProcessing {
  id: string;
  companyId: string;
  endDate: Date;
  autoRenewAnnual: boolean;
  status: SubscriptionStatus;
}

// ============================================================================
// Repository
// ============================================================================

export class SubscriptionBillingRepository extends BaseRepository {
  /**
   * Get subscription by company ID
   */
  async getByCompanyId(companyId: string): Promise<SubscriptionWithPlan | null> {
    this.assertCompanyId(companyId);

    const rows = await db
      .select({
        subscription: tenantSubscriptions,
        plan: {
          id: subscriptionPlans.id,
          name: subscriptionPlans.name,
          displayName: subscriptionPlans.displayName,
          monthlyPriceCents: subscriptionPlans.monthlyPriceCents,
          locationLimit: subscriptionPlans.locationLimit,
        },
      })
      .from(tenantSubscriptions)
      .leftJoin(subscriptionPlans, eq(tenantSubscriptions.planId, subscriptionPlans.id))
      .where(eq(tenantSubscriptions.companyId, companyId))
      .limit(1);

    if (rows.length === 0) return null;

    return {
      ...rows[0].subscription,
      plan: rows[0].plan,
    };
  }

  /**
   * Get subscription info with computed fields
   */
  async getSubscriptionInfo(companyId: string): Promise<SubscriptionInfo | null> {
    const subscription = await this.getByCompanyId(companyId);
    if (!subscription) return null;

    const now = new Date();
    let daysUntilEnd: number | null = null;
    let isInRenewalWindow = false;

    if (subscription.endDate) {
      const endDate = new Date(subscription.endDate);
      const diffMs = endDate.getTime() - now.getTime();
      daysUntilEnd = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      isInRenewalWindow = daysUntilEnd <= 30 && daysUntilEnd > 0;
    }

    const isAnnual = subscription.billingCycle === "annual";
    const isActive = subscription.status === "active";

    return {
      subscription,
      daysUntilEnd,
      isInRenewalWindow,
      willAutoRenew: isAnnual && subscription.autoRenewAnnual && isActive,
      willRevertToMonthly: isAnnual && !subscription.autoRenewAnnual && isActive,
    };
  }

  /**
   * Create or update subscription (signup)
   * One subscription per company - upserts if exists
   */
  async signup(params: SignupParams): Promise<TenantSubscription> {
    const { companyId, planId, billingCycle, autoRenewAnnual = true } = params;
    this.assertCompanyId(companyId);

    const now = new Date();
    let endDate: Date | null = null;

    // For annual subscriptions, set endDate to 1 year from now
    if (billingCycle === "annual") {
      endDate = new Date(now);
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    // Check if subscription already exists
    const existing = await db
      .select()
      .from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.companyId, companyId))
      .limit(1);

    let subscription: TenantSubscription;

    if (existing.length > 0) {
      // Update existing subscription
      const [updated] = await db
        .update(tenantSubscriptions)
        .set({
          planId: planId || null,
          billingCycle,
          status: "active",
          autoRenewAnnual: billingCycle === "annual" ? autoRenewAnnual : false,
          startDate: now,
          endDate,
          cancelledAt: null,
          revertedFromAnnual: false,
          updatedAt: now,
        })
        .where(eq(tenantSubscriptions.companyId, companyId))
        .returning();
      subscription = updated;
    } else {
      // Create new subscription
      const [created] = await db
        .insert(tenantSubscriptions)
        .values({
          companyId,
          planId: planId || null,
          billingCycle,
          status: "active",
          autoRenewAnnual: billingCycle === "annual" ? autoRenewAnnual : false,
          startDate: now,
          endDate,
          cancelledAt: null,
          revertedFromAnnual: false,
        })
        .returning();
      subscription = created;
    }

    // Record signup event
    await this.recordEvent({
      subscriptionId: subscription.id,
      companyId,
      type: "signup",
      termEndDate: null,
      metadata: {
        billingCycle,
        autoRenewAnnual: billingCycle === "annual" ? autoRenewAnnual : false,
        planId: planId || null,
      },
    });

    return subscription;
  }

  /**
   * Cancel subscription
   * - Annual: status='cancelled', keeps access until endDate
   * - Monthly: status='cancelled' immediately
   */
  async cancel(companyId: string): Promise<TenantSubscription> {
    this.assertCompanyId(companyId);

    const existing = await db
      .select()
      .from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.companyId, companyId))
      .limit(1);

    if (existing.length === 0) {
      throw this.notFoundError("Subscription");
    }

    const subscription = existing[0];
    const now = new Date();

    const [updated] = await db
      .update(tenantSubscriptions)
      .set({
        status: "cancelled",
        cancelledAt: now,
        updatedAt: now,
      })
      .where(eq(tenantSubscriptions.id, subscription.id))
      .returning();

    // Record cancellation event
    await this.recordEvent({
      subscriptionId: subscription.id,
      companyId,
      type: "cancelled",
      termEndDate: subscription.endDate,
      metadata: {
        billingCycle: subscription.billingCycle,
        cancelledAt: now.toISOString(),
      },
    });

    return updated;
  }

  /**
   * Update auto-renew setting (annual only)
   */
  async setAutoRenew(companyId: string, autoRenewAnnual: boolean): Promise<TenantSubscription> {
    this.assertCompanyId(companyId);

    const existing = await db
      .select()
      .from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.companyId, companyId))
      .limit(1);

    if (existing.length === 0) {
      throw this.notFoundError("Subscription");
    }

    const subscription = existing[0];

    if (subscription.billingCycle !== "annual") {
      throw this.validationError("Auto-renew setting only applies to annual subscriptions");
    }

    const [updated] = await db
      .update(tenantSubscriptions)
      .set({
        autoRenewAnnual,
        updatedAt: new Date(),
      })
      .where(eq(tenantSubscriptions.id, subscription.id))
      .returning();

    return updated;
  }

  /**
   * Manual renewal of annual subscription
   * - If annual: extends endDate by 1 year from current endDate
   * - If monthly: converts to annual, sets endDate to now + 1 year
   */
  async renewAnnual(companyId: string, autoRenewAnnual: boolean = true): Promise<TenantSubscription> {
    this.assertCompanyId(companyId);

    const existing = await db
      .select()
      .from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.companyId, companyId))
      .limit(1);

    if (existing.length === 0) {
      throw this.notFoundError("Subscription");
    }

    const subscription = existing[0];
    const now = new Date();
    let newEndDate: Date;
    let termEndDateForEvent: Date | null = null;

    if (subscription.billingCycle === "annual" && subscription.endDate) {
      // Extend from current endDate
      termEndDateForEvent = new Date(subscription.endDate);
      newEndDate = new Date(subscription.endDate);
      newEndDate.setFullYear(newEndDate.getFullYear() + 1);
    } else {
      // Convert from monthly to annual
      newEndDate = new Date(now);
      newEndDate.setFullYear(newEndDate.getFullYear() + 1);
    }

    const [updated] = await db
      .update(tenantSubscriptions)
      .set({
        billingCycle: "annual",
        status: "active",
        autoRenewAnnual,
        endDate: newEndDate,
        cancelledAt: null,
        revertedFromAnnual: false,
        updatedAt: now,
      })
      .where(eq(tenantSubscriptions.id, subscription.id))
      .returning();

    // Record manual renewal event
    await this.recordEvent({
      subscriptionId: subscription.id,
      companyId,
      type: "manual_renewal",
      termEndDate: termEndDateForEvent,
      metadata: {
        previousBillingCycle: subscription.billingCycle,
        previousEndDate: subscription.endDate?.toISOString() || null,
        newEndDate: newEndDate.toISOString(),
        autoRenewAnnual,
      },
    });

    return updated;
  }

  /**
   * Get annual subscriptions due for processing (end date <= today, status active)
   */
  async getAnnualSubscriptionsDueForProcessing(): Promise<AnnualSubscriptionForProcessing[]> {
    const now = new Date();
    // Set time to end of day to include all subscriptions ending today
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const rows = await db
      .select({
        id: tenantSubscriptions.id,
        companyId: tenantSubscriptions.companyId,
        endDate: tenantSubscriptions.endDate,
        autoRenewAnnual: tenantSubscriptions.autoRenewAnnual,
        status: tenantSubscriptions.status,
      })
      .from(tenantSubscriptions)
      .where(
        and(
          eq(tenantSubscriptions.billingCycle, "annual"),
          eq(tenantSubscriptions.status, "active"),
          isNotNull(tenantSubscriptions.endDate),
          lte(tenantSubscriptions.endDate, today)
        )
      );

    return rows.map((r) => ({
      ...r,
      endDate: r.endDate as Date,
      status: r.status as SubscriptionStatus,
    }));
  }

  /**
   * Get annual subscriptions for renewal notices
   * @param daysUntilEnd - exact days until end (30 or 7)
   * @param tolerance - days tolerance for matching (default 1)
   */
  async getSubscriptionsForRenewalNotice(
    daysUntilEnd: number,
    tolerance: number = 1
  ): Promise<AnnualSubscriptionForProcessing[]> {
    const now = new Date();
    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + daysUntilEnd);

    // Calculate date range with tolerance
    const minDate = new Date(targetDate);
    minDate.setDate(minDate.getDate() - tolerance);
    const maxDate = new Date(targetDate);
    maxDate.setDate(maxDate.getDate() + tolerance);

    const rows = await db
      .select({
        id: tenantSubscriptions.id,
        companyId: tenantSubscriptions.companyId,
        endDate: tenantSubscriptions.endDate,
        autoRenewAnnual: tenantSubscriptions.autoRenewAnnual,
        status: tenantSubscriptions.status,
      })
      .from(tenantSubscriptions)
      .where(
        and(
          eq(tenantSubscriptions.billingCycle, "annual"),
          eq(tenantSubscriptions.status, "active"),
          isNotNull(tenantSubscriptions.endDate),
          gte(tenantSubscriptions.endDate, minDate),
          lte(tenantSubscriptions.endDate, maxDate)
        )
      );

    return rows.map((r) => ({
      ...r,
      endDate: r.endDate as Date,
      status: r.status as SubscriptionStatus,
    }));
  }

  /**
   * Auto-renew annual subscription (called by worker)
   * Extends endDate by 1 year from current endDate
   */
  async autoRenewAnnual(subscriptionId: string, currentEndDate: Date): Promise<TenantSubscription> {
    const newEndDate = new Date(currentEndDate);
    newEndDate.setFullYear(newEndDate.getFullYear() + 1);

    const [updated] = await db
      .update(tenantSubscriptions)
      .set({
        endDate: newEndDate,
        updatedAt: new Date(),
      })
      .where(eq(tenantSubscriptions.id, subscriptionId))
      .returning();

    if (!updated) {
      throw this.notFoundError("Subscription");
    }

    return updated;
  }

  /**
   * Revert annual subscription to monthly (called by worker)
   */
  async revertToMonthly(subscriptionId: string): Promise<TenantSubscription> {
    const [updated] = await db
      .update(tenantSubscriptions)
      .set({
        billingCycle: "monthly",
        endDate: null,
        autoRenewAnnual: false,
        revertedFromAnnual: true,
        updatedAt: new Date(),
      })
      .where(eq(tenantSubscriptions.id, subscriptionId))
      .returning();

    if (!updated) {
      throw this.notFoundError("Subscription");
    }

    return updated;
  }

  /**
   * Record a subscription event (idempotent via unique constraint)
   * Returns true if event was created, false if it already exists
   */
  async recordEvent(params: {
    subscriptionId: string;
    companyId: string;
    type: SubscriptionEventType;
    termEndDate: Date | null;
    metadata?: Record<string, unknown>;
  }): Promise<{ created: boolean; event: SubscriptionEvent | null }> {
    try {
      const [event] = await db
        .insert(subscriptionEvents)
        .values({
          subscriptionId: params.subscriptionId,
          companyId: params.companyId,
          type: params.type,
          termEndDate: params.termEndDate,
          metadata: params.metadata || null,
        })
        .returning();

      return { created: true, event };
    } catch (error: any) {
      // Check if it's a unique constraint violation (duplicate event)
      if (error.code === "23505") {
        // PostgreSQL unique violation
        return { created: false, event: null };
      }
      throw error;
    }
  }

  /**
   * Check if an event already exists for this subscription/type/term
   */
  async hasEvent(
    subscriptionId: string,
    type: SubscriptionEventType,
    termEndDate: Date | null
  ): Promise<boolean> {
    const conditions = [
      eq(subscriptionEvents.subscriptionId, subscriptionId),
      eq(subscriptionEvents.type, type),
    ];

    if (termEndDate) {
      conditions.push(eq(subscriptionEvents.termEndDate, termEndDate));
    } else {
      conditions.push(isNull(subscriptionEvents.termEndDate));
    }

    const rows = await db
      .select({ id: subscriptionEvents.id })
      .from(subscriptionEvents)
      .where(and(...conditions))
      .limit(1);

    return rows.length > 0;
  }

  /**
   * Get subscription events for a company
   */
  async getEvents(companyId: string, limit: number = 50): Promise<SubscriptionEvent[]> {
    this.assertCompanyId(companyId);

    return db
      .select()
      .from(subscriptionEvents)
      .where(eq(subscriptionEvents.companyId, companyId))
      .orderBy(sql`${subscriptionEvents.createdAt} DESC`)
      .limit(limit);
  }
}

export const subscriptionBillingRepository = new SubscriptionBillingRepository();
