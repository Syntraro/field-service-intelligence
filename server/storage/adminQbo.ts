/**
 * Admin QBO Repository - Cross-tenant QBO oversight functions
 *
 * Provides platform admin (owner) access to QBO sync data across all tenants.
 * All functions in this file bypass tenant isolation for admin-level monitoring.
 */

import { db } from "../db";
import { eq, and, desc, sql, or, lte, isNull, isNotNull } from "drizzle-orm";
import {
  companies,
  qboSyncEvents,
  qboSyncQueue,
  qboWebhookEvents,
  customerCompanies,
  clientLocations,
  invoices,
} from "@shared/schema";
import { notDeletedClientFilter } from "./jobFilters";

// ============================================================================
// TYPES
// ============================================================================

export interface QboCompanyStatus {
  companyId: string;
  companyName: string;
  qboEnabled: boolean;
  qboEnvironment: string;
  qboRealmId: string | null;
  queueDepth: number;
  failedCount: number;
  lastSyncAt: string | null;
  lastSyncResult: string | null;
}

export interface AdminQboOverview {
  totalCompanies: number;
  enabledCompanies: number;
  connectedCompanies: number;
  totalQueueDepth: number;
  totalFailedJobs: number;
  companiesWithFailures: number;
  recentFailures: AdminQboFailure[];
  companies: QboCompanyStatus[];
}

export interface AdminQboFailure {
  id: string;
  companyId: string;
  companyName: string | null;
  eventType: string;
  entityType: string | null;
  entityId: string | null;
  errorMessage: string | null;
  errorCode: string | null;
  createdAt: Date;
}

export interface AdminQboRun {
  syncRunId: string;
  companyId: string;
  companyName: string | null;
  startedAt: string;
  completedAt: string;
  eventCount: number;
  successCount: number;
  failureCount: number;
  queueJobCount: number;
  triggeredBy: string | null;
}

export interface AdminQboRunDetail {
  syncRunId: string;
  companyId: string;
  companyName: string | null;
  stats: {
    totalEvents: number;
    successEvents: number;
    failureEvents: number;
    skippedEvents: number;
    totalQueueJobs: number;
    successQueueJobs: number;
    failedQueueJobs: number;
    runningQueueJobs: number;
  };
  events: Array<{
    id: string;
    eventType: string;
    result: string;
    entityType: string | null;
    entityId: string | null;
    qboEntityId: string | null;
    errorMessage: string | null;
    durationMs: number | null;
    createdAt: Date;
  }>;
  queueJobs: Array<{
    id: string;
    entityType: string;
    entityId: string;
    action: string;
    status: string;
    attempts: number;
    maxAttempts: number;
    lastError: string | null;
    qboEntityId: string | null;
    createdAt: Date;
  }>;
}

export interface AdminQboQueueJob {
  id: string;
  companyId: string;
  companyName: string | null;
  entityType: string;
  entityId: string;
  action: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  lastErrorCode: string | null;
  qboEntityId: string | null;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface AdminQboMappingSummary {
  companyId: string;
  companyName: string;
  qboEnabled: boolean;
  customerCompanies: {
    total: number;
    synced: number;
    pending: number;
    error: number;
  };
  clientLocations: {
    total: number;
    synced: number;
    pending: number;
    error: number;
  };
  invoices: {
    total: number;
    synced: number;
    pending: number;
    error: number;
  };
}

// ============================================================================
// REPOSITORY CLASS
// ============================================================================

class AdminQboRepository {
  /**
   * Get cross-tenant QBO overview
   */
  async getOverview(): Promise<AdminQboOverview> {
    // Get all companies with QBO settings
    const allCompanies = await db
      .select({
        id: companies.id,
        name: companies.name,
        qboEnabled: companies.qboEnabled,
        qboEnvironment: companies.qboEnvironment,
        qboRealmId: companies.qboRealmId,
      })
      .from(companies);

    // Get queue stats per company
    const queueStats = await db
      .select({
        companyId: qboSyncQueue.companyId,
        status: qboSyncQueue.status,
        count: sql<number>`count(*)::int`,
      })
      .from(qboSyncQueue)
      .groupBy(qboSyncQueue.companyId, qboSyncQueue.status);

    // Get last sync event per company
    const lastSyncEvents = await db
      .select({
        companyId: qboSyncEvents.companyId,
        result: qboSyncEvents.result,
        createdAt: sql<string>`MAX(${qboSyncEvents.createdAt})`,
      })
      .from(qboSyncEvents)
      .groupBy(qboSyncEvents.companyId, qboSyncEvents.result);

    // Get recent failures (last 20 across all tenants)
    const recentFailures = await db
      .select({
        id: qboSyncEvents.id,
        companyId: qboSyncEvents.companyId,
        companyName: companies.name,
        eventType: qboSyncEvents.eventType,
        customerCompanyId: qboSyncEvents.customerCompanyId,
        clientLocationId: qboSyncEvents.clientLocationId,
        invoiceId: qboSyncEvents.invoiceId,
        errorMessage: qboSyncEvents.errorMessage,
        errorCode: qboSyncEvents.errorCode,
        createdAt: qboSyncEvents.createdAt,
      })
      .from(qboSyncEvents)
      .leftJoin(companies, eq(qboSyncEvents.companyId, companies.id))
      .where(eq(qboSyncEvents.result, "FAILURE"))
      .orderBy(desc(qboSyncEvents.createdAt))
      .limit(20);

    // Build company status list
    const companyStatuses: QboCompanyStatus[] = allCompanies.map((company) => {
      const companyQueueStats = queueStats.filter((q) => q.companyId === company.id);
      const queuedCount = companyQueueStats.find((q) => q.status === "QUEUED")?.count || 0;
      const runningCount = companyQueueStats.find((q) => q.status === "RUNNING")?.count || 0;
      const queueDepth = queuedCount + runningCount;
      const failedCount = companyQueueStats.find((q) => q.status === "FAILED")?.count || 0;

      const lastSync = lastSyncEvents.find((e) => e.companyId === company.id);

      return {
        companyId: company.id,
        companyName: company.name,
        qboEnabled: company.qboEnabled,
        qboEnvironment: company.qboEnvironment,
        qboRealmId: company.qboRealmId,
        queueDepth,
        failedCount,
        lastSyncAt: lastSync?.createdAt || null,
        lastSyncResult: lastSync?.result || null,
      };
    });

    // Calculate totals
    const totalQueueDepth = companyStatuses.reduce((sum, c) => sum + c.queueDepth, 0);
    const totalFailedJobs = companyStatuses.reduce((sum, c) => sum + c.failedCount, 0);
    const companiesWithFailures = companyStatuses.filter((c) => c.failedCount > 0).length;

    return {
      totalCompanies: allCompanies.length,
      enabledCompanies: allCompanies.filter((c) => c.qboEnabled).length,
      connectedCompanies: allCompanies.filter((c) => c.qboRealmId).length,
      totalQueueDepth,
      totalFailedJobs,
      companiesWithFailures,
      recentFailures: recentFailures.map((f) => ({
        id: f.id,
        companyId: f.companyId,
        companyName: f.companyName,
        eventType: f.eventType,
        entityType: f.customerCompanyId
          ? "CUSTOMER_COMPANY"
          : f.clientLocationId
            ? "CLIENT_LOCATION"
            : f.invoiceId
              ? "INVOICE"
              : null,
        entityId: f.customerCompanyId || f.clientLocationId || f.invoiceId,
        errorMessage: f.errorMessage,
        errorCode: f.errorCode,
        createdAt: f.createdAt,
      })),
      companies: companyStatuses,
    };
  }

  /**
   * Get cross-tenant sync runs
   */
  async getRuns(options: { limit?: number } = {}): Promise<AdminQboRun[]> {
    const limit = options.limit || 50;

    const runs = await db
      .select({
        syncRunId: qboSyncEvents.syncRunId,
        companyId: qboSyncEvents.companyId,
        companyName: companies.name,
        triggeredBy: qboSyncEvents.triggeredBy,
        minCreatedAt: sql<string>`MIN(${qboSyncEvents.createdAt})`,
        maxCreatedAt: sql<string>`MAX(${qboSyncEvents.createdAt})`,
        eventCount: sql<number>`COUNT(*)::int`,
        successCount: sql<number>`COUNT(*) FILTER (WHERE ${qboSyncEvents.result} = 'SUCCESS')::int`,
        failureCount: sql<number>`COUNT(*) FILTER (WHERE ${qboSyncEvents.result} = 'FAILURE')::int`,
      })
      .from(qboSyncEvents)
      .leftJoin(companies, eq(qboSyncEvents.companyId, companies.id))
      .where(isNotNull(qboSyncEvents.syncRunId))
      .groupBy(qboSyncEvents.syncRunId, qboSyncEvents.companyId, companies.name, qboSyncEvents.triggeredBy)
      .orderBy(sql`MAX(${qboSyncEvents.createdAt}) DESC`)
      .limit(limit);

    // Get queue job counts per run
    const queueJobCounts = await db
      .select({
        syncRunId: qboSyncQueue.syncRunId,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(qboSyncQueue)
      .where(isNotNull(qboSyncQueue.syncRunId))
      .groupBy(qboSyncQueue.syncRunId);

    const queueJobMap = new Map(queueJobCounts.map((q) => [q.syncRunId, q.count]));

    return runs.map((run) => ({
      syncRunId: run.syncRunId!,
      companyId: run.companyId,
      companyName: run.companyName,
      startedAt: run.minCreatedAt,
      completedAt: run.maxCreatedAt,
      eventCount: run.eventCount,
      successCount: run.successCount,
      failureCount: run.failureCount,
      queueJobCount: queueJobMap.get(run.syncRunId!) || 0,
      triggeredBy: run.triggeredBy,
    }));
  }

  /**
   * Get details for a specific sync run
   */
  async getRunDetail(syncRunId: string): Promise<AdminQboRunDetail | null> {
    // Get events for this run
    const events = await db
      .select({
        id: qboSyncEvents.id,
        companyId: qboSyncEvents.companyId,
        eventType: qboSyncEvents.eventType,
        result: qboSyncEvents.result,
        customerCompanyId: qboSyncEvents.customerCompanyId,
        clientLocationId: qboSyncEvents.clientLocationId,
        invoiceId: qboSyncEvents.invoiceId,
        qboEntityId: qboSyncEvents.qboEntityId,
        errorMessage: qboSyncEvents.errorMessage,
        durationMs: qboSyncEvents.durationMs,
        createdAt: qboSyncEvents.createdAt,
      })
      .from(qboSyncEvents)
      .where(eq(qboSyncEvents.syncRunId, syncRunId))
      .orderBy(qboSyncEvents.createdAt);

    if (events.length === 0) {
      return null;
    }

    const companyId = events[0].companyId;

    // Get company name
    const [company] = await db
      .select({ name: companies.name })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);

    // Get queue jobs for this run
    const queueJobs = await db
      .select({
        id: qboSyncQueue.id,
        entityType: qboSyncQueue.entityType,
        entityId: qboSyncQueue.entityId,
        action: qboSyncQueue.action,
        status: qboSyncQueue.status,
        attempts: qboSyncQueue.attempts,
        maxAttempts: qboSyncQueue.maxAttempts,
        lastError: qboSyncQueue.lastError,
        qboEntityId: qboSyncQueue.qboEntityId,
        createdAt: qboSyncQueue.createdAt,
      })
      .from(qboSyncQueue)
      .where(eq(qboSyncQueue.syncRunId, syncRunId))
      .orderBy(qboSyncQueue.createdAt);

    // Calculate stats
    const stats = {
      totalEvents: events.length,
      successEvents: events.filter((e) => e.result === "SUCCESS").length,
      failureEvents: events.filter((e) => e.result === "FAILURE").length,
      skippedEvents: events.filter((e) => e.result === "SKIPPED").length,
      totalQueueJobs: queueJobs.length,
      successQueueJobs: queueJobs.filter((j) => j.status === "SUCCESS").length,
      failedQueueJobs: queueJobs.filter((j) => j.status === "FAILED").length,
      runningQueueJobs: queueJobs.filter((j) => j.status === "RUNNING").length,
    };

    return {
      syncRunId,
      companyId,
      companyName: company?.name || null,
      stats,
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        result: e.result,
        entityType: e.customerCompanyId
          ? "CUSTOMER_COMPANY"
          : e.clientLocationId
            ? "CLIENT_LOCATION"
            : e.invoiceId
              ? "INVOICE"
              : null,
        entityId: e.customerCompanyId || e.clientLocationId || e.invoiceId,
        qboEntityId: e.qboEntityId,
        errorMessage: e.errorMessage,
        durationMs: e.durationMs,
        createdAt: e.createdAt,
      })),
      queueJobs: queueJobs.map((j) => ({
        id: j.id,
        entityType: j.entityType,
        entityId: j.entityId,
        action: j.action,
        status: j.status,
        attempts: j.attempts,
        maxAttempts: j.maxAttempts,
        lastError: j.lastError,
        qboEntityId: j.qboEntityId,
        createdAt: j.createdAt,
      })),
    };
  }

  /**
   * Get cross-tenant queue jobs
   */
  async getQueueJobs(options: {
    status?: "failed" | "pending" | "all";
    companyId?: string;
    limit?: number;
  } = {}): Promise<AdminQboQueueJob[]> {
    const { status, companyId, limit = 50 } = options;

    const conditions = [];

    if (companyId) {
      conditions.push(eq(qboSyncQueue.companyId, companyId));
    }

    if (status === "failed") {
      conditions.push(eq(qboSyncQueue.status, "FAILED"));
    } else if (status === "pending") {
      conditions.push(or(eq(qboSyncQueue.status, "QUEUED"), eq(qboSyncQueue.status, "RUNNING")));
    }
    // "all" = no status filter

    const jobs = await db
      .select({
        id: qboSyncQueue.id,
        companyId: qboSyncQueue.companyId,
        companyName: companies.name,
        entityType: qboSyncQueue.entityType,
        entityId: qboSyncQueue.entityId,
        action: qboSyncQueue.action,
        status: qboSyncQueue.status,
        attempts: qboSyncQueue.attempts,
        maxAttempts: qboSyncQueue.maxAttempts,
        lastError: qboSyncQueue.lastError,
        lastErrorCode: qboSyncQueue.lastErrorCode,
        qboEntityId: qboSyncQueue.qboEntityId,
        nextRunAt: qboSyncQueue.nextRunAt,
        createdAt: qboSyncQueue.createdAt,
        updatedAt: qboSyncQueue.updatedAt,
      })
      .from(qboSyncQueue)
      .leftJoin(companies, eq(qboSyncQueue.companyId, companies.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(qboSyncQueue.createdAt))
      .limit(limit);

    return jobs;
  }

  /**
   * Reset a failed job to QUEUED for replay (admin-level, no companyId check)
   * Returns full job details including previous status for audit logging
   */
  async resetJobForReplay(jobId: string): Promise<{
    success: boolean;
    error?: string;
    job?: AdminQboQueueJob;
    previousStatus?: string;
  }> {
    // Get the job first
    const [job] = await db
      .select()
      .from(qboSyncQueue)
      .where(eq(qboSyncQueue.id, jobId))
      .limit(1);

    if (!job) {
      return { success: false, error: "Job not found" };
    }

    if (job.status === "RUNNING") {
      return { success: false, error: "Cannot replay a running job" };
    }

    if (job.status === "SUCCESS") {
      return { success: false, error: "Cannot replay a successful job" };
    }

    const previousStatus = job.status;

    // Reset the job
    await db
      .update(qboSyncQueue)
      .set({
        status: "QUEUED",
        nextRunAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(qboSyncQueue.id, jobId));

    // Return updated job
    const [company] = await db
      .select({ name: companies.name })
      .from(companies)
      .where(eq(companies.id, job.companyId))
      .limit(1);

    return {
      success: true,
      previousStatus,
      job: {
        ...job,
        companyName: company?.name || null,
        status: "QUEUED",
        nextRunAt: new Date(),
      },
    };
  }

  /**
   * Reset all failed jobs to QUEUED for replay
   * Returns affected job count and unique company IDs for audit logging
   */
  async resetAllFailedForReplay(companyId?: string): Promise<{
    success: boolean;
    count: number;
    affectedCompanyIds: string[];
  }> {
    const conditions = [eq(qboSyncQueue.status, "FAILED")];

    if (companyId) {
      conditions.push(eq(qboSyncQueue.companyId, companyId));
    }

    const result = await db
      .update(qboSyncQueue)
      .set({
        status: "QUEUED",
        nextRunAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(...conditions))
      .returning({ id: qboSyncQueue.id, companyId: qboSyncQueue.companyId });

    // Get unique company IDs for audit logging
    const affectedCompanyIds = Array.from(new Set(result.map((r) => r.companyId)));

    return { success: true, count: result.length, affectedCompanyIds };
  }

  /**
   * Get count of failed jobs (for confirmation dialog)
   */
  async getFailedJobsCount(companyId?: string): Promise<number> {
    const conditions = [eq(qboSyncQueue.status, "FAILED")];

    if (companyId) {
      conditions.push(eq(qboSyncQueue.companyId, companyId));
    }

    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(qboSyncQueue)
      .where(and(...conditions));

    return result?.count || 0;
  }

  /**
   * Get mapping summary per company
   */
  async getMappingSummary(): Promise<AdminQboMappingSummary[]> {
    // Get all companies
    const allCompanies = await db
      .select({
        id: companies.id,
        name: companies.name,
        qboEnabled: companies.qboEnabled,
      })
      .from(companies);

    // Get customer company sync stats per company
    const customerCompanyStats = await db
      .select({
        companyId: customerCompanies.companyId,
        status: customerCompanies.qboSyncStatus,
        count: sql<number>`count(*)::int`,
      })
      .from(customerCompanies)
      .groupBy(customerCompanies.companyId, customerCompanies.qboSyncStatus);

    // Get client location sync stats per company
    // ClientLocations uses qboCustomerId to track sync status (null = not synced, set = synced)
    const clientLocationStats = await db
      .select({
        companyId: clientLocations.companyId,
        status: sql<string>`CASE WHEN ${clientLocations.qboCustomerId} IS NOT NULL THEN 'SYNCED' ELSE 'NOT_SYNCED' END`,
        count: sql<number>`count(*)::int`,
      })
      .from(clientLocations)
      .where(notDeletedClientFilter())
      .groupBy(clientLocations.companyId, sql`CASE WHEN ${clientLocations.qboCustomerId} IS NOT NULL THEN 'SYNCED' ELSE 'NOT_SYNCED' END`);

    // Get invoice sync stats per company
    const invoiceStats = await db
      .select({
        companyId: invoices.companyId,
        status: invoices.qboSyncStatus,
        count: sql<number>`count(*)::int`,
      })
      .from(invoices)
      .groupBy(invoices.companyId, invoices.qboSyncStatus);

    // Helper to aggregate stats
    function aggregateStats(
      stats: Array<{ companyId: string; status: string | null; count: number }>,
      companyId: string
    ) {
      const companyStats = stats.filter((s) => s.companyId === companyId);
      return {
        total: companyStats.reduce((sum, s) => sum + s.count, 0),
        synced: companyStats.find((s) => s.status === "SYNCED")?.count || 0,
        pending:
          (companyStats.find((s) => s.status === "PENDING")?.count || 0) +
          (companyStats.find((s) => s.status === "NOT_SYNCED")?.count || 0),
        error: companyStats.find((s) => s.status === "ERROR")?.count || 0,
      };
    }

    return allCompanies.map((company) => ({
      companyId: company.id,
      companyName: company.name,
      qboEnabled: company.qboEnabled,
      customerCompanies: aggregateStats(customerCompanyStats, company.id),
      clientLocations: aggregateStats(clientLocationStats, company.id),
      invoices: aggregateStats(invoiceStats, company.id),
    }));
  }
}

export const adminQboRepository = new AdminQboRepository();
