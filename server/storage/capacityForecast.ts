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
  technicianTimeOff,
  timeEntries,
  workingHours as workingHoursTable,
  companyBusinessHours as companyBusinessHoursTable,
  recurringJobInstances,
  recurringJobTemplates,
} from "@shared/schema";

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

// ── Working hours helpers ─────────────────────────────────────────────────────

function parseHHMM(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export type WorkingHourRow = { dayOfWeek: number; isWorking: boolean; startTime: string | null; endTime: string | null };
export type CompanyHourRow = { dayOfWeek: number; isOpen: boolean; startMinutes: number | null; endMinutes: number | null };
export type TimeOffRow = { startsAt: Date; endsAt: Date; allDay: boolean };

/** Working minutes a member has on a given day-of-week (0=Sun). 0 = not working. */
function workingMinutesForDow(
  dow: number,
  memberRows: WorkingHourRow[],
  companyRows: CompanyHourRow[],
): number {
  const custom = memberRows.find((r) => r.dayOfWeek === dow);
  if (custom !== undefined) {
    if (!custom.isWorking) return 0;
    const s = parseHHMM(custom.startTime);
    const e = parseHHMM(custom.endTime);
    if (s == null || e == null || e <= s) return 0;
    return e - s;
  }
  const company = companyRows.find((r) => r.dayOfWeek === dow);
  if (company) {
    if (!company.isOpen) return 0;
    const s = company.startMinutes ?? 0;
    const e = company.endMinutes ?? 0;
    return e > s ? e - s : 0;
  }
  return dow >= 1 && dow <= 5 ? 480 : 0; // Mon–Fri default: 8 hrs
}

/** Compute total available minutes across [rangeStart, rangeEnd] minus time-off. */
export function computeAvailableMinutes(
  rangeStart: Date,
  rangeEnd: Date,
  memberRows: WorkingHourRow[],
  companyRows: CompanyHourRow[],
  tofs: TimeOffRow[],
): number {
  let total = 0;
  const cursor = new Date(rangeStart);
  cursor.setHours(0, 0, 0, 0);

  while (cursor <= rangeEnd) {
    const dow = cursor.getDay();
    const workingMins = workingMinutesForDow(dow, memberRows, companyRows);
    if (workingMins > 0) {
      const dayStartMs = cursor.getTime();
      const dayEndMs = dayStartMs + 86_400_000;
      let tofMins = 0;
      for (const tof of tofs) {
        const os = Math.max(tof.startsAt.getTime(), dayStartMs);
        const oe = Math.min(tof.endsAt.getTime(), dayEndMs);
        if (oe <= os) continue;
        if (tof.allDay) {
          tofMins += workingMins;
        } else {
          tofMins += Math.min(workingMins, Math.round((oe - os) / 60_000));
        }
      }
      total += Math.max(0, workingMins - tofMins);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return total;
}

/** Weekly target hours derived from working_hours rows (fallback: 40). */
export function computeTargetWeeklyHours(memberRows: WorkingHourRow[]): number {
  if (memberRows.length === 0) return 40;
  let total = 0;
  for (const r of memberRows) {
    if (!r.isWorking || !r.startTime || !r.endTime) continue;
    const s = parseHHMM(r.startTime);
    const e = parseHHMM(r.endTime);
    if (s != null && e != null && e > s) total += (e - s) / 60;
  }
  return total > 0 ? Math.round(total * 10) / 10 : 40;
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

  // 2–7. Parallel batch queries
  const [whRows, companyHours, timeOffRows, todayJobVisits, todayLeadVisits, workedRows, remainingJobVisits, remainingLeadVisits] = await Promise.all([
    // 2. Working hours for all members
    db.select({
      userId: workingHoursTable.userId,
      dayOfWeek: workingHoursTable.dayOfWeek,
      startTime: workingHoursTable.startTime,
      endTime: workingHoursTable.endTime,
      isWorking: workingHoursTable.isWorking,
    }).from(workingHoursTable)
      .where(inArray(workingHoursTable.userId, memberIds)),

    // 3. Company business hours
    db.select({
      dayOfWeek: companyBusinessHoursTable.dayOfWeek,
      isOpen: companyBusinessHoursTable.isOpen,
      startMinutes: companyBusinessHoursTable.startMinutes,
      endMinutes: companyBusinessHoursTable.endMinutes,
    }).from(companyBusinessHoursTable)
      .where(eq(companyBusinessHoursTable.companyId, companyId)),

    // 4. Time-off overlapping [weekStart, weekEnd]
    db.select({
      technicianUserId: technicianTimeOff.technicianUserId,
      startsAt: technicianTimeOff.startsAt,
      endsAt: technicianTimeOff.endsAt,
      allDay: technicianTimeOff.allDay,
    }).from(technicianTimeOff)
      .where(
        and(
          eq(technicianTimeOff.companyId, companyId),
          isNull(technicianTimeOff.archivedAt),
          lte(technicianTimeOff.startsAt, weekEnd),
          gte(technicianTimeOff.endsAt, weekStart),
        ),
      ),

    // 5. Job visits today
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

    // 6. Lead visits today
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

    // 7. Time entries this week (for worked hours)
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

    // 8. Job visits remaining this week (from now)
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

    // 9. Lead visits remaining this week
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

  // Group working hours by userId
  const whByUser: Record<string, WorkingHourRow[]> = {};
  for (const r of whRows) {
    if (!whByUser[r.userId]) whByUser[r.userId] = [];
    whByUser[r.userId]!.push(r);
  }

  // Group time-off by userId (for today and for this-week tracking)
  const todayTofByUser: Record<string, TimeOffRow[]> = {};
  const weekTofByUser: Record<string, TimeOffRow[]> = {};
  for (const t of timeOffRows) {
    const row: TimeOffRow = { startsAt: new Date(t.startsAt), endsAt: new Date(t.endsAt), allDay: t.allDay };
    if (!weekTofByUser[t.technicianUserId]) weekTofByUser[t.technicianUserId] = [];
    weekTofByUser[t.technicianUserId]!.push(row);
    // Today's subset
    const os = Math.max(row.startsAt.getTime(), todayStart.getTime());
    const oe = Math.min(row.endsAt.getTime(), todayEnd.getTime() + 1);
    if (oe > os) {
      if (!todayTofByUser[t.technicianUserId]) todayTofByUser[t.technicianUserId] = [];
      todayTofByUser[t.technicianUserId]!.push(row);
    }
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
    const mwh = whByUser[m.userId] ?? [];
    const todayTof = todayTofByUser[m.userId] ?? [];
    const weekTof = weekTofByUser[m.userId] ?? [];

    const todayAvailMins = computeAvailableMinutes(todayStart, todayEnd, mwh, companyHours, todayTof);
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
    const targetWeeklyHours = computeTargetWeeklyHours(mwh);

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
