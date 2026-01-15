import { Router, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { jobs, jobStatusEvents } from "@shared/schema";
import { eq, and, gte, sql, desc } from "drizzle-orm";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";
import { reportsRepository } from "../storage/reports";

const router = Router();

/**
 * Query params schema for action-required-kpis
 */
const kpiQuerySchema = z.object({
  days: z.coerce.number().min(1).max(365).default(30),
});

/**
 * GET /api/reports/action-required-kpis
 * Returns Action Required KPIs for the current state and historical trends
 */
router.get("/action-required-kpis", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const { days } = kpiQuerySchema.parse(req.query);

  const now = new Date();
  const windowStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  // ==========================================
  // PART A: Current Action Required Jobs
  // ==========================================
  const currentJobs = await db
    .select({
      id: jobs.id,
      actionRequiredAt: jobs.actionRequiredAt,
      actionRequiredEscalatedAt: jobs.actionRequiredEscalatedAt,
      actionRequiredReason: jobs.actionRequiredReason,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.companyId, companyId),
        eq(jobs.status, "action_required")
      )
    );

  // Compute current metrics
  let total = 0;
  let slaBreached24h = 0;
  let escalated = 0;
  const buckets = { lt24h: 0, h24to72: 0, gte72h: 0 };
  const reasonCounts: Record<string, number> = {};

  for (const job of currentJobs) {
    total++;

    if (job.actionRequiredEscalatedAt) {
      escalated++;
    }

    if (job.actionRequiredAt) {
      const ageMs = now.getTime() - new Date(job.actionRequiredAt).getTime();
      const ageHours = ageMs / (1000 * 60 * 60);

      if (ageHours >= 24) {
        slaBreached24h++;
      }

      if (ageHours < 24) {
        buckets.lt24h++;
      } else if (ageHours < 72) {
        buckets.h24to72++;
      } else {
        buckets.gte72h++;
      }
    }

    // Count by reason
    const reason = job.actionRequiredReason || "unknown";
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  }

  // ==========================================
  // PART B: Historical Metrics (last N days)
  // ==========================================
  // Find all events where jobs entered action_required in the window
  const entryEvents = await db
    .select({
      jobId: jobStatusEvents.jobId,
      changedAt: jobStatusEvents.changedAt,
      meta: jobStatusEvents.meta,
    })
    .from(jobStatusEvents)
    .where(
      and(
        eq(jobStatusEvents.companyId, companyId),
        eq(jobStatusEvents.toStatus, "action_required"),
        gte(jobStatusEvents.changedAt, windowStart)
      )
    )
    .orderBy(jobStatusEvents.changedAt);

  // Find all events where jobs exited action_required
  const exitEvents = await db
    .select({
      jobId: jobStatusEvents.jobId,
      changedAt: jobStatusEvents.changedAt,
      fromStatus: jobStatusEvents.fromStatus,
    })
    .from(jobStatusEvents)
    .where(
      and(
        eq(jobStatusEvents.companyId, companyId),
        eq(jobStatusEvents.fromStatus, "action_required")
      )
    )
    .orderBy(jobStatusEvents.changedAt);

  // Build a map of exit events by jobId for quick lookup
  const exitsByJob = new Map<string, Array<{ changedAt: Date }>>();
  for (const exit of exitEvents) {
    if (!exitsByJob.has(exit.jobId)) {
      exitsByJob.set(exit.jobId, []);
    }
    exitsByJob.get(exit.jobId)!.push({ changedAt: exit.changedAt });
  }

  // Calculate durations for completed action_required intervals
  const durations: Array<{ hours: number; reason: string }> = [];

  for (const entry of entryEvents) {
    const exits = exitsByJob.get(entry.jobId) || [];
    // Find the first exit after this entry
    const exitAfterEntry = exits.find(e => e.changedAt > entry.changedAt);

    if (exitAfterEntry) {
      const durationMs = exitAfterEntry.changedAt.getTime() - entry.changedAt.getTime();
      const durationHours = durationMs / (1000 * 60 * 60);
      const reason = (entry.meta as any)?.reason || "unknown";
      durations.push({ hours: durationHours, reason });
    }
  }

  // Compute aggregate stats
  const allHours = durations.map(d => d.hours).sort((a, b) => a - b);
  const averageHours = allHours.length > 0
    ? allHours.reduce((sum, h) => sum + h, 0) / allHours.length
    : 0;
  const medianHours = allHours.length > 0
    ? allHours[Math.floor(allHours.length / 2)]
    : 0;

  // Group by reason
  const byReasonMap = new Map<string, number[]>();
  for (const d of durations) {
    if (!byReasonMap.has(d.reason)) {
      byReasonMap.set(d.reason, []);
    }
    byReasonMap.get(d.reason)!.push(d.hours);
  }

  const byReason = Array.from(byReasonMap.entries()).map(([reason, hours]) => {
    const sorted = hours.sort((a, b) => a - b);
    const avg = sorted.reduce((sum, h) => sum + h, 0) / sorted.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    return {
      reason,
      count: hours.length,
      avgHours: Math.round(avg * 10) / 10,
      medianHours: Math.round(median * 10) / 10,
    };
  }).sort((a, b) => b.count - a.count);

  // Current reasons breakdown
  const currentByReason = Object.entries(reasonCounts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  res.json({
    current: {
      total,
      slaBreached24h,
      escalated,
      buckets,
      byReason: currentByReason,
    },
    history: {
      windowDays: days,
      resolvedCount: durations.length,
      averageHoursInActionRequired: Math.round(averageHours * 10) / 10,
      medianHoursInActionRequired: Math.round(medianHours * 10) / 10,
      byReason,
    },
  });
}));

/**
 * GET /api/reports/ar-aging
 * Returns Accounts Receivable Aging report
 * Includes invoices with status 'sent' or 'partial_paid' and balance > 0
 */
router.get("/ar-aging", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const report = await reportsRepository.getARAgingReport(companyId);
  res.json(report);
}));

export default router;
