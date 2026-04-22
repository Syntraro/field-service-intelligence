/**
 * Platform KPI Service — SaaS Admin / Tenant Operations Phase A3.
 *
 * 2026-04-22: canonical READ service that rolls up the platform-wide
 * operator metrics. Reads existing tables only; no new writers, no new
 * schema, no duplicate calculations elsewhere.
 *
 * Metrics:
 *   active_tenants              COUNT companies.subscription_status='active'
 *   trial_tenants               COUNT companies.subscription_status='trial'
 *   trials_ending_7d            COUNT trial tenants whose trialEndsAt ∈ (now, now+7d]
 *   converted_30d               distinct companies with subscription_events.status_changed
 *                               from='trial' → to='active' in last 30d
 *   expired_not_converted_30d   trial tenants whose trialEndsAt passed in last 30d
 *                               AND are still on `trial` status (i.e., did not convert)
 *   churned_30d                 distinct companies with subscription_events.status_changed
 *                               to='cancelled' in last 30d
 *   estimated_mrr               SUM of subscription_plans.monthlyPriceCents across
 *                               active tenants with a resolvable plan. Monthly-run-rate
 *                               normalization — billing interval does not affect MRR.
 *   estimated_arr               estimated_mrr × 12
 *   stalled_trials              same definition as trialPipelineService.stalled_trial
 *                               bucket — reuses that service so operator dashboard
 *                               and KPI strip never disagree.
 *   support_sessions_open       COUNT impersonation_sessions.accessMode='read_only'
 *                               with status IN ('pending','active')
 *   impersonations_open         COUNT impersonation_sessions.accessMode='impersonation'
 *                               with status IN ('pending','active')
 *
 * 60s cache — dashboard-acceptable cadence.
 */

import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db";
import {
  companies,
  subscriptionEvents,
  subscriptionPlans,
  impersonationSessions,
} from "@shared/schema";
import { cache, CacheTTL } from "./cache";
import { trialPipelineService } from "./trialPipelineService";

// ============================================================================
// Public type
// ============================================================================

export interface PlatformKpis {
  generatedAt: string;
  active_tenants: number;
  trial_tenants: number;
  trials_ending_7d: number;
  converted_30d: number;
  expired_not_converted_30d: number;
  churned_30d: number;
  estimated_mrr_cents: number;
  estimated_arr_cents: number;
  stalled_trials: number;
  support_sessions_open: number;
  impersonations_open: number;
}

// ============================================================================
// Constants
// ============================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const CONVERSION_LOOKBACK_DAYS = 30;
const CHURN_LOOKBACK_DAYS = 30;
const EXPIRED_LOOKBACK_DAYS = 30;
const TRIALS_ENDING_WINDOW_DAYS = 7;
const CACHE_KEY = "platform_kpis:v1";

// ============================================================================
// Individual metric queries
// ============================================================================

async function countBySubscriptionStatus(status: string): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(companies)
    .where(eq(companies.subscriptionStatus, status));
  return Number(row?.c ?? 0);
}

async function countTrialsEndingWithin(days: number, now: Date): Promise<number> {
  const horizon = new Date(now.getTime() + days * MS_PER_DAY);
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(companies)
    .where(
      and(
        eq(companies.subscriptionStatus, "trial"),
        gt(companies.trialEndsAt, now),
        lt(companies.trialEndsAt, horizon),
      ),
    );
  return Number(row?.c ?? 0);
}

async function countExpiredNotConverted(days: number, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - days * MS_PER_DAY);
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(companies)
    .where(
      and(
        // Still on trial status = did NOT convert to active.
        eq(companies.subscriptionStatus, "trial"),
        // Trial end date passed within the lookback window.
        gt(companies.trialEndsAt, cutoff),
        lt(companies.trialEndsAt, now),
      ),
    );
  return Number(row?.c ?? 0);
}

/**
 * Counts DISTINCT companies whose `subscription_events` contain a
 * status_changed row matching the provided predicate within the lookback
 * window. Used for both converted_30d and churned_30d.
 */
async function countDistinctStatusTransition(
  days: number,
  now: Date,
  predicate: (metadata: Record<string, unknown>) => boolean,
): Promise<number> {
  const cutoff = new Date(now.getTime() - days * MS_PER_DAY);
  const rows = await db
    .select({
      companyId: subscriptionEvents.companyId,
      metadata: subscriptionEvents.metadata,
    })
    .from(subscriptionEvents)
    .where(
      and(
        eq(subscriptionEvents.type, "status_changed"),
        gt(subscriptionEvents.createdAt, cutoff),
      ),
    );

  const matched = new Set<string>();
  for (const row of rows) {
    const meta = (row.metadata as Record<string, unknown> | null) ?? {};
    if (predicate(meta)) matched.add(row.companyId);
  }
  return matched.size;
}

/**
 * Estimated MRR (monthly run-rate) across currently-active tenants.
 * Uses `subscription_plans.monthlyPriceCents` as the per-tenant contribution
 * regardless of billing_interval — an annual subscriber on $1200/yr still
 * produces $100/month of normalized run-rate.
 *
 * Tenants on an unresolvable `subscription_plan` name or a plan with a
 * NULL `monthlyPriceCents` contribute zero. Returns cents for precision.
 */
async function computeEstimatedMrrCents(): Promise<number> {
  const rows = await db
    .select({
      companyId: companies.id,
      subscriptionPlan: companies.subscriptionPlan,
      monthlyPriceCents: subscriptionPlans.monthlyPriceCents,
    })
    .from(companies)
    .leftJoin(
      subscriptionPlans,
      eq(subscriptionPlans.name, companies.subscriptionPlan),
    )
    .where(eq(companies.subscriptionStatus, "active"));

  let total = 0;
  for (const r of rows) {
    if (typeof r.monthlyPriceCents === "number") {
      total += r.monthlyPriceCents;
    }
  }
  return total;
}

async function countOpenSessionsByMode(
  accessMode: "read_only" | "impersonation",
): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(impersonationSessions)
    .where(
      and(
        eq(impersonationSessions.accessMode, accessMode),
        inArray(impersonationSessions.status, ["pending", "active"]),
      ),
    );
  return Number(row?.c ?? 0);
}

// ============================================================================
// Main: getPlatformKpis
// ============================================================================

export async function getPlatformKpis(): Promise<PlatformKpis> {
  const cached = cache.get<PlatformKpis>(CACHE_KEY);
  if (cached) return cached;

  const now = new Date();

  // Reuse the canonical trial pipeline for the stalled count so the two
  // surfaces never disagree. The pipeline service is itself 60s-cached;
  // the first caller populates both caches.
  const [
    active_tenants,
    trial_tenants,
    trials_ending_7d,
    converted_30d,
    expired_not_converted_30d,
    churned_30d,
    estimated_mrr_cents,
    support_sessions_open,
    impersonations_open,
    pipeline,
  ] = await Promise.all([
    countBySubscriptionStatus("active"),
    countBySubscriptionStatus("trial"),
    countTrialsEndingWithin(TRIALS_ENDING_WINDOW_DAYS, now),
    countDistinctStatusTransition(CONVERSION_LOOKBACK_DAYS, now, (m) =>
      m.from === "trial" && m.to === "active",
    ),
    countExpiredNotConverted(EXPIRED_LOOKBACK_DAYS, now),
    countDistinctStatusTransition(CHURN_LOOKBACK_DAYS, now, (m) =>
      m.to === "cancelled",
    ),
    computeEstimatedMrrCents(),
    countOpenSessionsByMode("read_only"),
    countOpenSessionsByMode("impersonation"),
    trialPipelineService.getTrialPipeline(),
  ]);

  const result: PlatformKpis = {
    generatedAt: now.toISOString(),
    active_tenants,
    trial_tenants,
    trials_ending_7d,
    converted_30d,
    expired_not_converted_30d,
    churned_30d,
    estimated_mrr_cents,
    estimated_arr_cents: estimated_mrr_cents * 12,
    stalled_trials: pipeline.buckets.stalled_trial.count,
    support_sessions_open,
    impersonations_open,
  };

  cache.set(CACHE_KEY, result, CacheTTL.SHORT);
  return result;
}

export const platformKpiService = {
  getPlatformKpis,
};
