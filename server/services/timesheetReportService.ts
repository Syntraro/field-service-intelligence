/**
 * Timesheet Report service.
 *
 * Source of truth: `work_sessions` (daily clock-in/out). Job labor
 * attribution in `time_entries` is a SEPARATE concern and must not be
 * summed for payroll. See CHANGELOG 2026-04-12 audit.
 *
 * Responsibilities:
 *   - resolve date ranges from presets + saved payroll settings
 *   - fetch payroll sessions in range (tenant-scoped)
 *   - group total hours by employee
 *   - return detailed session rows
 *   - getPayrollSettings / upsertPayrollSettings
 *
 * Everything is tenant-scoped; timezone is read from the company record.
 */

import { and, asc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "../db";
import {
  payrollSettings,
  users,
  workSessions,
  type PayrollFrequency,
  type PayrollSettings,
} from "@shared/schema";
import { createError } from "../middleware/errorHandler";
import { companyRepository } from "../storage/company";
import { sessionDurationMinutes } from "../storage/timeTracking";
import { resolveTechnicianName } from "../lib/resolveTechnicianName";

// ---------------------------------------------------------------------------
// Presets + pay-period math
// ---------------------------------------------------------------------------

export const TIMESHEET_PRESETS = [
  "this_week",
  "this_month",
  "last_30_days",
  "this_year",
  "custom_range",
  "current_pay_period",
  "previous_pay_period",
  "next_pay_period",
] as const;
export type TimesheetPreset = (typeof TIMESHEET_PRESETS)[number];

/**
 * Hard max on custom ranges. 12 months — expressed as 366 days so a leap
 * year doesn't reject a valid full-year pull. Enforced on BOTH frontend
 * and backend; this constant is the source of truth.
 */
export const MAX_CUSTOM_RANGE_DAYS = 366;

/** Tenant-timezone "today" as YYYY-MM-DD. */
function todayInTz(tz: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

/** Add N days to a YYYY-MM-DD string. Returns YYYY-MM-DD. */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

/** Returns Monday of the ISO week containing `dateStr` (YYYY-MM-DD). */
function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const dow = d.getUTCDay(); // 0 = Sun, 1 = Mon, ... 6 = Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().split("T")[0];
}

/** YYYY-MM-DD string for the 1st of the month containing `dateStr`. */
function monthStart(dateStr: string): string {
  return dateStr.slice(0, 7) + "-01";
}

/** YYYY-MM-DD string for the last day of the month containing `dateStr`. */
function monthEnd(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().split("T")[0];
}

/**
 * Find the pay period containing `onDate` given a frequency + anchor.
 * Anchor is ANY date that's the first day of one concrete pay period;
 * all periods are derived by adding multiples of the period length.
 *
 * Phase 1 implements weekly + biweekly. Semimonthly + monthly throw
 * until their UI is wired.
 */
export function resolvePayPeriod(
  frequency: PayrollFrequency,
  anchorDate: string,
  onDate: string,
  offset: number = 0,
): { start: string; end: string } {
  const periodLengthDays = (() => {
    switch (frequency) {
      case "weekly":
        return 7;
      case "biweekly":
        return 14;
      case "semimonthly":
      case "monthly":
        throw createError(
          501,
          `Pay frequency '${frequency}' is not implemented yet. Use weekly or biweekly.`,
        );
      default: {
        const _exhaustive: never = frequency;
        throw createError(400, `Unknown pay frequency: ${frequency}`);
      }
    }
  })();

  const anchorMs = Date.UTC(
    Number(anchorDate.slice(0, 4)),
    Number(anchorDate.slice(5, 7)) - 1,
    Number(anchorDate.slice(8, 10)),
  );
  const onMs = Date.UTC(
    Number(onDate.slice(0, 4)),
    Number(onDate.slice(5, 7)) - 1,
    Number(onDate.slice(8, 10)),
  );
  const dayMs = 24 * 60 * 60 * 1000;
  const daysFromAnchor = Math.floor((onMs - anchorMs) / dayMs);
  // Handle negative dates (before anchor) with floor division semantics.
  const periodIndex = Math.floor(daysFromAnchor / periodLengthDays) + offset;
  const start = addDays(anchorDate, periodIndex * periodLengthDays);
  const end = addDays(start, periodLengthDays - 1);
  return { start, end };
}

export interface ResolvedRange {
  start: string; // YYYY-MM-DD (inclusive, tenant TZ)
  end: string; // YYYY-MM-DD (inclusive, tenant TZ)
  label: string;
  preset: TimesheetPreset;
}

/**
 * Resolve a preset + optional custom inputs into a concrete date range.
 * Uses tenant timezone for "today" so week/month boundaries are correct.
 */
export async function resolveDateRange(
  companyId: string,
  preset: TimesheetPreset,
  customStart?: string,
  customEnd?: string,
): Promise<ResolvedRange> {
  const tz = await companyRepository.getCompanyTimezone(companyId);
  const today = todayInTz(tz);

  switch (preset) {
    case "this_week": {
      const start = mondayOf(today);
      const end = addDays(start, 6);
      return { start, end, label: "This Week", preset };
    }
    case "this_month": {
      return { start: monthStart(today), end: monthEnd(today), label: "This Month", preset };
    }
    case "last_30_days": {
      return { start: addDays(today, -29), end: today, label: "Last 30 Days", preset };
    }
    case "this_year": {
      const y = today.slice(0, 4);
      return { start: `${y}-01-01`, end: `${y}-12-31`, label: "This Year", preset };
    }
    case "custom_range": {
      if (!customStart || !customEnd) {
        throw createError(400, "custom_range requires both start and end");
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(customStart) || !/^\d{4}-\d{2}-\d{2}$/.test(customEnd)) {
        throw createError(400, "Dates must be YYYY-MM-DD");
      }
      if (customEnd < customStart) {
        throw createError(400, "end must be on or after start");
      }
      const start = new Date(customStart + "T00:00:00Z").getTime();
      const end = new Date(customEnd + "T00:00:00Z").getTime();
      const days = Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1;
      if (days > MAX_CUSTOM_RANGE_DAYS) {
        throw createError(
          400,
          `Custom range too wide — max is 12 months (${MAX_CUSTOM_RANGE_DAYS} days).`,
        );
      }
      return { start: customStart, end: customEnd, label: "Custom Range", preset };
    }
    case "current_pay_period":
    case "previous_pay_period":
    case "next_pay_period": {
      const settings = await getPayrollSettings(companyId);
      if (!settings) {
        throw createError(
          400,
          "Pay period presets require payroll settings. Set pay frequency + anchor date first.",
        );
      }
      const offset =
        preset === "previous_pay_period" ? -1 : preset === "next_pay_period" ? 1 : 0;
      const { start, end } = resolvePayPeriod(
        settings.payFrequency as PayrollFrequency,
        settings.payAnchorDate,
        today,
        offset,
      );
      const labels = {
        current_pay_period: "Current Pay Period",
        previous_pay_period: "Previous Pay Period",
        next_pay_period: "Next Pay Period",
      } as const;
      return { start, end, label: labels[preset], preset };
    }
    default: {
      const _exhaustive: never = preset;
      throw createError(400, `Unknown preset`);
    }
  }
}

// ---------------------------------------------------------------------------
// Payroll settings CRUD
// ---------------------------------------------------------------------------

export async function getPayrollSettings(companyId: string): Promise<PayrollSettings | null> {
  const [row] = await db
    .select()
    .from(payrollSettings)
    .where(eq(payrollSettings.companyId, companyId))
    .limit(1);
  return row ?? null;
}

export interface UpsertPayrollSettingsInput {
  payFrequency: PayrollFrequency;
  payAnchorDate: string;
}

export async function upsertPayrollSettings(
  companyId: string,
  input: UpsertPayrollSettingsInput,
): Promise<PayrollSettings> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.payAnchorDate)) {
    throw createError(400, "payAnchorDate must be YYYY-MM-DD");
  }
  // Phase 1: only weekly + biweekly are actually wired; allow the other
  // values in the DB (future-proof) but reject via the /reports/timesheets
  // preset math until they're implemented. The enum on the column is
  // intentionally permissive.
  const existing = await getPayrollSettings(companyId);
  const now = new Date();
  if (existing) {
    const [updated] = await db
      .update(payrollSettings)
      .set({
        payFrequency: input.payFrequency,
        payAnchorDate: input.payAnchorDate,
        updatedAt: now,
      })
      .where(eq(payrollSettings.companyId, companyId))
      .returning();
    return updated;
  }
  const [inserted] = await db
    .insert(payrollSettings)
    .values({
      companyId,
      payFrequency: input.payFrequency,
      payAnchorDate: input.payAnchorDate,
    })
    .returning();
  return inserted;
}

// ---------------------------------------------------------------------------
// Report query
// ---------------------------------------------------------------------------

export interface TimesheetRow {
  sessionId: string;
  technicianId: string;
  technicianName: string;
  date: string;
  startTime: string;
  endTime: string | null;
  durationMinutes: number;
  isOpen: boolean;
  source: string;
  notes: string | null;
}

export interface EmployeeSummary {
  technicianId: string;
  technicianName: string;
  totalMinutes: number;
  sessionCount: number;
}

export interface TimesheetReportResult {
  appliedFilter: {
    preset: TimesheetPreset;
    start: string;
    end: string;
    label: string;
    technicianId: string | null;
  };
  summary: EmployeeSummary[];
  rows: TimesheetRow[];
  grandTotalMinutes: number;
  openSessionCount: number;
}

export interface GetTimesheetReportInput {
  companyId: string;
  preset: TimesheetPreset;
  customStart?: string;
  customEnd?: string;
  technicianId?: string;
}

export async function getTimesheetReport(
  input: GetTimesheetReportInput,
): Promise<TimesheetReportResult> {
  const range = await resolveDateRange(
    input.companyId,
    input.preset,
    input.customStart,
    input.customEnd,
  );

  const techFilter = input.technicianId
    ? eq(workSessions.technicianId, input.technicianId)
    : sql`1=1`;

  // Canonical query — mirrors getWeeklyPayrollSummary but over an arbitrary
  // range. Returns sessions AND their corresponding user display fields.
  // Open sessions (clockOutAt IS NULL) are INCLUDED in rows so the UI can
  // surface them, but they are excluded from totals by the aggregation
  // below (sessionDurationMinutes returns 0 for open sessions).
  const sessionRows = await db
    .select({
      sessionId: workSessions.id,
      technicianId: workSessions.technicianId,
      workDate: workSessions.workDate,
      clockInAt: workSessions.clockInAt,
      clockOutAt: workSessions.clockOutAt,
      breakMinutes: workSessions.breakMinutes,
      source: workSessions.source,
      notes: workSessions.notes,
      userFullName: users.fullName,
      userFirstName: users.firstName,
      userLastName: users.lastName,
      userEmail: users.email,
    })
    .from(workSessions)
    .leftJoin(users, eq(workSessions.technicianId, users.id))
    .where(
      and(
        eq(workSessions.companyId, input.companyId),
        gte(workSessions.workDate, range.start),
        lte(workSessions.workDate, range.end),
        techFilter,
      ),
    )
    .orderBy(asc(workSessions.workDate), asc(workSessions.clockInAt));

  const summaryMap = new Map<string, EmployeeSummary>();
  let grandTotalMinutes = 0;
  let openSessionCount = 0;
  const rows: TimesheetRow[] = [];

  for (const s of sessionRows) {
    const isOpen = s.clockOutAt == null;
    const minutes = isOpen ? 0 : sessionDurationMinutes(s);
    const name = resolveTechnicianName({
      fullName: s.userFullName,
      firstName: s.userFirstName,
      lastName: s.userLastName,
      email: s.userEmail,
    } as any);

    rows.push({
      sessionId: s.sessionId,
      technicianId: s.technicianId,
      technicianName: name,
      date: s.workDate,
      startTime: s.clockInAt.toISOString(),
      endTime: s.clockOutAt ? s.clockOutAt.toISOString() : null,
      durationMinutes: minutes,
      isOpen,
      source: s.source,
      notes: s.notes,
    });

    if (isOpen) {
      openSessionCount += 1;
      continue;
    }

    grandTotalMinutes += minutes;
    const existing = summaryMap.get(s.technicianId);
    if (existing) {
      existing.totalMinutes += minutes;
      existing.sessionCount += 1;
    } else {
      summaryMap.set(s.technicianId, {
        technicianId: s.technicianId,
        technicianName: name,
        totalMinutes: minutes,
        sessionCount: 1,
      });
    }
  }

  // Zero-hour visibility — one path for both scopes:
  //   - Technician mode: make sure the selected tech appears in the
  //     summary even with no sessions in range.
  //   - Team mode: make sure every schedulable tenant user appears
  //     even with no sessions in range (team overview needs the full
  //     roster for payroll planning).
  // The extra DB work is one tenant-scoped SELECT; totals math is
  // untouched.
  if (input.technicianId) {
    if (!summaryMap.has(input.technicianId)) {
      const [u] = await db
        .select({
          id: users.id,
          fullName: users.fullName,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        })
        .from(users)
        .where(and(eq(users.id, input.technicianId), eq(users.companyId, input.companyId)))
        .limit(1);
      if (u) {
        summaryMap.set(u.id, {
          technicianId: u.id,
          technicianName: resolveTechnicianName(u as any),
          totalMinutes: 0,
          sessionCount: 0,
        });
      }
    }
  } else {
    // Team mode: pull every schedulable + active user in the tenant and
    // insert a zero row for anyone not already in summaryMap. Matches
    // the filter `/api/team/technicians` uses (isSchedulable gates who
    // can clock in), so the overview roster is consistent across the
    // product.
    const eligible = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
      .from(users)
      .where(
        and(
          eq(users.companyId, input.companyId),
          eq(users.status, "active"),
          eq(users.isSchedulable, true),
        ),
      );
    for (const u of eligible) {
      if (summaryMap.has(u.id)) continue;
      summaryMap.set(u.id, {
        technicianId: u.id,
        technicianName: resolveTechnicianName(u as any),
        totalMinutes: 0,
        sessionCount: 0,
      });
    }
  }

  const summary = Array.from(summaryMap.values()).sort((a, b) =>
    a.technicianName.localeCompare(b.technicianName),
  );

  return {
    appliedFilter: {
      preset: range.preset,
      start: range.start,
      end: range.end,
      label: range.label,
      technicianId: input.technicianId ?? null,
    },
    summary,
    rows,
    grandTotalMinutes,
    openSessionCount,
  };
}
