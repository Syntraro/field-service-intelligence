/**
 * Dashboard Storage Repository
 *
 * Provides workflow summary counts for the Dashboard workflow strip.
 *
 * JOB STATUS DEFINITIONS:
 * - requiresInvoicingStatuses = ["requires_invoicing", "completed"]
 *   "requires_invoicing" is the canonical status for jobs awaiting invoice creation
 *   "completed" is LEGACY - kept for backward compatibility with existing data
 * - waitingPartsStatus = "needs_parts"
 *   Job waiting for parts before work can continue
 * - closedStatuses = ["archived", "cancelled", "closed", "invoiced", "requires_invoicing", "completed"]
 *   All terminal/closed states (not counted as "active")
 *
 * ASSUMPTIONS:
 * - Both "requires_invoicing" and legacy "completed" mean job needs invoice
 * - No quotes table exists in the schema - returns 0 counts
 * - Invoice "balance" field represents outstanding amount (total - amountPaid)
 */

import { db } from "../db";
import { jobs, invoices } from "@shared/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { BaseRepository } from "./base";

// Status constants
// NOTE: "completed" is LEGACY - new jobs use "requires_invoicing"
const REQUIRES_INVOICING_STATUSES = ["requires_invoicing", "completed"];
const WAITING_PARTS_STATUS = "needs_parts";
// All closed/terminal statuses (not counted as "active")
const CLOSED_STATUSES = ["archived", "cancelled", "closed", "invoiced", "requires_invoicing", "completed"];

export interface WorkflowSummary {
  quotes: {
    approvedCount: number;
    draftCount: number;
  };
  jobs: {
    requiresInvoicingCount: number;
    activeCount: number;
    actionRequiredCount: number;
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
   */
  private async getJobCounts(companyId: string): Promise<{
    requiresInvoicingCount: number;
    activeCount: number;
    actionRequiredCount: number;
  }> {
    const result = await db
      .select({
        // Count jobs needing invoicing (includes legacy "completed" + new "requires_invoicing")
        requiresInvoicingCount: sql<number>`
          COUNT(*) FILTER (WHERE ${jobs.status} IN (${sql.join(REQUIRES_INVOICING_STATUSES.map(s => sql`${s}`), sql`, `)}))
        `.as("requires_invoicing_count"),
        // Count active jobs (not in any closed/terminal status)
        activeCount: sql<number>`
          COUNT(*) FILTER (WHERE ${jobs.status} NOT IN (${sql.join(CLOSED_STATUSES.map(s => sql`${s}`), sql`, `)}))
        `.as("active_count"),
        // Count jobs needing action (waiting for parts)
        actionRequiredCount: sql<number>`
          COUNT(*) FILTER (WHERE ${jobs.status} = ${WAITING_PARTS_STATUS})
        `.as("action_required_count"),
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.companyId, companyId),
          isNull(jobs.deletedAt)
        )
      );

    const counts = result[0] || {
      requiresInvoicingCount: 0,
      activeCount: 0,
      actionRequiredCount: 0,
    };

    return {
      requiresInvoicingCount: Number(counts.requiresInvoicingCount) || 0,
      activeCount: Number(counts.activeCount) || 0,
      actionRequiredCount: Number(counts.actionRequiredCount) || 0,
    };
  }

  /**
   * Get invoice counts by category.
   */
  private async getInvoiceCounts(companyId: string): Promise<{
    outstandingCount: number;
    pastDueCount: number;
  }> {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const result = await db
      .select({
        outstandingCount: sql<number>`
          COUNT(*) FILTER (WHERE CAST(${invoices.balance} AS NUMERIC) > 0)
        `.as("outstanding_count"),
        pastDueCount: sql<number>`
          COUNT(*) FILTER (
            WHERE ${invoices.dueDate} < ${today}
            AND CAST(${invoices.balance} AS NUMERIC) > 0
          )
        `.as("past_due_count"),
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          isNull(invoices.deletedAt)
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
}

export const dashboardRepository = new DashboardRepository();
