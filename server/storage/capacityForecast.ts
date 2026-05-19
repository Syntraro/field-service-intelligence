/**
 * Workforce Capacity + Workload Intelligence — operational reporting only.
 *
 * Reports what is scheduled and what has been worked. Does NOT enforce limits,
 * generate compliance alerts, or make staffing decisions. The employer/dispatcher
 * interprets the numbers.
 *
 * Three exported functions:
 *   getTeamCapacityForecast  — today's capacity snapshot + weekly tracking per member
 *   getMemberWorkloadBreakdown — Billable/Drive/General hours from time_entries
 *   getPmForecast             — pending PM instance demand (count + estimated hours)
 *
 * All queries are batched (no N+1). All calculations are deterministic and readable.
 */

import { and, eq, gte, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { db } from "../db";
import {
  users,
  jobVisits,
  leadVisits,
  timeEntries,
  recurringJobInstances,
  recurringJobTemplates,
} from "@shared/schema";
import { availabilityEngine, type ResolvedShift } from "../services/availabilityEngine";
import { companyRepository } from "./company";

// ── Window types ─────────────────────────────────────────────────────────────

export type ForecastWindow = "today" | "tomorrow" | "week" | "next_week" | "30d";
export type WorkloadWindow = "today" | "this_week" | "last_30_days";

// ── Output types ─────────────────────────────────────────────────────────────

export interface WorkloadCategory {
  hours: number;
  pct: number; // 0–100, rounded
}

export interface WorkloadBreakdown {
  window: WorkloadWindow;
  totalHours: number;
  billable: WorkloadCategory;
  drive: WorkloadCategory;
  general: WorkloadCategory;
}

export interface MemberCapacityRow {
  userId: string;
  name: string;
  role: string;
  todayAvailableHours: number;
  todayScheduledHours: number;
  todayUtilizationPct: number | null;
  workedHoursThisWeek: number;
  scheduledRemainingHoursThisWeek: number;
  forecastedWeekHours: number;
  targetWeeklyHours: number;
}

export interface TeamCapacitySnapshot {
  availableHours: number;
  scheduledHours: number;
  openHours: number;
  utilizationPct: number | null;
}

export interface TeamCapacityForecast {
  generatedAt: string;
  today: TeamCapacitySnapshot;
  members: MemberCapacityRow[];
}

export interface PmWindowForecast {
  pendingInstanceCount: number;
  estimatedTotalHours: number;
}

export interface PmForecast {
  generatedAt: string;
  thisWeek: PmWindowForecast;
  nextWeek: PmWindowForecast;
  next30Days: PmWindowForecast;
}

// ── Time entry categorization ─────────────────────────────────────────────────
// Drive:   travel_to_job, travel_between_jobs
// Billable: on_site or task_work with billable = true
// General:  everything else

const DRIVE_TYPE_SET = new Set(["travel_to_job", "travel_between_jobs"]);

export function categorizeEntry(type: string, billable: boolean): "billable" | "drive" | "general" {
  if (DRIVE_TYPE_SET.has(type)) return "drive";
  if ((type === "on_site" || type === "task_work") && billable) return "billable";
  return "general";
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

// Monday of the week containing `d`
function startOfWeek(d: Date): Date {
  const r = startOfDay(d);
  const dow = r.getDay(); // 0=Sun
  r.setDate(r.getDate() - (dow === 0 ? 6 : dow - 1));
  return r;
}

function endOfWeek(d: Date): Date {
  const monday = startOfWeek(d);
  const r = new Date(monday);
  r.setDate(monday.getDate() + 6);
  r.setHours(23, 59, 59, 999);
  return r;
}

function nextMondayOf(d: Date): Date {
  const r = startOfDay(d);
  const dow = r.getDay();
  r.setDate(r.getDate() + (dow === 0 ? 1 : 8 - dow));
  return r;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── Shift-based capacity helpers ──────────────────────────────────────────────

/** Available minutes in [rangeStart, rangeEnd] from shift data.
 *
 *  Sums clipped normal-shift durations then subtracts overlapping unavailable
 *  shifts (time-off). The `shifts` array comes from
 *  `availabilityEngine.resolveTechnicianShifts`, which already merges
 *  technician_time_off rows as synthetic unavailable shifts. */
export function computeAvailableMinutes(
  rangeStart: Date,
  rangeEnd: Date,
  shifts: ResolvedShift[],
): number {
  const rs = rangeStart.getTime();
  const re = rangeEnd.getTime();

  // Pre-collect unavailable intervals for overlap subtraction.
  const unavailable = shifts
    .filter((s) => s.shiftType === "unavailable")
    .map((s) => ({ s: s.startsAt.getTime(), e: s.endsAt.getTime() }));

  let total = 0;
  for (const shift of shifts) {
    if (shift.shiftType !== "normal") continue;
    const os = Math.max(shift.startsAt.getTime(), rs);
    const oe = Math.min(shift.endsAt.getTime(), re);
    if (oe <= os) continue;
    let mins = Math.round((oe - os) / 60_000);
    for (const u of unavailable) {
      const us = Math.max(u.s, os);
      const ue = Math.min(u.e, oe);
      if (ue > us) mins -= Math.round((ue - us) / 60_000);
    }
    total += Math.max(0, mins);
  }
  return total;
}

/** Sum of normal-shift hours from the provided shift list.
 *  Returns 0 when no normal shifts exist (no 40-hr fallback). */
export function computeTargetWeeklyHours(shifts: ResolvedShift[]): number {
  let totalMs = 0;
  for (const s of shifts) {
    if (s.shiftType !== "normal") continue;
    totalMs += s.endsAt.getTime() - s.startsAt.getTime();
  }
  return Math.round((totalMs / 3_600_000) * 10) / 10;
}

// ── Visit duration helper ─────────────────────────────────────────────────────

export interface VisitDuration {
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  estimatedDurationMinutes: number | null;
  isAllDay: boolean;
  assignedTechnicianIds: string[] | null;
}

export function visitMinutes(v: VisitDuration): number {
  if (v.isAllDay) return v.estimatedDurationMinutes ?? 0;
  if (v.scheduledEnd && v.scheduledStart) {
    return Math.max(0, Math.round((new Date(v.scheduledEnd).getTime() - new Date(v.scheduledStart).getTime()) / 60_000));
  }
  if (v.scheduledStart) return v.estimatedDurationMinutes ?? 60;
  return 0;
}

/** Sum scheduled minutes per member from a list of visits. */
export function accumulateVisitMinutes(
  visits: VisitDuration[],
  memberIds: string[],
): Map<string, number> {
  const memberSet = new Set(memberIds);
  const out = new Map<string, number>();
  for (const v of visits) {
    const mins = visitMinutes(v);
    if (mins <= 0) continue;
    const assigned = (v.assignedTechnicianIds ?? []) as string[];
    for (const uid of assigned) {
      if (!memberSet.has(uid)) continue;
      out.set(uid, (out.get(uid) ?? 0) + mins);
    }
  }
  return out;
}

// ── Main: team capacity forecast ──────────────────────────────────────────────

export async function getTeamCapacityForecast(
  companyId: string,
  now: Date = new Date(),
): Promise<TeamCapacityForecast> {
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const weekStart = startOfWeek(now);
  const weekEnd = endOfWeek(now);

  // 1. Active schedulable members
  const memberRows = await db
    .select({
      userId: users.id,
      name: sql<string>`COALESCE(${users.fullName}, ${users.firstName}, ${users.email})`,
      role: users.role,
    })
    .from(users)
    .where(
      and(
        eq(users.companyId, companyId),
        eq(users.isSchedulable, true),
        eq(users.status, "active"),
        isNull(users.deletedAt),
      ),
    );

  if (memberRows.length === 0) {
    return {
      generatedAt: now.toISOString(),
      today: { availableHours: 0, scheduledHours: 0, openHours: 0, utilizationPct: null },
      members: [],
    };
  }

  const memberIds = memberRows.map((m) => m.userId);

  // 2–6. Parallel batch queries
  const [timezone, todayJobVisits, todayLeadVisits, workedRows, remainingJobVisits, remainingLeadVisits] = await Promise.all([
    // 2. Company timezone for shift resolution
    companyRepository.getCompanyTimezone(companyId),

    // 3. Job visits today
    db.select({
      scheduledStart: jobVisits.scheduledStart,
      scheduledEnd: jobVisits.scheduledEnd,
      estimatedDurationMinutes: jobVisits.estimatedDurationMinutes,
      assignedTechnicianIds: jobVisits.assignedTechnicianIds,
      isAllDay: jobVisits.isAllDay,
    }).from(jobVisits)
      .where(
        and(
          eq(jobVisits.companyId, companyId),
          eq(jobVisits.isActive, true),
          ne(jobVisits.status, "cancelled"),
          gte(jobVisits.scheduledStart, todayStart),
          lte(jobVisits.scheduledStart, todayEnd),
        ),
      ),

    // 4. Lead visits today
    db.select({
      scheduledStart: leadVisits.scheduledStart,
      scheduledEnd: leadVisits.scheduledEnd,
      estimatedDurationMinutes: leadVisits.estimatedDurationMinutes,
      assignedTechnicianIds: leadVisits.assignedTechnicianIds,
      isAllDay: leadVisits.isAllDay,
    }).from(leadVisits)
      .where(
        and(
          eq(leadVisits.companyId, companyId),
          ne(leadVisits.status, "cancelled"),
          gte(leadVisits.scheduledStart, todayStart),
          lte(leadVisits.scheduledStart, todayEnd),
        ),
      ),

    // 5. Time entries this week (for worked hours)
    db.select({
      technicianId: timeEntries.technicianId,
      durationMinutes: timeEntries.durationMinutes,
    }).from(timeEntries)
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          inArray(timeEntries.technicianId, memberIds),
          gte(timeEntries.startAt, weekStart),
          lt(timeEntries.startAt, now),
          sql`${timeEntries.durationMinutes} IS NOT NULL`,
          sql`${timeEntries.endAt} IS NOT NULL`,
        ),
      ),

    // 6. Job visits remaining this week (from now)
    db.select({
      scheduledStart: jobVisits.scheduledStart,
      scheduledEnd: jobVisits.scheduledEnd,
      estimatedDurationMinutes: jobVisits.estimatedDurationMinutes,
      assignedTechnicianIds: jobVisits.assignedTechnicianIds,
      isAllDay: jobVisits.isAllDay,
    }).from(jobVisits)
      .where(
        and(
          eq(jobVisits.companyId, companyId),
          eq(jobVisits.isActive, true),
          ne(jobVisits.status, "cancelled"),
          ne(jobVisits.status, "completed"),
          gte(jobVisits.scheduledStart, now),
          lte(jobVisits.scheduledStart, weekEnd),
        ),
      ),

    // 7. Lead visits remaining this week
    db.select({
      scheduledStart: leadVisits.scheduledStart,
      scheduledEnd: leadVisits.scheduledEnd,
      estimatedDurationMinutes: leadVisits.estimatedDurationMinutes,
      assignedTechnicianIds: leadVisits.assignedTechnicianIds,
      isAllDay: leadVisits.isAllDay,
    }).from(leadVisits)
      .where(
        and(
          eq(leadVisits.companyId, companyId),
          ne(leadVisits.status, "cancelled"),
          ne(leadVisits.status, "completed"),
          gte(leadVisits.scheduledStart, now),
          lte(leadVisits.scheduledStart, weekEnd),
        ),
      ),
  ]);

  // 8. Resolve week shifts — includes time-off as shiftType "unavailable"
  const weekShifts = await availabilityEngine.resolveTechnicianShifts(
    companyId, memberIds, weekStart, weekEnd, timezone,
  );
  const shiftsByUser = new Map<string, ResolvedShift[]>();
  for (const s of weekShifts) {
    const list = shiftsByUser.get(s.technicianUserId) ?? [];
    list.push(s);
    shiftsByUser.set(s.technicianUserId, list);
  }

  // Compute scheduled minutes per member (today)
  const todayScheduledMap = accumulateVisitMinutes(
    [...todayJobVisits, ...todayLeadVisits] as VisitDuration[],
    memberIds,
  );

  // Worked minutes this week per member
  const workedMinsByUser: Record<string, number> = {};
  for (const r of workedRows) {
    if (!r.technicianId || r.durationMinutes == null) continue;
    workedMinsByUser[r.technicianId] = (workedMinsByUser[r.technicianId] ?? 0) + r.durationMinutes;
  }

  // Scheduled remaining minutes this week per member
  const remainingMap = accumulateVisitMinutes(
    [...remainingJobVisits, ...remainingLeadVisits] as VisitDuration[],
    memberIds,
  );

  // Build per-member rows
  let teamAvailMins = 0;
  let teamSchedMins = 0;
  const members: MemberCapacityRow[] = memberRows.map((m) => {
    const userShifts = shiftsByUser.get(m.userId) ?? [];

    const todayAvailMins = computeAvailableMinutes(todayStart, todayEnd, userShifts);
    const todaySchedMins = todayScheduledMap.get(m.userId) ?? 0;
    const todayAvailHours = Math.round((todayAvailMins / 60) * 10) / 10;
    const todaySchedHours = Math.round((todaySchedMins / 60) * 10) / 10;
    const todayUtilizationPct = todayAvailMins > 0
      ? Math.min(100, Math.round((todaySchedMins / todayAvailMins) * 100))
      : null;

    const workedMins = workedMinsByUser[m.userId] ?? 0;
    const remainingMins = remainingMap.get(m.userId) ?? 0;
    const workedHours = Math.round((workedMins / 60) * 10) / 10;
    const remainingHours = Math.round((remainingMins / 60) * 10) / 10;
    const forecastedHours = Math.round((workedHours + remainingHours) * 10) / 10;
    const targetWeeklyHours = computeTargetWeeklyHours(userShifts);

    teamAvailMins += todayAvailMins;
    teamSchedMins += todaySchedMins;

    return {
      userId: m.userId,
      name: m.name,
      role: m.role,
      todayAvailableHours: todayAvailHours,
      todayScheduledHours: todaySchedHours,
      todayUtilizationPct,
      workedHoursThisWeek: workedHours,
      scheduledRemainingHoursThisWeek: remainingHours,
      forecastedWeekHours: forecastedHours,
      targetWeeklyHours,
    };
  });

  const todayAvailHoursTeam = Math.round((teamAvailMins / 60) * 10) / 10;
  const todaySchedHoursTeam = Math.round((teamSchedMins / 60) * 10) / 10;

  return {
    generatedAt: now.toISOString(),
    today: {
      availableHours: todayAvailHoursTeam,
      scheduledHours: todaySchedHoursTeam,
      openHours: Math.max(0, Math.round((todayAvailHoursTeam - todaySchedHoursTeam) * 10) / 10),
      utilizationPct: teamAvailMins > 0
        ? Math.min(100, Math.round((teamSchedMins / teamAvailMins) * 100))
        : null,
    },
    members,
  };
}

// ── Workload breakdown (actual time entries) ──────────────────────────────────

export async function getMemberWorkloadBreakdown(
  companyId: string,
  userId: string,
  window: WorkloadWindow,
  now: Date = new Date(),
): Promise<WorkloadBreakdown> {
  let periodStart: Date;
  let periodEnd: Date;

  if (window === "today") {
    periodStart = startOfDay(now);
    periodEnd = endOfDay(now);
  } else if (window === "this_week") {
    periodStart = startOfWeek(now);
    periodEnd = endOfWeek(now);
  } else {
    // last_30_days
    periodStart = new Date(now.getTime() - 30 * 86_400_000);
    periodEnd = now;
  }

  const rows = await db
    .select({
      type: timeEntries.type,
      billable: timeEntries.billable,
      durationMinutes: timeEntries.durationMinutes,
    })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.companyId, companyId),
        eq(timeEntries.technicianId, userId),
        gte(timeEntries.startAt, periodStart),
        lt(timeEntries.startAt, periodEnd),
        sql`${timeEntries.durationMinutes} IS NOT NULL`,
        sql`${timeEntries.endAt} IS NOT NULL`,
      ),
    );

  let billableMins = 0;
  let driveMins = 0;
  let generalMins = 0;

  for (const r of rows) {
    if (r.durationMinutes == null) continue;
    const category = categorizeEntry(r.type, r.billable ?? false);
    if (category === "billable") billableMins += r.durationMinutes;
    else if (category === "drive") driveMins += r.durationMinutes;
    else generalMins += r.durationMinutes;
  }

  const totalMins = billableMins + driveMins + generalMins;
  const totalHours = Math.round((totalMins / 60) * 10) / 10;

  function toCategory(mins: number): WorkloadCategory {
    return {
      hours: Math.round((mins / 60) * 10) / 10,
      pct: totalMins > 0 ? Math.round((mins / totalMins) * 100) : 0,
    };
  }

  return {
    window,
    totalHours,
    billable: toCategory(billableMins),
    drive: toCategory(driveMins),
    general: toCategory(generalMins),
  };
}

// ── PM workload forecast ──────────────────────────────────────────────────────

async function pmForWindow(
  companyId: string,
  windowStart: string,
  windowEnd: string,
): Promise<PmWindowForecast> {
  const rows = await db
    .select({
      defaultDurationMinutes: recurringJobTemplates.defaultDurationMinutes,
    })
    .from(recurringJobInstances)
    .innerJoin(
      recurringJobTemplates,
      eq(recurringJobInstances.templateId, recurringJobTemplates.id),
    )
    .where(
      and(
        eq(recurringJobInstances.companyId, companyId),
        eq(recurringJobInstances.status, "pending"),
        gte(recurringJobInstances.instanceDate, windowStart),
        lte(recurringJobInstances.instanceDate, windowEnd),
      ),
    );

  const pendingInstanceCount = rows.length;
  const totalMins = rows.reduce((acc, r) => acc + (r.defaultDurationMinutes ?? 60), 0);
  const estimatedTotalHours = Math.round((totalMins / 60) * 10) / 10;

  return { pendingInstanceCount, estimatedTotalHours };
}

export async function getPmForecast(
  companyId: string,
  now: Date = new Date(),
): Promise<PmForecast> {
  const thisWeekStart = isoDate(startOfWeek(now));
  const thisWeekEnd = isoDate(endOfWeek(now));
  const nextMonday = nextMondayOf(now);
  const nextWeekStart = isoDate(nextMonday);
  const nextWeekEnd = isoDate(endOfWeek(nextMonday));
  const todayStr = isoDate(now);
  const thirtyDaysStr = isoDate(new Date(now.getTime() + 29 * 86_400_000));

  const [thisWeek, nextWeek, next30Days] = await Promise.all([
    pmForWindow(companyId, thisWeekStart, thisWeekEnd),
    pmForWindow(companyId, nextWeekStart, nextWeekEnd),
    pmForWindow(companyId, todayStr, thirtyDaysStr),
  ]);

  return { generatedAt: now.toISOString(), thisWeek, nextWeek, next30Days };
}
