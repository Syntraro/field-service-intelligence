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
import { sql, eq, and, isNull, count, max, desc } from "drizzle-orm";
import {
  companies,
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
    createdAt: Date;
    subscriptionStatus: string;
    qboEnabled: boolean;
    qboEnvironment: string;
  };
  owner: {
    id: string;
    email: string;
    fullName: string | null;
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

/**
 * Get all tenants with account-level summary metrics.
 *
 * Uses batch aggregation queries (5 total) regardless of tenant count.
 * Queries ONLY account/admin tables: companies, users, qbo_sync_events, qbo_sync_queue.
 * NO dependency on jobs, visits, tasks, or any scheduling tables.
 */
export async function getTenantHealthList(): Promise<TenantAccountSummary[]> {
  // BATCH QUERY 1: All companies
  const allCompanies = await db
    .select({
      id: companies.id,
      name: companies.name,
      createdAt: companies.createdAt,
      subscriptionStatus: companies.subscriptionStatus,
      qboEnabled: companies.qboEnabled,
      qboEnvironment: companies.qboEnvironment,
      qboRealmId: companies.qboRealmId,
    })
    .from(companies)
    .orderBy(desc(companies.createdAt));

  if (allCompanies.length === 0) {
    return [];
  }

  // BATCH QUERY 2: Owners (one per company, most recently active)
  const ownerRows = await db.execute<{
    company_id: string;
    id: string;
    email: string;
    full_name: string | null;
  }>(sql`
    SELECT DISTINCT ON (company_id)
      company_id,
      id,
      email,
      full_name
    FROM users
    WHERE role = 'owner'
      AND deleted_at IS NULL
    ORDER BY company_id, last_login_at DESC NULLS LAST
  `);
  const ownerMap = new Map(ownerRows.rows.map(r => [r.company_id, r]));

  // BATCH QUERY 3: User count + last login per company
  const userMetricsRows = await db.execute<{
    company_id: string;
    total: string;
    last_login_at: Date | null;
  }>(sql`
    SELECT
      company_id,
      COUNT(*) as total,
      MAX(last_login_at) as last_login_at
    FROM users
    WHERE deleted_at IS NULL
    GROUP BY company_id
  `);
  const userMetricsMap = new Map(userMetricsRows.rows.map(r => [r.company_id, r]));

  // BATCH QUERY 4: Last QBO sync timestamp per company
  const lastSyncRows = await db.execute<{
    company_id: string;
    last_sync_at: Date;
  }>(sql`
    SELECT DISTINCT ON (company_id)
      company_id,
      created_at as last_sync_at
    FROM qbo_sync_events
    ORDER BY company_id, created_at DESC
  `);
  const lastSyncMap = new Map(lastSyncRows.rows.map(r => [r.company_id, r]));

  // BATCH QUERY 5: QBO failed sync counts + queue sizes per company (combined)
  const [failedSyncRows, queueRows] = await Promise.all([
    db.execute<{
      company_id: string;
      failed_count: string;
    }>(sql`
      SELECT
        company_id,
        COUNT(*) as failed_count
      FROM qbo_sync_events
      WHERE result = 'FAILURE'
      GROUP BY company_id
    `),
    db.execute<{
      company_id: string;
      queue_size: string;
    }>(sql`
      SELECT
        company_id,
        COUNT(*) as queue_size
      FROM qbo_sync_queue
      WHERE status IN ('QUEUED', 'RUNNING')
      GROUP BY company_id
    `),
  ]);
  const failedSyncMap = new Map(failedSyncRows.rows.map(r => [r.company_id, r]));
  const queueMap = new Map(queueRows.rows.map(r => [r.company_id, r]));

  // Combine in memory (O(n) with constant-time Map lookups)
  return allCompanies.map(company => {
    const owner = ownerMap.get(company.id);
    const userMetrics = userMetricsMap.get(company.id);
    const lastSync = lastSyncMap.get(company.id);
    const failedSync = failedSyncMap.get(company.id);
    const queue = queueMap.get(company.id);

    return {
      company: {
        id: company.id,
        name: company.name,
        createdAt: company.createdAt,
        subscriptionStatus: company.subscriptionStatus,
        qboEnabled: company.qboEnabled,
        qboEnvironment: company.qboEnvironment,
      },
      owner: owner
        ? {
            id: owner.id,
            email: owner.email,
            fullName: owner.full_name,
          }
        : null,
      users: {
        total: parseInt(userMetrics?.total || "0", 10),
        lastLoginAt: userMetrics?.last_login_at || null,
      },
      qbo: {
        connected: company.qboEnabled && !!company.qboRealmId,
        lastSyncAt: lastSync?.last_sync_at || null,
        failedSyncCount: parseInt(failedSync?.failed_count || "0", 10),
        queueSize: parseInt(queue?.queue_size || "0", 10),
      },
    };
  });
}

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
      createdAt: companies.createdAt,
      subscriptionStatus: companies.subscriptionStatus,
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

  // Owner (most recently active)
  const ownerUser = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
    })
    .from(users)
    .where(and(
      eq(users.companyId, companyId),
      eq(users.role, "owner"),
      isNull(users.deletedAt)
    ))
    .orderBy(desc(users.lastLoginAt))
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
      isNull(users.deletedAt)
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
      isNull(users.deletedAt)
    ))
    .orderBy(desc(users.lastLoginAt))
    .limit(10);

  return {
    company: {
      id: company.id,
      name: company.name,
      createdAt: company.createdAt,
      subscriptionStatus: company.subscriptionStatus,
      qboEnabled: company.qboEnabled,
      qboEnvironment: company.qboEnvironment,
    },
    owner: ownerUser[0]
      ? {
          id: ownerUser[0].id,
          email: ownerUser[0].email,
          fullName: ownerUser[0].fullName,
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
  getTenantHealthList,
  getTenantDetail,
};
