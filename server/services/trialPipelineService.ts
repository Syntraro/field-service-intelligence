/**
 * Trial Pipeline Service — SaaS Admin / Tenant Operations Phase A2.
 *
 * 2026-04-22: canonical READ service that turns silent trial data into an
 * actionable operator workflow. Reads existing tables only; no new writers,
 * no new schema, no duplicate roots.
 *
 * Buckets (mutually exclusive — a tenant belongs to exactly ONE):
 *
 *   converted_recently     subscription_events shows trial → active within 30d
 *   expired_not_converted  status='trial' AND trialEndsAt < now
 *   ending_soon            status='trial' AND trialEndsAt in [now, now+3d]
 *   stalled_trial          status='trial', trialEndsAt > now+3d, no login in ≥7d
 *   ending_this_week       status='trial' AND trialEndsAt in (now+3d, now+7d]
 *
 * Precedence: converted_recently > expired_not_converted > ending_soon >
 *             stalled_trial > ending_this_week.
 *
 * Each row is enriched with lastLoginAt + a 5-step onboarding snapshot
 * (hasClient / hasJob / hasInvoice / hasTechnician / hasQboConnected) so
 * operators can spot "trial ending with 0/5 steps" at a glance.
 */

import { and, eq, sql, desc, inArray, isNotNull, gt } from "drizzle-orm";
import { db } from "../db";
import {
  companies,
  users,
  clientLocations,
  jobs,
  invoices,
  subscriptionEvents,
} from "@shared/schema";
import { cache, CacheTTL } from "./cache";

// ============================================================================
// Public types
// ============================================================================

export type TrialBucket =
  | "ending_soon"
  | "ending_this_week"
  | "expired_not_converted"
  | "stalled_trial"
  | "converted_recently";

export interface OnboardingSnapshot {
  hasClient: boolean;
  hasJob: boolean;
  hasInvoice: boolean;
  hasTechnician: boolean;
  hasQboConnected: boolean;
  stepsCompleted: number;
  stepsTotal: number;
}

export interface TrialRow {
  companyId: string;
  companyName: string;
  plan: string | null;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  /**
   * Positive = days remaining until trialEndsAt.
   * Negative = days since trial expired.
   * Null = no trialEndsAt set.
   */
  daysUntilEnd: number | null;
  lastLoginAt: string | null;
  daysSinceLogin: number | null;
  onboarding: OnboardingSnapshot;
  /** Only populated for `converted_recently`. */
  convertedAt: string | null;
  createdAt: string;
}

export interface TrialBucketResult {
  count: number;
  rows: TrialRow[];
}

export interface TrialPipelineResult {
  generatedAt: string;
  buckets: Record<TrialBucket, TrialBucketResult>;
}

// ============================================================================
// Constants
// ============================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const STALLED_THRESHOLD_DAYS = 7;
const CONVERSION_LOOKBACK_DAYS = 30;
const ONBOARDING_STEPS_TOTAL = 5;
const CACHE_KEY = "trial_pipeline:v1";

// ============================================================================
// Helpers
// ============================================================================

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / MS_PER_DAY);
}

function classifyTrial(
  trialEndsAt: Date | null,
  daysSinceLogin: number | null,
  now: Date,
): Exclude<TrialBucket, "converted_recently"> {
  if (!trialEndsAt) {
    // No end date set — treat as stalled if no activity, else ending_this_week
    // (most neutral bucket). Operator will see and decide.
    return daysSinceLogin !== null && daysSinceLogin >= STALLED_THRESHOLD_DAYS
      ? "stalled_trial"
      : "ending_this_week";
  }
  const daysLeft = daysBetween(trialEndsAt, now);
  if (daysLeft < 0) return "expired_not_converted";
  if (daysLeft <= 3) return "ending_soon";
  if (daysLeft <= 7) {
    // Within the 4–7 window, escalate to stalled if no recent activity.
    if (daysSinceLogin !== null && daysSinceLogin >= STALLED_THRESHOLD_DAYS) {
      return "stalled_trial";
    }
    return "ending_this_week";
  }
  // >7 days out: only flag if stalled.
  if (daysSinceLogin !== null && daysSinceLogin >= STALLED_THRESHOLD_DAYS) {
    return "stalled_trial";
  }
  // Healthy long trial — not included in the dashboard.
  return "ending_this_week"; // sentinel; filtered out below
}

// ============================================================================
// Existence-check batch queries
// ============================================================================

async function batchExists(
  companyIds: string[],
  table:
    | typeof clientLocations
    | typeof jobs
    | typeof invoices,
  companyIdColumn: any,
): Promise<Set<string>> {
  if (companyIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ companyId: companyIdColumn })
    .from(table as any)
    .where(inArray(companyIdColumn, companyIds));
  return new Set(rows.map((r: any) => r.companyId as string));
}

async function batchTechnicianExists(companyIds: string[]): Promise<Set<string>> {
  if (companyIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ companyId: users.companyId })
    .from(users)
    .where(
      and(
        inArray(users.companyId, companyIds),
        eq(users.role, "technician"),
        eq(users.status, "active"),
      ),
    );
  return new Set(rows.map((r) => r.companyId as string));
}

async function batchLastLogin(companyIds: string[]): Promise<Map<string, Date>> {
  const map = new Map<string, Date>();
  if (companyIds.length === 0) return map;
  const rows = await db
    .select({
      companyId: users.companyId,
      lastLoginAt: sql<Date>`max(${users.lastLoginAt})`,
    })
    .from(users)
    .where(
      and(
        inArray(users.companyId, companyIds),
        isNotNull(users.lastLoginAt),
      ),
    )
    .groupBy(users.companyId);
  for (const r of rows) {
    if (r.lastLoginAt) map.set(r.companyId, new Date(r.lastLoginAt as any));
  }
  return map;
}

// ============================================================================
// Recently converted
// ============================================================================

/**
 * Finds companies whose subscription_events contains a trial → active
 * transition within the last `CONVERSION_LOOKBACK_DAYS` days. Uses the
 * canonical `status_changed` event written by subscriptionLifecycleService.
 */
async function readRecentlyConverted(): Promise<Array<{ companyId: string; convertedAt: Date }>> {
  const cutoff = new Date(Date.now() - CONVERSION_LOOKBACK_DAYS * MS_PER_DAY);
  const rows = await db
    .select({
      companyId: subscriptionEvents.companyId,
      createdAt: subscriptionEvents.createdAt,
      metadata: subscriptionEvents.metadata,
    })
    .from(subscriptionEvents)
    .where(
      and(
        eq(subscriptionEvents.type, "status_changed"),
        gt(subscriptionEvents.createdAt, cutoff),
      ),
    )
    .orderBy(desc(subscriptionEvents.createdAt));

  // Per-company: keep the MOST RECENT trial→active transition only.
  const latest = new Map<string, Date>();
  for (const row of rows) {
    const meta = (row.metadata as Record<string, unknown> | null) ?? {};
    if (meta.from !== "trial") continue;
    if (meta.to !== "active") continue;
    if (!latest.has(row.companyId)) {
      latest.set(row.companyId, row.createdAt);
    }
  }
  return Array.from(latest.entries()).map(([companyId, convertedAt]) => ({
    companyId,
    convertedAt,
  }));
}

// ============================================================================
// Main: getTrialPipeline
// ============================================================================

export async function getTrialPipeline(): Promise<TrialPipelineResult> {
  const cached = cache.get<TrialPipelineResult>(CACHE_KEY);
  if (cached) return cached;

  const now = new Date();

  // 1. Fetch all trial companies (small table, cached set).
  const trialCompanies = await db
    .select({
      id: companies.id,
      name: companies.name,
      subscriptionStatus: companies.subscriptionStatus,
      subscriptionPlan: companies.subscriptionPlan,
      trialEndsAt: companies.trialEndsAt,
      qboEnabled: companies.qboEnabled,
      qboRealmId: companies.qboRealmId,
      createdAt: companies.createdAt,
    })
    .from(companies)
    .where(eq(companies.subscriptionStatus, "trial"));

  // 2. Fetch recently-converted companies (separate query, then fetch their company rows).
  const conversions = await readRecentlyConverted();
  const convertedCompanyIds = conversions.map((c) => c.companyId);
  const convertedAtById = new Map(conversions.map((c) => [c.companyId, c.convertedAt]));

  const convertedCompanies = convertedCompanyIds.length
    ? await db
        .select({
          id: companies.id,
          name: companies.name,
          subscriptionStatus: companies.subscriptionStatus,
          subscriptionPlan: companies.subscriptionPlan,
          trialEndsAt: companies.trialEndsAt,
          qboEnabled: companies.qboEnabled,
          qboRealmId: companies.qboRealmId,
          createdAt: companies.createdAt,
        })
        .from(companies)
        .where(inArray(companies.id, convertedCompanyIds))
    : [];

  // 3. Combined company id set for batch enrichment.
  const allIds = Array.from(
    new Set([...trialCompanies.map((c) => c.id), ...convertedCompanies.map((c) => c.id)]),
  );

  const [
    hasClientSet,
    hasJobSet,
    hasInvoiceSet,
    hasTechSet,
    lastLoginMap,
  ] = await Promise.all([
    batchExists(allIds, clientLocations, clientLocations.companyId),
    batchExists(allIds, jobs, jobs.companyId),
    batchExists(allIds, invoices, invoices.companyId),
    batchTechnicianExists(allIds),
    batchLastLogin(allIds),
  ]);

  function buildRow(
    c: (typeof trialCompanies)[number],
    convertedAt: Date | null = null,
  ): TrialRow {
    const hasClient = hasClientSet.has(c.id);
    const hasJob = hasJobSet.has(c.id);
    const hasInvoice = hasInvoiceSet.has(c.id);
    const hasTechnician = hasTechSet.has(c.id);
    const hasQboConnected = Boolean(c.qboEnabled && c.qboRealmId);
    const steps = [hasClient, hasJob, hasInvoice, hasTechnician, hasQboConnected];
    const stepsCompleted = steps.filter(Boolean).length;

    const lastLoginAt = lastLoginMap.get(c.id) ?? null;
    const daysSinceLogin =
      lastLoginAt ? daysBetween(now, lastLoginAt) : null;

    const daysUntilEnd = c.trialEndsAt ? daysBetween(c.trialEndsAt, now) : null;

    return {
      companyId: c.id,
      companyName: c.name,
      plan: c.subscriptionPlan ?? null,
      subscriptionStatus: c.subscriptionStatus,
      trialEndsAt: c.trialEndsAt ? c.trialEndsAt.toISOString() : null,
      daysUntilEnd,
      lastLoginAt: lastLoginAt ? lastLoginAt.toISOString() : null,
      daysSinceLogin,
      onboarding: {
        hasClient,
        hasJob,
        hasInvoice,
        hasTechnician,
        hasQboConnected,
        stepsCompleted,
        stepsTotal: ONBOARDING_STEPS_TOTAL,
      },
      convertedAt: convertedAt ? convertedAt.toISOString() : null,
      createdAt: c.createdAt.toISOString(),
    };
  }

  // 4. Assemble buckets.
  const buckets: Record<TrialBucket, TrialRow[]> = {
    ending_soon: [],
    ending_this_week: [],
    expired_not_converted: [],
    stalled_trial: [],
    converted_recently: [],
  };

  // converted_recently first — these are explicitly NOT active trials.
  for (const c of convertedCompanies) {
    const convertedAt = convertedAtById.get(c.id) ?? null;
    buckets.converted_recently.push(buildRow(c, convertedAt));
  }

  // Trial companies — classify via classifyTrial(), but skip healthy long
  // trials (>7d out with recent login) so the dashboard is actionable.
  for (const c of trialCompanies) {
    const lastLoginAt = lastLoginMap.get(c.id) ?? null;
    const daysSinceLogin =
      lastLoginAt ? daysBetween(now, lastLoginAt) : null;
    const daysUntilEnd = c.trialEndsAt ? daysBetween(c.trialEndsAt, now) : null;

    // Healthy long trial — skip
    if (
      daysUntilEnd !== null &&
      daysUntilEnd > 7 &&
      (daysSinceLogin === null || daysSinceLogin < STALLED_THRESHOLD_DAYS)
    ) {
      continue;
    }

    const bucket = classifyTrial(c.trialEndsAt, daysSinceLogin, now);
    buckets[bucket].push(buildRow(c));
  }

  // 5. Sort each bucket for operator readability.
  //    ending_soon / ending_this_week: ascending daysUntilEnd (most urgent first).
  //    expired_not_converted: ascending daysUntilEnd too (most-recently-expired first is the
  //      largest — e.g., -1 then -5; so DESC of daysUntilEnd = ascending days-since-expiry).
  //    stalled_trial: descending daysSinceLogin (longest-stalled first).
  //    converted_recently: descending convertedAt (most recent first).
  buckets.ending_soon.sort((a, b) => (a.daysUntilEnd ?? 999) - (b.daysUntilEnd ?? 999));
  buckets.ending_this_week.sort((a, b) => (a.daysUntilEnd ?? 999) - (b.daysUntilEnd ?? 999));
  buckets.expired_not_converted.sort(
    (a, b) => (b.daysUntilEnd ?? -999) - (a.daysUntilEnd ?? -999),
  );
  buckets.stalled_trial.sort((a, b) => (b.daysSinceLogin ?? 0) - (a.daysSinceLogin ?? 0));
  buckets.converted_recently.sort((a, b) =>
    (b.convertedAt ?? "").localeCompare(a.convertedAt ?? ""),
  );

  const result: TrialPipelineResult = {
    generatedAt: now.toISOString(),
    buckets: {
      ending_soon: { count: buckets.ending_soon.length, rows: buckets.ending_soon },
      ending_this_week: { count: buckets.ending_this_week.length, rows: buckets.ending_this_week },
      expired_not_converted: {
        count: buckets.expired_not_converted.length,
        rows: buckets.expired_not_converted,
      },
      stalled_trial: { count: buckets.stalled_trial.length, rows: buckets.stalled_trial },
      converted_recently: {
        count: buckets.converted_recently.length,
        rows: buckets.converted_recently,
      },
    },
  };

  // 60s cache — dashboard reload is acceptable on this cadence.
  cache.set(CACHE_KEY, result, CacheTTL.SHORT);
  return result;
}

export const trialPipelineService = {
  getTrialPipeline,
};
