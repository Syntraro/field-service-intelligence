/**
 * Admin Storage — Tenant Account & Admin Metrics
 *
 * Read-only repository for the Platform Admin Control Panel.
 * Provides account/admin metrics for tenant management.
 *
 * ARCHITECTURE RULE (2026-03-08): This module must NOT depend on operational
 * tables (jobs, job_visits, visit_technicians, tasks, calendar_assignments,
 * or any scheduling/dispatch concept). Operational metrics belong in separate
 * reporting/analytics surfaces, not in tenant admin.
 *
 * Allowed table dependencies:
 *   - companies (tenant identity, subscription)
 *   - users (account/team management)
 *   - qbo_sync_events, qbo_sync_queue (integration health — admin/support concern)
 *   - tenant_features, subscription_plans (account configuration)
 */

import { db } from "../db";
import { sql, eq, and, inArray, isNull, count, max, desc } from "drizzle-orm";
// 2026-05-04: containment predicate. Platform-admin tenant detail
// view should reflect TENANT user metrics only — a platform-role row
// parked at this tenant via `companyId` FK must not inflate the
// active-user count or appear in the recent-users list.
import { nonPlatformUserPredicate } from "./tenantUserPredicate";
import {
  companies,
  companySettings,
  users,
  qboSyncQueue,
  qboSyncEvents,
} from "@shared/schema";

// ============================================================================
// Types — Account/admin only. No operational metrics.
// ============================================================================

export interface TenantAccountSummary {
  company: {
    id: string;
    name: string;
    /** User-configured display name from company_settings; null if never set. */
    displayName: string | null;
    createdAt: Date;
    subscriptionStatus: string;
    subscriptionPlan: string | null;
    qboEnabled: boolean;
    qboEnvironment: string;
  };
  owner: {
    id: string;
    email: string;
    fullName: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
  users: {
    total: number;
    lastLoginAt: Date | null;
  };
  qbo: {
    connected: boolean;
    lastSyncAt: Date | null;
    failedSyncCount: number;
    queueSize: number;
  };
}

export interface TenantAccountDetail extends TenantAccountSummary {
  recentSyncErrors: Array<{
    id: string;
    eventType: string;
    errorMessage: string | null;
    createdAt: Date;
  }>;
  recentUsers: Array<{
    id: string;
    email: string;
    fullName: string | null;
    role: string;
    status: string;
    lastLoginAt: Date | null;
  }>;
}

// ============================================================================
// Repository Functions
// ============================================================================

// 2026-05-03 SECURITY LOCKDOWN: getTenantHealthList() was removed.
//
// Reason: it returned `TenantAccountSummary[]` for every company in the
// SaaS with NO companyId scope, and its only caller was the tenant-auth-
// gated `GET /api/admin/tenants` route. That combination let any tenant
// owner read the cross-tenant catalog (owner emails, user counts, QBO
// state across every customer). Both the route and the function are now
// gone. Cross-tenant tenant listing is exclusively `/api/platform/tenants`,
// gated by `requirePlatformSession` + `requireCapability("tenant:read")`
// and backed by `platformTenantsService.searchTenants(...)`.

/**
 * Get detailed account metrics for a specific tenant.
 * Extends TenantAccountSummary with recent users and sync errors.
 *
 * NO dependency on jobs, visits, tasks, or any scheduling tables.
 */
export async function getTenantDetail(companyId: string): Promise<TenantAccountDetail | null> {
  const companyResult = await db
    .select({
      id: companies.id,
      name: companies.name,
      // 2026-04-19 Profile consolidation: `companies.name` is canonical.
      // `displayName` is preserved on the response shape for backward
      // compatibility with existing Ops Portal consumers, but it now
      // mirrors `name` rather than being a separate settings-side value.
      displayName: companies.name,
      createdAt: companies.createdAt,
      subscriptionStatus: companies.subscriptionStatus,
      subscriptionPlan: companies.subscriptionPlan,
      qboEnabled: companies.qboEnabled,
      qboEnvironment: companies.qboEnvironment,
      qboRealmId: companies.qboRealmId,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  if (companyResult.length === 0) {
    return null;
  }

  const company = companyResult[0];

  // Primary contact selection (2026-04-16 integrity sprint).
  //
  // Old rule: most-recent-login owner. That surfaced test accounts like
  // pmtest@test.com whenever they happened to log in last, and ignored
  // admins entirely when the owner was a no-name shell.
  //
  // New rule (ranked), applied as a compound ORDER BY inside one query:
  //   1. User referenced by company_settings.user_id — the account that
  //      set up the tenant is the strongest existing anchor we have.
  //   2. role='owner' before role='admin'.
  //   3. Non-test / non-demo email (excludes @test.*, @example.*, and
  //      addresses containing "test" in the local part).
  //   4. Real name present (fullName, or firstName+lastName).
  //   5. Earliest-created legitimate user.
  //   6. Most-recent login as last tiebreaker.
  //
  // Hard filters: deletedAt IS NULL, disabled = false, status = 'active',
  // role IN ('owner','admin').
  const settingsUserRow = await db
    .select({ userId: companySettings.userId })
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);
  const settingsUserId = settingsUserRow[0]?.userId ?? null;

  const TEST_EMAIL_PATTERN = sql`(
    ${users.email} ILIKE '%@test.%'
    OR ${users.email} ILIKE '%@example.%'
    OR ${users.email} ILIKE 'test%@%'
    OR ${users.email} ILIKE '%+test@%'
  )`;

  const ownerUser = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(users)
    .where(and(
      eq(users.companyId, companyId),
      isNull(users.deletedAt),
      eq(users.disabled, false),
      eq(users.status, "active"),
      inArray(users.role, ["owner", "admin"]),
    ))
    .orderBy(
      // Tier 1 — company_settings.userId anchor. NULL-safe: when no
      // settings row exists, this branch evaluates to a constant so it
      // has no effect on ordering.
      sql`CASE WHEN ${users.id} = ${settingsUserId ?? null} THEN 0 ELSE 1 END`,
      // Tier 2 — owner before admin.
      sql`CASE ${users.role} WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END`,
      // Tier 3 — non-test email first.
      sql`CASE WHEN ${TEST_EMAIL_PATTERN} THEN 1 ELSE 0 END`,
      // Tier 4 — real name present.
      sql`CASE WHEN ${users.fullName} IS NOT NULL
                 OR ${users.firstName} IS NOT NULL
                 OR ${users.lastName} IS NOT NULL
           THEN 0 ELSE 1 END`,
      // Tier 5 — earliest legitimate user.
      users.createdAt,
      // Tier 6 — most recent login as final tiebreaker.
      sql`${users.lastLoginAt} DESC NULLS LAST`,
    )
    .limit(1);

  // User metrics (count + last login)
  const userMetrics = await db
    .select({
      total: count(),
      lastLoginAt: max(users.lastLoginAt),
    })
    .from(users)
    .where(and(
      eq(users.companyId, companyId),
      isNull(users.deletedAt),
      // 2026-05-04: count tenant users only.
      nonPlatformUserPredicate(),
    ));

  // QBO integration status
  const lastSync = await db
    .select({ createdAt: qboSyncEvents.createdAt })
    .from(qboSyncEvents)
    .where(eq(qboSyncEvents.companyId, companyId))
    .orderBy(desc(qboSyncEvents.createdAt))
    .limit(1);

  const failedSyncs = await db
    .select({ count: count() })
    .from(qboSyncEvents)
    .where(and(
      eq(qboSyncEvents.companyId, companyId),
      eq(qboSyncEvents.result, "FAILURE")
    ));

  const queueSize = await db
    .select({ count: count() })
    .from(qboSyncQueue)
    .where(and(
      eq(qboSyncQueue.companyId, companyId),
      sql`${qboSyncQueue.status} IN ('QUEUED', 'RUNNING')`
    ));

  // Recent sync errors (last 10)
  const recentSyncErrors = await db
    .select({
      id: qboSyncEvents.id,
      eventType: qboSyncEvents.eventType,
      errorMessage: qboSyncEvents.errorMessage,
      createdAt: qboSyncEvents.createdAt,
    })
    .from(qboSyncEvents)
    .where(and(
      eq(qboSyncEvents.companyId, companyId),
      eq(qboSyncEvents.result, "FAILURE")
    ))
    .orderBy(desc(qboSyncEvents.createdAt))
    .limit(10);

  // Recent users (last 10 by activity)
  const recentUsers = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      status: users.status,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .where(and(
      eq(users.companyId, companyId),
      isNull(users.deletedAt),
      // 2026-05-04: tenant users only.
      nonPlatformUserPredicate(),
    ))
    .orderBy(desc(users.lastLoginAt))
    .limit(10);

  return {
    company: {
      id: company.id,
      name: company.name,
      displayName: company.displayName ?? null,
      createdAt: company.createdAt,
      subscriptionStatus: company.subscriptionStatus,
      subscriptionPlan: company.subscriptionPlan ?? null,
      qboEnabled: company.qboEnabled,
      qboEnvironment: company.qboEnvironment,
    },
    owner: ownerUser[0]
      ? {
          id: ownerUser[0].id,
          email: ownerUser[0].email,
          fullName: ownerUser[0].fullName,
          firstName: ownerUser[0].firstName ?? null,
          lastName: ownerUser[0].lastName ?? null,
        }
      : null,
    users: {
      total: userMetrics[0]?.total || 0,
      lastLoginAt: userMetrics[0]?.lastLoginAt || null,
    },
    qbo: {
      connected: company.qboEnabled && !!company.qboRealmId,
      lastSyncAt: lastSync[0]?.createdAt || null,
      failedSyncCount: failedSyncs[0]?.count || 0,
      queueSize: queueSize[0]?.count || 0,
    },
    recentSyncErrors,
    recentUsers,
  };
}

export const adminRepository = {
  getTenantDetail,
};
