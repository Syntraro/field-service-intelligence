/**
 * Admin Storage - Tenant Health Metrics
 *
 * Read-only repository for the Admin Control Panel.
 * Provides aggregated health metrics across all tenants.
 */

import { db } from "../db";
import { sql, eq, and, gte, lte, isNull, count, max, desc } from "drizzle-orm";
import {
  companies,
  users,
  jobs,
  qboSyncQueue,
  qboSyncEvents,
} from "@shared/schema";

// ============================================================================
// Types
// ============================================================================

export interface TenantHealthSummary {
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
    activeTechnicians: number;
    lastLoginAt: Date | null;
  };
  jobs: {
    openCount: number;
    onHoldCount: number;  // Jobs with openSubStatus = 'on_hold' or 'needs_review'
    overdueCount: number;
  };
  calendar: {
    scheduledThisWeek: number;
  };
  qbo: {
    connected: boolean;
    lastSyncAt: Date | null;
    failedSyncCount: number;
    queueSize: number;
  };
}

export interface TenantDetail extends TenantHealthSummary {
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
// Helper Functions
// ============================================================================

function getWeekRange(): { start: Date; end: Date } {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const start = new Date(now);
  start.setDate(now.getDate() - daysToMonday);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

// ============================================================================
// Repository Functions
// ============================================================================

/**
 * Get all tenants with health summary metrics
 *
 * PHASE A PERFORMANCE FIX: Uses batch aggregation queries instead of N+1 pattern
 * Previously: 10 queries per company = 500+ queries for 50 tenants
 * Now: 8 batch queries total regardless of tenant count
 */
export async function getTenantHealthList(): Promise<TenantHealthSummary[]> {
  const weekRange = getWeekRange();

  // BATCH QUERY 1: Get all companies in one query
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

  // BATCH QUERY 2: Get all owners (one per company, most recent login)
  // Uses DISTINCT ON to get one owner per company
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

  // BATCH QUERY 3: Get all user metrics aggregated by company
  const userMetricsRows = await db.execute<{
    company_id: string;
    total: string;
    last_login_at: Date | null;
    active_technicians: string;
  }>(sql`
    SELECT
      company_id,
      COUNT(*) as total,
      MAX(last_login_at) as last_login_at,
      COUNT(*) FILTER (WHERE role = 'technician' AND status = 'active') as active_technicians
    FROM users
    WHERE deleted_at IS NULL
    GROUP BY company_id
  `);
  const userMetricsMap = new Map(userMetricsRows.rows.map(r => [r.company_id, r]));

  // BATCH QUERY 4: Get all job metrics aggregated by company
  // Using normalized 4-status model: open, completed, invoiced, archived
  const jobMetricsRows = await db.execute<{
    company_id: string;
    open_count: string;
    on_hold_count: string;
    overdue_count: string;
  }>(sql`
    SELECT
      company_id,
      COUNT(*) FILTER (WHERE status = 'open') as open_count,
      COUNT(*) FILTER (WHERE status = 'open' AND open_sub_status = 'on_hold') as on_hold_count,
      -- Phase 2 Step 5: Overdue = effectiveEnd < NOW
      -- effectiveEnd priority: scheduled_end > scheduled_start + estimated_duration_minutes > scheduled_start
      COUNT(*) FILTER (
        WHERE scheduled_start IS NOT NULL
        AND status = 'open'
        AND CASE
          WHEN scheduled_end IS NOT NULL THEN scheduled_end
          WHEN estimated_duration_minutes IS NOT NULL THEN scheduled_start + (estimated_duration_minutes || ' minutes')::interval
          ELSE scheduled_start
        END < NOW()
      ) as overdue_count
    FROM jobs
    WHERE deleted_at IS NULL
    GROUP BY company_id
  `);
  const jobMetricsMap = new Map(jobMetricsRows.rows.map(r => [r.company_id, r]));

  // BATCH QUERY 5: Get calendar assignments for current week by company
  const calendarRows = await db.execute<{
    company_id: string;
    scheduled_count: string;
  }>(sql`
    SELECT
      company_id,
      COUNT(*) as scheduled_count
    FROM calendar_assignments
    WHERE scheduled_date >= ${weekRange.start.toISOString().split('T')[0]}
      AND scheduled_date <= ${weekRange.end.toISOString().split('T')[0]}
    GROUP BY company_id
  `);
  const calendarMap = new Map(calendarRows.rows.map(r => [r.company_id, r]));

  // BATCH QUERY 6: Get last sync timestamp per company
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

  // BATCH QUERY 7: Get failed sync counts per company
  const failedSyncRows = await db.execute<{
    company_id: string;
    failed_count: string;
  }>(sql`
    SELECT
      company_id,
      COUNT(*) as failed_count
    FROM qbo_sync_events
    WHERE result = 'FAILURE'
    GROUP BY company_id
  `);
  const failedSyncMap = new Map(failedSyncRows.rows.map(r => [r.company_id, r]));

  // BATCH QUERY 8: Get queue sizes per company
  const queueRows = await db.execute<{
    company_id: string;
    queue_size: string;
  }>(sql`
    SELECT
      company_id,
      COUNT(*) as queue_size
    FROM qbo_sync_queue
    WHERE status IN ('QUEUED', 'RUNNING')
    GROUP BY company_id
  `);
  const queueMap = new Map(queueRows.rows.map(r => [r.company_id, r]));

  // Combine all metrics in memory (O(n) with constant-time Map lookups)
  return allCompanies.map(company => {
    const owner = ownerMap.get(company.id);
    const userMetrics = userMetricsMap.get(company.id);
    const jobMetrics = jobMetricsMap.get(company.id);
    const calendar = calendarMap.get(company.id);
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
        activeTechnicians: parseInt(userMetrics?.active_technicians || "0", 10),
        lastLoginAt: userMetrics?.last_login_at || null,
      },
      jobs: {
        openCount: parseInt(jobMetrics?.open_count || "0", 10),
        onHoldCount: parseInt(jobMetrics?.on_hold_count || "0", 10),
        overdueCount: parseInt(jobMetrics?.overdue_count || "0", 10),
      },
      calendar: {
        scheduledThisWeek: parseInt(calendar?.scheduled_count || "0", 10),
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
 * Get detailed tenant metrics for a specific company
 */
export async function getTenantDetail(companyId: string): Promise<TenantDetail | null> {
  // Get base company info
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
  const weekRange = getWeekRange();

  // Get owner user (most recently active owner, or first owner if none active)
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

  // Get all the same metrics as the list
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

  const technicianCount = await db
    .select({ count: count() })
    .from(users)
    .where(and(
      eq(users.companyId, companyId),
      eq(users.role, "technician"),
      eq(users.status, "active"),
      isNull(users.deletedAt)
    ));

  // Using normalized 4-status model: open, completed, invoiced, archived
  const openJobs = await db
    .select({ count: count() })
    .from(jobs)
    .where(and(
      eq(jobs.companyId, companyId),
      isNull(jobs.deletedAt),
      eq(jobs.status, "open")
    ));

  // Jobs needing attention: on_hold sub-status
  const onHoldJobs = await db
    .select({ count: count() })
    .from(jobs)
    .where(and(
      eq(jobs.companyId, companyId),
      eq(jobs.status, "open"),
      eq(jobs.openSubStatus, "on_hold"),
      isNull(jobs.deletedAt)
    ));

  // Phase 2 Step 5: Overdue = effectiveEnd < NOW
  // effectiveEnd priority: scheduled_end > scheduled_start + estimated_duration_minutes > scheduled_start
  const overdueJobs = await db
    .select({ count: count() })
    .from(jobs)
    .where(and(
      eq(jobs.companyId, companyId),
      isNull(jobs.deletedAt),
      sql`${jobs.scheduledStart} IS NOT NULL`,
      sql`CASE
        WHEN ${jobs.scheduledEnd} IS NOT NULL THEN ${jobs.scheduledEnd}
        WHEN ${jobs.durationMinutes} IS NOT NULL THEN ${jobs.scheduledStart} + (${jobs.durationMinutes} || ' minutes')::interval
        ELSE ${jobs.scheduledStart}
      END < NOW()`,
      eq(jobs.status, "open")
    ));

  // MODEL A: Query scheduled jobs from jobs table (not calendar_assignments)
  const scheduledThisWeek = await db
    .select({ count: count() })
    .from(jobs)
    .where(and(
      eq(jobs.companyId, companyId),
      isNull(jobs.deletedAt),
      sql`${jobs.scheduledStart} IS NOT NULL`,
      gte(jobs.scheduledStart, weekRange.start),
      lte(jobs.scheduledStart, weekRange.end)
    ));

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

  // Get recent sync errors (last 10)
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

  // Get recent users (last 10 active)
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
      activeTechnicians: technicianCount[0]?.count || 0,
      lastLoginAt: userMetrics[0]?.lastLoginAt || null,
    },
    jobs: {
      openCount: openJobs[0]?.count || 0,
      onHoldCount: onHoldJobs[0]?.count || 0,
      overdueCount: overdueJobs[0]?.count || 0,
    },
    calendar: {
      scheduledThisWeek: scheduledThisWeek[0]?.count || 0,
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
