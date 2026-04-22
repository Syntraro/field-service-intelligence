/**
 * Tenant Health Service — SaaS Admin / Tenant Operations Phase A4.
 *
 * 2026-04-22: canonical READ service that scores each tenant on a
 * deterministic 0-100 scale. Single source of truth for "how healthy is
 * this tenant" — client surfaces (list, detail, future KPI breakdowns)
 * must call this service, never recompute locally.
 *
 * Read-only. Reads existing tables only. No cache at the service layer —
 * downstream callers (tenant list endpoint, detail panel) cache their
 * own responses.
 *
 * ============================================================================
 * SCORE FORMULA (deterministic — run the numbers yourself from inputs)
 * ============================================================================
 *
 * Start at 100. Apply penalties in a fixed order (so the `reasons` array
 * is stable across calls). Clamp to [0, 100] at the end.
 *
 *   A. Subscription state (mutually exclusive):
 *        cancelled                       → -70   "Subscription cancelled"
 *        past_due                        → -50   "Subscription past due"
 *        trial + expired (< now)         → -60   "Trial expired {N}d ago"
 *        trial + <=3d remaining          → -30   "Trial ends in {N}d"
 *        paused                          → -25   "Subscription paused"
 *        trial + <=7d remaining          → -12   "Trial ends in {N}d"
 *        (healthy active or long trial)  →   0
 *
 *   B. Activity gap (max of users.lastLoginAt, jobs.createdAt,
 *      invoices.createdAt — "last_activity_at"):
 *        none, signup >3d ago            → -18   "No activity yet"
 *        gap > 30d                       → -22   "No activity for {N}d"
 *        gap > 14d                       → -12   "No activity for {N}d"
 *        gap > 7d                        → -5    "No activity for {N}d"
 *
 *   C. Onboarding (only penalized for tenants that have had time):
 *        0/5 steps,  signup >=2d ago     → -15   "Onboarding not started"
 *        <=2/5 steps, signup >=7d ago    → -8    "Onboarding stalled (N/5)"
 *
 *   D. Long-running open support session (>7d since created,
 *      status IN ('pending','active')):
 *                                        → -5    "Support session {N}d old"
 *
 * Status thresholds:
 *   score >= 80 → healthy
 *   score >= 60 → watch
 *   score >= 30 → at_risk
 *   score  < 30 → critical
 *
 * Healthy + active-with-recent-activity tenants score 100.
 *
 * ============================================================================
 */

import { and, eq, inArray, isNotNull, sql, lt, gte } from "drizzle-orm";
import { db } from "../db";
import {
  companies,
  users,
  clientLocations,
  jobs,
  invoices,
  impersonationSessions,
} from "@shared/schema";

// ============================================================================
// Public types
// ============================================================================

export type HealthStatus = "healthy" | "watch" | "at_risk" | "critical";

export interface HealthReason {
  code: string;
  message: string;
  penalty: number;
}

export interface TenantHealth {
  companyId: string;
  score: number;
  status: HealthStatus;
  reasons: HealthReason[];
  lastActivityAt: string | null;
  daysSinceLastActivity: number | null;
  onboardingSteps: number;
  onboardingTotal: number;
}

interface HealthInputs {
  companyId: string;
  subscriptionStatus: string;
  trialEndsAt: Date | null;
  createdAt: Date;
  lastActivityAt: Date | null;
  onboardingSteps: number;
  onboardingTotal: number;
  openSupportSessionAgeDays: number | null;
  now: Date;
}

// ============================================================================
// Constants
// ============================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ONBOARDING_STEPS_TOTAL = 5;

// ============================================================================
// Helpers
// ============================================================================

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / MS_PER_DAY);
}

function statusFromScore(score: number): HealthStatus {
  if (score >= 80) return "healthy";
  if (score >= 60) return "watch";
  if (score >= 30) return "at_risk";
  return "critical";
}

// ============================================================================
// Pure scoring function (testable in isolation)
// ============================================================================

export function computeTenantHealth(input: HealthInputs): TenantHealth {
  const { now, subscriptionStatus, trialEndsAt, createdAt, lastActivityAt } = input;

  let score = 100;
  const reasons: HealthReason[] = [];

  const pushPenalty = (code: string, message: string, penalty: number) => {
    score -= penalty;
    reasons.push({ code, message, penalty });
  };

  // ── A. Subscription state (mutually exclusive) ───────────────────────────
  const daysUntilTrialEnd = trialEndsAt ? daysBetween(trialEndsAt, now) : null;

  if (subscriptionStatus === "cancelled") {
    pushPenalty("sub_cancelled", "Subscription cancelled", 70);
  } else if (subscriptionStatus === "past_due") {
    pushPenalty("sub_past_due", "Subscription past due", 50);
  } else if (subscriptionStatus === "trial" && daysUntilTrialEnd !== null && daysUntilTrialEnd < 0) {
    const daysExpired = Math.abs(daysUntilTrialEnd);
    pushPenalty("trial_expired", `Trial expired ${daysExpired}d ago`, 60);
  } else if (
    subscriptionStatus === "trial" &&
    daysUntilTrialEnd !== null &&
    daysUntilTrialEnd <= 3
  ) {
    pushPenalty(
      "trial_ending_soon",
      `Trial ends in ${daysUntilTrialEnd}d`,
      30,
    );
  } else if (subscriptionStatus === "paused") {
    pushPenalty("sub_paused", "Subscription paused", 25);
  } else if (
    subscriptionStatus === "trial" &&
    daysUntilTrialEnd !== null &&
    daysUntilTrialEnd <= 7
  ) {
    pushPenalty(
      "trial_ending_this_week",
      `Trial ends in ${daysUntilTrialEnd}d`,
      12,
    );
  }

  // ── B. Activity gap ──────────────────────────────────────────────────────
  const daysSinceLastActivity = lastActivityAt ? daysBetween(now, lastActivityAt) : null;
  const daysSinceSignup = daysBetween(now, createdAt);

  if (daysSinceLastActivity === null && daysSinceSignup > 3) {
    pushPenalty("never_active", "No activity yet", 18);
  } else if (daysSinceLastActivity !== null) {
    if (daysSinceLastActivity > 30) {
      pushPenalty(
        "inactive_30",
        `No activity for ${daysSinceLastActivity}d`,
        22,
      );
    } else if (daysSinceLastActivity > 14) {
      pushPenalty(
        "inactive_14",
        `No activity for ${daysSinceLastActivity}d`,
        12,
      );
    } else if (daysSinceLastActivity > 7) {
      pushPenalty(
        "inactive_7",
        `No activity for ${daysSinceLastActivity}d`,
        5,
      );
    }
  }

  // ── C. Onboarding (grace period by signup age) ───────────────────────────
  if (input.onboardingSteps === 0 && daysSinceSignup >= 2) {
    pushPenalty("onboarding_not_started", "Onboarding not started", 15);
  } else if (input.onboardingSteps <= 2 && daysSinceSignup >= 7) {
    pushPenalty(
      "onboarding_stalled",
      `Onboarding stalled (${input.onboardingSteps}/${input.onboardingTotal})`,
      8,
    );
  }

  // ── D. Long-running open support session ─────────────────────────────────
  if (
    input.openSupportSessionAgeDays !== null &&
    input.openSupportSessionAgeDays > 7
  ) {
    pushPenalty(
      "long_support_session",
      `Support session ${input.openSupportSessionAgeDays}d old`,
      5,
    );
  }

  const clamped = Math.max(0, Math.min(100, score));
  // Sort reasons by penalty magnitude desc so `reasons[0]` is the top driver.
  reasons.sort((a, b) => b.penalty - a.penalty);

  return {
    companyId: input.companyId,
    score: clamped,
    status: statusFromScore(clamped),
    reasons,
    lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
    daysSinceLastActivity,
    onboardingSteps: input.onboardingSteps,
    onboardingTotal: input.onboardingTotal,
  };
}

// ============================================================================
// Batch DB gathers
// ============================================================================

async function batchMaxLastLogin(companyIds: string[]): Promise<Map<string, Date>> {
  const map = new Map<string, Date>();
  if (companyIds.length === 0) return map;
  const rows = await db
    .select({
      companyId: users.companyId,
      ts: sql<Date | null>`max(${users.lastLoginAt})`,
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
    if (r.ts) map.set(r.companyId, new Date(r.ts as any));
  }
  return map;
}

async function batchMaxTimestamp(
  companyIds: string[],
  table: typeof jobs | typeof invoices,
  companyIdCol: any,
  createdAtCol: any,
): Promise<Map<string, Date>> {
  const map = new Map<string, Date>();
  if (companyIds.length === 0) return map;
  const rows = await db
    .select({
      companyId: companyIdCol,
      ts: sql<Date | null>`max(${createdAtCol})`,
    })
    .from(table as any)
    .where(inArray(companyIdCol, companyIds))
    .groupBy(companyIdCol);
  for (const r of rows as any[]) {
    if (r.ts) map.set(r.companyId as string, new Date(r.ts));
  }
  return map;
}

async function batchExists(
  companyIds: string[],
  table: typeof clientLocations | typeof jobs | typeof invoices,
  companyIdCol: any,
): Promise<Set<string>> {
  if (companyIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ companyId: companyIdCol })
    .from(table as any)
    .where(inArray(companyIdCol, companyIds));
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

async function batchOpenSupportSessionAge(
  companyIds: string[],
  now: Date,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (companyIds.length === 0) return map;
  // Oldest `createdAt` among currently-open (pending or active) sessions
  // per company. Age in days is derived once per row after the query.
  const rows = await db
    .select({
      companyId: impersonationSessions.companyId,
      ts: sql<Date | null>`min(${impersonationSessions.createdAt})`,
    })
    .from(impersonationSessions)
    .where(
      and(
        inArray(impersonationSessions.companyId, companyIds),
        inArray(impersonationSessions.status, ["pending", "active"]),
      ),
    )
    .groupBy(impersonationSessions.companyId);
  for (const r of rows) {
    if (r.ts) {
      map.set(r.companyId, daysBetween(now, new Date(r.ts as any)));
    }
  }
  return map;
}

interface CompanyIdentity {
  id: string;
  subscriptionStatus: string;
  trialEndsAt: Date | null;
  createdAt: Date;
  qboEnabled: boolean;
  qboRealmId: string | null;
}

async function batchCompanyIdentities(companyIds: string[]): Promise<Map<string, CompanyIdentity>> {
  const map = new Map<string, CompanyIdentity>();
  if (companyIds.length === 0) return map;
  const rows = await db
    .select({
      id: companies.id,
      subscriptionStatus: companies.subscriptionStatus,
      trialEndsAt: companies.trialEndsAt,
      createdAt: companies.createdAt,
      qboEnabled: companies.qboEnabled,
      qboRealmId: companies.qboRealmId,
    })
    .from(companies)
    .where(inArray(companies.id, companyIds));
  for (const r of rows) map.set(r.id, r);
  return map;
}

// ============================================================================
// Public: getHealthForCompanies
// ============================================================================

export async function getHealthForCompanies(
  companyIds: string[],
  opts?: { identities?: Map<string, CompanyIdentity> },
): Promise<Map<string, TenantHealth>> {
  const map = new Map<string, TenantHealth>();
  if (companyIds.length === 0) return map;

  const now = new Date();

  const identitiesP = opts?.identities
    ? Promise.resolve(opts.identities)
    : batchCompanyIdentities(companyIds);

  const [
    identities,
    lastLoginMap,
    lastJobMap,
    lastInvoiceMap,
    hasClientSet,
    hasJobSet,
    hasInvoiceSet,
    hasTechSet,
    openSupportAgeMap,
  ] = await Promise.all([
    identitiesP,
    batchMaxLastLogin(companyIds),
    batchMaxTimestamp(companyIds, jobs, jobs.companyId, jobs.createdAt),
    batchMaxTimestamp(companyIds, invoices, invoices.companyId, invoices.createdAt),
    batchExists(companyIds, clientLocations, clientLocations.companyId),
    batchExists(companyIds, jobs, jobs.companyId),
    batchExists(companyIds, invoices, invoices.companyId),
    batchTechnicianExists(companyIds),
    batchOpenSupportSessionAge(companyIds, now),
  ]);

  for (const companyId of companyIds) {
    const identity = identities.get(companyId);
    if (!identity) continue;

    const candidates: Date[] = [];
    const login = lastLoginMap.get(companyId);
    const job = lastJobMap.get(companyId);
    const inv = lastInvoiceMap.get(companyId);
    if (login) candidates.push(login);
    if (job) candidates.push(job);
    if (inv) candidates.push(inv);
    const lastActivityAt =
      candidates.length > 0
        ? candidates.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b))
        : null;

    const onboardingSteps =
      (hasClientSet.has(companyId) ? 1 : 0) +
      (hasJobSet.has(companyId) ? 1 : 0) +
      (hasInvoiceSet.has(companyId) ? 1 : 0) +
      (hasTechSet.has(companyId) ? 1 : 0) +
      (identity.qboEnabled && identity.qboRealmId ? 1 : 0);

    const health = computeTenantHealth({
      companyId,
      subscriptionStatus: identity.subscriptionStatus,
      trialEndsAt: identity.trialEndsAt,
      createdAt: identity.createdAt,
      lastActivityAt,
      onboardingSteps,
      onboardingTotal: ONBOARDING_STEPS_TOTAL,
      openSupportSessionAgeDays: openSupportAgeMap.get(companyId) ?? null,
      now,
    });

    map.set(companyId, health);
  }

  return map;
}

export async function getHealthForCompany(companyId: string): Promise<TenantHealth | null> {
  const map = await getHealthForCompanies([companyId]);
  return map.get(companyId) ?? null;
}

export const tenantHealthService = {
  getHealthForCompanies,
  getHealthForCompany,
  computeTenantHealth,
};
