/**
 * Team performance metrics aggregator.
 *
 * Backs GET /api/team/metrics (team-wide) and
 * GET /api/team/:userId/performance (per-member).
 *
 * Revenue attribution algorithm (per spec):
 *   1. Find completed jobs in the period via job_status_events.
 *   2. Join to invoices (non-draft, non-voided) for job revenue.
 *   3. For each job: use time_entries minutes per user to allocate
 *      revenue proportionally. Fallback: if no time entries, split
 *      evenly across job_visits.assignedTechnicianIds.
 *
 * Utilization:
 *   scheduledHours = sum of working_hours per day × (periodDays / 7)
 *   utilizationPct = hoursWorked / scheduledHours × 100, capped at 100.
 *   If no working_hours record: scheduledHours uses 40 hr/week default.
 */

import { and, eq, gte, inArray, isNotNull, lt, ne } from "drizzle-orm";
import { db } from "../db";
import {
  invoices,
  jobStatusEvents,
  jobVisits,
  leads,
  quotes,
  timeEntries,
  workingHours,
} from "@shared/schema";

const DEFAULT_WEEKLY_HOURS = 40;

export type MetricsPeriod = "last_30_days" | "last_90_days" | "last_12_months";

export interface TeamMemberMetrics {
  userId: string;
  hoursWorked: number;
  scheduledHoursInPeriod: number;
  utilizationPct: number | null;
  jobsCompleted: number;
  allocatedRevenue: number;
  avgRevPerHour: number | null;
  leadsGenerated: number;
  leadRevenue: number;
}

function periodWindow(period: MetricsPeriod, now: Date): { from: Date; to: Date } {
  const days = period === "last_30_days" ? 30 : period === "last_90_days" ? 90 : 365;
  return {
    from: new Date(now.getTime() - days * 86_400_000),
    to: now,
  };
}

function parseTimeMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function weeklyHoursFromRows(
  rows: Array<{ isWorking: boolean; startTime: string | null; endTime: string | null }>,
): number {
  if (rows.length === 0) return DEFAULT_WEEKLY_HOURS;
  let total = 0;
  for (const r of rows) {
    if (!r.isWorking || !r.startTime || !r.endTime) continue;
    const mins = parseTimeMinutes(r.endTime) - parseTimeMinutes(r.startTime);
    if (mins > 0) total += mins / 60;
  }
  return total > 0 ? total : DEFAULT_WEEKLY_HOURS;
}

export async function getTeamMetrics(
  companyId: string,
  period: MetricsPeriod,
  now: Date = new Date(),
): Promise<TeamMemberMetrics[]> {
  const { from, to } = periodWindow(period, now);
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  const weeks = days / 7;

  // 1. Hours worked per user in period
  const hoursRows = await db
    .select({
      userId: timeEntries.technicianId,
      totalMinutes: timeEntries.durationMinutes,
    })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.companyId, companyId),
        isNotNull(timeEntries.durationMinutes),
        isNotNull(timeEntries.endAt),
        gte(timeEntries.startAt, from),
        lt(timeEntries.startAt, to),
      ),
    );

  const hoursMap: Record<string, number> = {};
  for (const r of hoursRows) {
    if (!r.userId || r.totalMinutes == null) continue;
    hoursMap[r.userId] = (hoursMap[r.userId] ?? 0) + r.totalMinutes;
  }
  // Convert minutes to hours
  for (const uid of Object.keys(hoursMap)) {
    hoursMap[uid] = Math.round((hoursMap[uid] / 60) * 100) / 100;
  }

  // 2. Jobs completed per user via job_status_events.changedBy
  const completedJobRows = await db
    .select({
      userId: jobStatusEvents.changedBy,
      jobId: jobStatusEvents.jobId,
    })
    .from(jobStatusEvents)
    .where(
      and(
        eq(jobStatusEvents.companyId, companyId),
        eq(jobStatusEvents.toStatus, "completed"),
        isNotNull(jobStatusEvents.changedBy),
        gte(jobStatusEvents.changedAt, from),
        lt(jobStatusEvents.changedAt, to),
      ),
    );

  const jobsCompletedMap: Record<string, number> = {};
  const allCompletedJobIds: string[] = [];
  const jobByUser: Record<string, string[]> = {}; // userId → jobIds

  for (const r of completedJobRows) {
    if (!r.userId || !r.jobId) continue;
    jobsCompletedMap[r.userId] = (jobsCompletedMap[r.userId] ?? 0) + 1;
    if (!jobByUser[r.userId]) jobByUser[r.userId] = [];
    jobByUser[r.userId].push(r.jobId);
    allCompletedJobIds.push(r.jobId);
  }

  // Deduplicate job IDs
  const uniqueJobIds = Array.from(new Set(allCompletedJobIds));

  // 3. Revenue per completed job
  const jobRevenueMap: Record<string, number> = {};

  if (uniqueJobIds.length > 0) {
    const revenueRows = await db
      .select({
        jobId: invoices.jobId,
        total: invoices.total,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          isNotNull(invoices.jobId),
          inArray(invoices.jobId, uniqueJobIds),
          ne(invoices.status, "draft"),
          ne(invoices.status, "voided"),
        ),
      );

    for (const r of revenueRows) {
      if (!r.jobId || r.total == null) continue;
      const amt = parseFloat(r.total.toString());
      jobRevenueMap[r.jobId] = (jobRevenueMap[r.jobId] ?? 0) + amt;
    }

    // 4. Time entries per (user, job) for proportional revenue allocation
    const jobTimeRows = await db
      .select({
        userId: timeEntries.technicianId,
        jobId: timeEntries.jobId,
        minutes: timeEntries.durationMinutes,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          isNotNull(timeEntries.jobId),
          isNotNull(timeEntries.durationMinutes),
          inArray(timeEntries.jobId, uniqueJobIds),
        ),
      );

    // jobId → userId → minutes
    const jobUserMinutes: Record<string, Record<string, number>> = {};
    for (const r of jobTimeRows) {
      if (!r.jobId || !r.userId || r.minutes == null) continue;
      if (!jobUserMinutes[r.jobId]) jobUserMinutes[r.jobId] = {};
      jobUserMinutes[r.jobId][r.userId] = (jobUserMinutes[r.jobId][r.userId] ?? 0) + r.minutes;
    }

    // 5. Fallback: assignedTechnicianIds from job_visits
    const visitRows = await db
      .select({
        jobId: jobVisits.jobId,
        assigned: jobVisits.assignedTechnicianIds,
      })
      .from(jobVisits)
      .where(
        and(
          eq(jobVisits.companyId, companyId),
          inArray(jobVisits.jobId, uniqueJobIds),
        ),
      );

    // jobId → Set of user IDs
    const jobVisitUsers: Record<string, string[]> = {};
    for (const r of visitRows) {
      if (!r.jobId || !r.assigned) continue;
      const assigned = r.assigned as string[];
      if (!jobVisitUsers[r.jobId]) jobVisitUsers[r.jobId] = [];
      for (const uid of assigned) {
        if (uid && !jobVisitUsers[r.jobId].includes(uid)) {
          jobVisitUsers[r.jobId].push(uid);
        }
      }
    }

    // 6. Allocate revenue per user
    const allocatedRevenue: Record<string, number> = {};

    for (const jobId of uniqueJobIds) {
      const revenue = jobRevenueMap[jobId] ?? 0;
      if (revenue === 0) continue;

      const userMinutes = jobUserMinutes[jobId];
      if (userMinutes && Object.keys(userMinutes).length > 0) {
        const total = Object.values(userMinutes).reduce((a, b) => a + b, 0);
        if (total > 0) {
          for (const uid of Object.keys(userMinutes)) {
            const share = revenue * ((userMinutes[uid] ?? 0) / total);
            allocatedRevenue[uid] = Math.round(((allocatedRevenue[uid] ?? 0) + share) * 100) / 100;
          }
          continue;
        }
      }

      // Fallback: split evenly across assigned techs
      const visitTechs = jobVisitUsers[jobId] ?? [];
      if (visitTechs.length > 0) {
        const share = revenue / visitTechs.length;
        for (const uid of visitTechs) {
          allocatedRevenue[uid] = Math.round(((allocatedRevenue[uid] ?? 0) + share) * 100) / 100;
        }
      }
    }

    // Persist allocated revenue into jobRevenueMap under a namespaced key
    // so we can retrieve it below without a separate Map
    for (const uid of Object.keys(allocatedRevenue)) {
      jobRevenueMap[`_alloc_${uid}`] = allocatedRevenue[uid] ?? 0;
    }
  }

  // 7. Leads generated per user in period
  const leadsRows = await db
    .select({
      userId: leads.originTechnicianId,
      leadId: leads.id,
    })
    .from(leads)
    .where(
      and(
        eq(leads.companyId, companyId),
        isNotNull(leads.originTechnicianId),
        gte(leads.createdAt, from),
        lt(leads.createdAt, to),
      ),
    );

  const leadsMap: Record<string, number> = {};
  for (const r of leadsRows) {
    if (!r.userId) continue;
    leadsMap[r.userId] = (leadsMap[r.userId] ?? 0) + 1;
  }

  // 8. Lead revenue: leads → convertedQuoteId → quotes → convertedToJobId → invoices
  const leadRevenueRows = await db
    .select({
      userId: leads.originTechnicianId,
      total: invoices.total,
    })
    .from(leads)
    .innerJoin(quotes, eq(quotes.id, leads.convertedQuoteId))
    .innerJoin(invoices, eq(invoices.jobId, quotes.convertedToJobId))
    .where(
      and(
        eq(leads.companyId, companyId),
        isNotNull(leads.originTechnicianId),
        isNotNull(leads.convertedQuoteId),
        isNotNull(quotes.convertedToJobId),
        ne(invoices.status, "draft"),
        ne(invoices.status, "voided"),
      ),
    );

  const leadRevenueMap: Record<string, number> = {};
  for (const r of leadRevenueRows) {
    if (!r.userId || r.total == null) continue;
    const amt = parseFloat(r.total.toString());
    leadRevenueMap[r.userId] = (leadRevenueMap[r.userId] ?? 0) + amt;
  }

  // 9. Working hours for utilization
  const allUserIds = Array.from(
    new Set([
      ...Object.keys(hoursMap),
      ...Object.keys(jobsCompletedMap),
      ...Object.keys(leadsMap),
    ]),
  );

  const workingHoursRows = await db
    .select({
      userId: workingHours.userId,
      dayOfWeek: workingHours.dayOfWeek,
      startTime: workingHours.startTime,
      endTime: workingHours.endTime,
      isWorking: workingHours.isWorking,
    })
    .from(workingHours)
    .where(inArray(workingHours.userId, allUserIds));

  const workingHoursByUser: Record<
    string,
    Array<{ isWorking: boolean; startTime: string | null; endTime: string | null }>
  > = {};
  for (const r of workingHoursRows) {
    if (!workingHoursByUser[r.userId]) workingHoursByUser[r.userId] = [];
    workingHoursByUser[r.userId].push(r);
  }

  // 10. Assemble results
  const results: TeamMemberMetrics[] = [];

  for (const userId of allUserIds) {
    const hoursWorked = hoursMap[userId] ?? 0;
    const jobsCompleted = jobsCompletedMap[userId] ?? 0;
    const allocatedRev = jobRevenueMap[`_alloc_${userId}`] ?? 0;
    const leadsGenerated = leadsMap[userId] ?? 0;
    const leadRevenue = Math.round((leadRevenueMap[userId] ?? 0) * 100) / 100;

    const whRows = workingHoursByUser[userId] ?? [];
    const weeklyHours = weeklyHoursFromRows(whRows);
    const scheduledHoursInPeriod = Math.round(weeklyHours * weeks * 100) / 100;

    const utilizationPct =
      scheduledHoursInPeriod > 0
        ? Math.min(100, Math.round((hoursWorked / scheduledHoursInPeriod) * 100 * 10) / 10)
        : null;

    const avgRevPerHour =
      hoursWorked > 0 ? Math.round((allocatedRev / hoursWorked) * 100) / 100 : null;

    results.push({
      userId,
      hoursWorked,
      scheduledHoursInPeriod,
      utilizationPct,
      jobsCompleted,
      allocatedRevenue: allocatedRev,
      avgRevPerHour,
      leadsGenerated,
      leadRevenue,
    });
  }

  return results;
}

export interface LeadConversionMetrics {
  leadsGenerated: number;
  leadsConvertedToQuote: number;
  leadsConvertedToJob: number;
  leadRevenue: number;
  /** Ratio of leads that became a quote. Null when leadsGenerated = 0. */
  quoteConversionRate: number | null;
  /** Ratio of leads that became a job. Null when leadsGenerated = 0. */
  jobConversionRate: number | null;
  /** True when at least one lead is fully traceable through to an invoice. */
  hasTracedRevenue: boolean;
}

/** Per-member lead conversion breakdown, any time (no period filter on
 *  leads themselves — conversion is an outcome event, not a creation event). */
export async function getLeadConversionMetrics(
  companyId: string,
  userId: string,
): Promise<LeadConversionMetrics> {
  // All leads originated by this user
  const allLeads = await db
    .select({
      id: leads.id,
      convertedQuoteId: leads.convertedQuoteId,
    })
    .from(leads)
    .where(
      and(
        eq(leads.companyId, companyId),
        eq(leads.originTechnicianId, userId),
      ),
    );

  const leadsGenerated = allLeads.length;
  const convertedToQuote = allLeads.filter((l) => l.convertedQuoteId != null);
  const leadsConvertedToQuote = convertedToQuote.length;

  // Which of those quotes also converted to a job?
  const quoteIds = convertedToQuote
    .map((l) => l.convertedQuoteId)
    .filter((id): id is string => id != null);

  let leadsConvertedToJob = 0;
  let leadRevenue = 0;
  let hasTracedRevenue = false;

  if (quoteIds.length > 0) {
    const quotesWithJob = await db
      .select({ id: quotes.id, convertedToJobId: quotes.convertedToJobId })
      .from(quotes)
      .where(
        and(
          eq(quotes.companyId, companyId),
          inArray(quotes.id, quoteIds),
          isNotNull(quotes.convertedToJobId),
        ),
      );

    leadsConvertedToJob = quotesWithJob.length;

    const jobIds = quotesWithJob
      .map((q) => q.convertedToJobId)
      .filter((id): id is string => id != null);

    if (jobIds.length > 0) {
      const revRows = await db
        .select({ total: invoices.total })
        .from(invoices)
        .where(
          and(
            eq(invoices.companyId, companyId),
            inArray(invoices.jobId, jobIds),
            ne(invoices.status, "draft"),
            ne(invoices.status, "voided"),
          ),
        );

      for (const r of revRows) {
        if (r.total != null) {
          leadRevenue += parseFloat(r.total.toString());
          hasTracedRevenue = true;
        }
      }
      leadRevenue = Math.round(leadRevenue * 100) / 100;
    }
  }

  return {
    leadsGenerated,
    leadsConvertedToQuote,
    leadsConvertedToJob,
    leadRevenue,
    quoteConversionRate:
      leadsGenerated > 0
        ? Math.round((leadsConvertedToQuote / leadsGenerated) * 1000) / 10
        : null,
    jobConversionRate:
      leadsGenerated > 0
        ? Math.round((leadsConvertedToJob / leadsGenerated) * 1000) / 10
        : null,
    hasTracedRevenue,
  };
}

export interface MonthlyPerformancePoint {
  month: string; // "YYYY-MM"
  hoursWorked: number;
  jobsCompleted: number;
  allocatedRevenue: number;
  avgRevPerHour: number | null;
}

/** 12-month monthly breakdown for a single member's performance tab chart. */
export async function getMemberMonthlyPerformance(
  companyId: string,
  userId: string,
  now: Date = new Date(),
): Promise<MonthlyPerformancePoint[]> {
  const from = new Date(now.getTime() - 365 * 86_400_000);

  // Hours per month from time entries
  const hoursRows = await db
    .select({
      minutes: timeEntries.durationMinutes,
      startAt: timeEntries.startAt,
    })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.companyId, companyId),
        eq(timeEntries.technicianId, userId),
        isNotNull(timeEntries.durationMinutes),
        isNotNull(timeEntries.endAt),
        gte(timeEntries.startAt, from),
        lt(timeEntries.startAt, now),
      ),
    );

  const hoursByMonth: Record<string, number> = {};
  for (const r of hoursRows) {
    if (r.minutes == null) continue;
    const d = new Date(r.startAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    hoursByMonth[key] = (hoursByMonth[key] ?? 0) + r.minutes;
  }
  // Convert minutes to hours
  for (const k of Object.keys(hoursByMonth)) {
    hoursByMonth[k] = Math.round((hoursByMonth[k] / 60) * 100) / 100;
  }

  // Jobs completed per month from job_status_events
  const jobsRows = await db
    .select({
      changedAt: jobStatusEvents.changedAt,
      jobId: jobStatusEvents.jobId,
    })
    .from(jobStatusEvents)
    .where(
      and(
        eq(jobStatusEvents.companyId, companyId),
        eq(jobStatusEvents.toStatus, "completed"),
        eq(jobStatusEvents.changedBy, userId),
        gte(jobStatusEvents.changedAt, from),
        lt(jobStatusEvents.changedAt, now),
      ),
    );

  const jobsByMonth: Record<string, string[]> = {};
  const allJobIds: string[] = [];
  for (const r of jobsRows) {
    if (!r.jobId) continue;
    const d = new Date(r.changedAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!jobsByMonth[key]) jobsByMonth[key] = [];
    jobsByMonth[key].push(r.jobId);
    allJobIds.push(r.jobId);
  }

  const uniqueJobIds = Array.from(new Set(allJobIds));

  // Revenue per job
  const revenueByJob: Record<string, number> = {};
  if (uniqueJobIds.length > 0) {
    const revRows = await db
      .select({ jobId: invoices.jobId, total: invoices.total })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          isNotNull(invoices.jobId),
          inArray(invoices.jobId, uniqueJobIds),
          ne(invoices.status, "draft"),
          ne(invoices.status, "voided"),
        ),
      );
    for (const r of revRows) {
      if (!r.jobId || r.total == null) continue;
      revenueByJob[r.jobId] = (revenueByJob[r.jobId] ?? 0) + parseFloat(r.total.toString());
    }
  }

  // Build month slots for last 12 months
  const months: string[] = [];
  const cursor = new Date(from);
  cursor.setDate(1);
  while (cursor <= now) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    months.push(key);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months.map((month) => {
    const hoursWorked = hoursByMonth[month] ?? 0;
    const jobIds = jobsByMonth[month] ?? [];
    const jobsCompleted = jobIds.length;
    let allocatedRevenue = 0;
    for (const jobId of jobIds) {
      allocatedRevenue += revenueByJob[jobId] ?? 0;
    }
    allocatedRevenue = Math.round(allocatedRevenue * 100) / 100;
    const avgRevPerHour =
      hoursWorked > 0 ? Math.round((allocatedRevenue / hoursWorked) * 100) / 100 : null;
    return { month, hoursWorked, jobsCompleted, allocatedRevenue, avgRevPerHour };
  });
}
