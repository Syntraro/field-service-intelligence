/**
 * Dashboard Storage Repository
 *
 * Provides workflow summary counts for the Dashboard workflow strip.
 *
 * NORMALIZED JOB STATUS MODEL (4 values only):
 * - "open"      - Active job that can be worked on
 * - "completed" - Work finished (may need invoicing)
 * - "invoiced"  - Invoice created (locked)
 * - "archived"  - Historical archive
 *
 * WORKFLOW SUB-STATUS (openSubStatus, only when status = 'open'):
 * - null         - Default state
 * - in_progress  - Work actively being performed
 * - on_hold      - Job is blocked (requires holdReason)
 * - on_route     - Technician traveling to job
 * - needs_review - Needs supervisor review
 *
 * ASSUMPTIONS:
 * - "completed" status means job work is done, may need invoicing
 * - No quotes table exists in the schema - returns 0 counts
 * - Invoice "balance" field represents outstanding amount (total - amountPaid)
 */

import { db } from "../db";
import { jobs, invoices, clientLocations as clients, customerCompanies } from "@shared/schema";
import { eq, and, isNull, or, sql, lt, asc } from "drizzle-orm";
import { BaseRepository } from "./base";
import { TERMINAL_STATUSES } from "../statusRules";

// Normalized status constants
// "completed" means work is finished and may need invoicing
const NEEDS_INVOICING_STATUS = "completed";

// Unpaid invoice statuses that count as "outstanding"
// NOTE: "sent" is LEGACY - new invoices use "awaiting_payment"
const UNPAID_INVOICE_STATUSES = ["awaiting_payment", "sent", "partial_paid"];

export interface WorkflowSummary {
  quotes: {
    approvedCount: number;
    draftCount: number;
  };
  jobs: {
    requiresInvoicingCount: number;
    activeCount: number;
    onHoldCount: number; // Renamed from actionRequiredCount
  };
  invoices: {
    outstandingCount: number;
    pastDueCount: number;
  };
  fourth: null;
}

class DashboardRepository extends BaseRepository {
  /**
   * Get workflow summary counts for a company.
   * Used to power the Dashboard workflow strip UI.
   */
  async getWorkflowSummary(companyId: string): Promise<WorkflowSummary> {
    this.assertCompanyId(companyId);

    // Run all count queries in parallel for efficiency
    const [jobCounts, invoiceCounts] = await Promise.all([
      this.getJobCounts(companyId),
      this.getInvoiceCounts(companyId),
    ]);

    return {
      quotes: {
        // No quotes table exists - return 0 counts
        approvedCount: 0,
        draftCount: 0,
      },
      jobs: jobCounts,
      invoices: invoiceCounts,
      fourth: null,
    };
  }

  /**
   * Get job counts by category.
   * Using normalized 4-status model: open, completed, invoiced, archived
   */
  private async getJobCounts(companyId: string): Promise<{
    requiresInvoicingCount: number;
    activeCount: number;
    onHoldCount: number;
  }> {
    const terminalList = TERMINAL_STATUSES.map(s => `'${s}'`).join(", ");

    const result = await db
      .select({
        // Count jobs needing invoicing (status = 'completed')
        requiresInvoicingCount: sql<number>`
          COUNT(*) FILTER (WHERE ${jobs.status} = ${NEEDS_INVOICING_STATUS})
        `.as("requires_invoicing_count"),
        // Count active jobs (status = 'open')
        activeCount: sql<number>`
          COUNT(*) FILTER (WHERE ${jobs.status} = 'open')
        `.as("active_count"),
        // Count jobs on hold (status = 'open' AND openSubStatus = 'on_hold')
        onHoldCount: sql<number>`
          COUNT(*) FILTER (WHERE ${jobs.status} = 'open' AND ${jobs.openSubStatus} = 'on_hold')
        `.as("on_hold_count"),
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.companyId, companyId),
          isNull(jobs.deletedAt),
          eq(jobs.isActive, true)
        )
      );

    const counts = result[0] || {
      requiresInvoicingCount: 0,
      activeCount: 0,
      onHoldCount: 0,
    };

    return {
      requiresInvoicingCount: Number(counts.requiresInvoicingCount) || 0,
      activeCount: Number(counts.activeCount) || 0,
      onHoldCount: Number(counts.onHoldCount) || 0,
    };
  }

  /**
   * Get invoice counts by category.
   * Outstanding = unpaid invoices with balance > 0 (status: awaiting_payment, sent, partial_paid)
   * Past Due = outstanding invoices where dueDate < today
   */
  private async getInvoiceCounts(companyId: string): Promise<{
    outstandingCount: number;
    pastDueCount: number;
  }> {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const result = await db
      .select({
        // Count unpaid invoices with balance > 0
        outstandingCount: sql<number>`
          COUNT(*) FILTER (
            WHERE CAST(${invoices.balance} AS NUMERIC) > 0
            AND ${invoices.status} IN ('awaiting_payment', 'sent', 'partial_paid')
          )
        `.as("outstanding_count"),
        // Count past due: unpaid with balance > 0 AND dueDate < today
        pastDueCount: sql<number>`
          COUNT(*) FILTER (
            WHERE ${invoices.dueDate} < ${today}
            AND CAST(${invoices.balance} AS NUMERIC) > 0
            AND ${invoices.status} IN ('awaiting_payment', 'sent', 'partial_paid')
          )
        `.as("past_due_count"),
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          isNull(invoices.deletedAt),
          // Legacy compatibility: treat NULL isActive as active
          or(eq(invoices.isActive, true), isNull(invoices.isActive))
        )
      );

    const counts = result[0] || {
      outstandingCount: 0,
      pastDueCount: 0,
    };

    return {
      outstandingCount: Number(counts.outstandingCount) || 0,
      pastDueCount: Number(counts.pastDueCount) || 0,
    };
  }

  /**
   * Get jobs needing attention for dashboard.
   * Normalized 4-status model:
   * Phase 2 Step 5: Overdue = effectiveEnd < now (not scheduledStart)
   * - Overdue jobs: effectiveEnd < now AND status = 'open'
   * - On hold jobs: status = 'open' AND openSubStatus = 'on_hold'
   * - Awaiting invoicing: status = 'completed'
   * Sort: overdue first (oldest), then on_hold, then completed
   */
  async getNeedsAttentionJobs(companyId: string, todayDate: string, limit: number = 5) {
    this.assertCompanyId(companyId);

    const todayStart = new Date(`${todayDate}T00:00:00.000Z`);

    // Query overdue jobs (effectiveEnd < now, still open)
    // Phase 2 Step 5: effectiveEnd priority: scheduled_end > scheduled_start + duration_minutes > scheduled_start
    const overdueJobs = await db
      .select({
        id: jobs.id,
        jobNumber: jobs.jobNumber,
        summary: jobs.summary,
        status: jobs.status,
        scheduledStart: jobs.scheduledStart,
        locationName: clients.location,
        locationCompanyName: sql<string>`COALESCE(${customerCompanies.name}, ${clients.companyName})`,
        location: {
          companyName: clients.companyName,
          location: clients.location,
        },
        attentionType: sql<string>`'overdue'`.as('attention_type'),
      })
      .from(jobs)
      .leftJoin(clients, eq(jobs.locationId, clients.id))
      .leftJoin(customerCompanies, eq(clients.parentCompanyId, customerCompanies.id))
      .where(
        and(
          eq(jobs.companyId, companyId),
          isNull(jobs.deletedAt),
          eq(jobs.isActive, true),
          // Must be scheduled
          sql`${jobs.scheduledStart} IS NOT NULL`,
          // effectiveEnd < now (job should have finished)
          sql`CASE
            WHEN ${jobs.scheduledEnd} IS NOT NULL THEN ${jobs.scheduledEnd}
            WHEN ${jobs.durationMinutes} IS NOT NULL THEN ${jobs.scheduledStart} + (${jobs.durationMinutes} || ' minutes')::interval
            ELSE ${jobs.scheduledStart}
          END < ${todayStart}`,
          // Only open status jobs (normalized model)
          eq(jobs.status, "open")
        )
      )
      .orderBy(asc(jobs.scheduledStart));

    // Query attention jobs (on_hold sub-status or completed status)
    const attentionJobs = await db
      .select({
        id: jobs.id,
        jobNumber: jobs.jobNumber,
        summary: jobs.summary,
        status: jobs.status,
        scheduledStart: jobs.scheduledStart,
        locationName: clients.location,
        locationCompanyName: sql<string>`COALESCE(${customerCompanies.name}, ${clients.companyName})`,
        location: {
          companyName: clients.companyName,
          location: clients.location,
        },
        attentionType: sql<string>`
          CASE
            WHEN ${jobs.openSubStatus} = 'on_hold' THEN 'on_hold'
            WHEN ${jobs.status} = 'completed' THEN 'requires_invoicing'
            ELSE 'other'
          END
        `.as('attention_type'),
      })
      .from(jobs)
      .leftJoin(clients, eq(jobs.locationId, clients.id))
      .leftJoin(customerCompanies, eq(clients.parentCompanyId, customerCompanies.id))
      .where(
        and(
          eq(jobs.companyId, companyId),
          isNull(jobs.deletedAt),
          eq(jobs.isActive, true),
          // Attention: on_hold sub-status OR completed status (needs invoicing)
          or(
            and(eq(jobs.status, "open"), eq(jobs.openSubStatus, "on_hold")),
            eq(jobs.status, "completed")
          )
        )
      )
      .orderBy(
        // completed (needs invoicing) first (0), then on_hold (1)
        sql`CASE WHEN ${jobs.status} = 'completed' THEN 0 ELSE 1 END`,
        asc(jobs.scheduledStart)
      );

    // Combine: overdue first, then attention jobs, limited
    // Dedupe by job id (in case a job appears in both)
    const seenIds = new Set<string>();
    const combined: typeof overdueJobs = [];

    for (const job of overdueJobs) {
      if (!seenIds.has(job.id)) {
        seenIds.add(job.id);
        combined.push(job);
      }
    }

    for (const job of attentionJobs) {
      if (!seenIds.has(job.id)) {
        seenIds.add(job.id);
        combined.push(job);
      }
    }

    return combined.slice(0, limit);
  }
}

export const dashboardRepository = new DashboardRepository();
