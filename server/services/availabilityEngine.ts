/**
 * Availability Engine — Technician Shift Management Phase 1.
 *
 * Single canonical service for all technician availability resolution.
 * ALL scheduling consumers (dispatch, calendar, scheduling routes,
 * future payroll, future reports) call this service — never query
 * technician_shifts directly.
 *
 * Conflict semantics:
 *   Valid overlap:   normal + on_call (tech is on-call during their shift)
 *   Invalid overlap: unavailable + anything, normal + normal
 */
import { getDayUTCBounds } from "../lib/dayBoundaries";
import { expandRecurringShift } from "../lib/rruleExpansion";
import { technicianShiftsRepository } from "../storage/technicianShifts";

// ─── Public types ─────────────────────────────────────────────────────────────

export type ShiftType = "normal" | "on_call" | "unavailable";
export type ShiftSubtype =
  | "vacation"
  | "sick"
  | "personal"
  | "training"
  | "holiday"
  | "scheduled_off"
  | "other";

export interface ResolvedShift {
  /** Base shift id (one-off) or exception id (edited occurrence). */
  id: string;
  /** Always the base row id. */
  baseShiftId: string;
  technicianUserId: string;
  templateId: string | null;
  shiftType: ShiftType;
  shiftSubtype?: ShiftSubtype;
  label?: string;
  color?: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  /** Derived: endsAt is on a different calendar date than startsAt (in company tz). */
  isOvernight: boolean;
  /** YYYY-MM-DD for recurring occurrences; null for one-off shifts. */
  occurrenceDate: string | null;
  note?: string;
}

export interface TechnicianAvailability {
  technicianUserId: string;
  date: string;            // YYYY-MM-DD in company tz
  isAvailable: boolean;    // false if any unavailable shift blocks this date
  normalShifts: ResolvedShift[];
  onCallShifts: ResolvedShift[];
  unavailableShifts: ResolvedShift[];
}

export type WarningCode =
  | "OUTSIDE_SHIFT"
  | "UNAVAILABLE_CONFLICT"
  | "NO_ONCALL_COVERAGE"
  | "NORMAL_SHIFT_OVERLAP";

export interface AssignmentWarning {
  code: WarningCode;
  conflictingShift?: ResolvedShift;
}

export interface AssignmentValidation {
  /** Always true — all warnings are advisory. Callers decide whether to block. */
  isValid: boolean;
  warnings: AssignmentWarning[];
}

export interface OnCallCoverage {
  covered: boolean;
  onCallShifts: ResolvedShift[];
  gaps: Array<{ startsAt: Date; endsAt: Date }>;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function formatDateInTz(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

function isOvernight(startsAt: Date, endsAt: Date, timezone: string): boolean {
  return formatDateInTz(startsAt, timezone) !== formatDateInTz(endsAt, timezone);
}

// ─── Engine methods ──────────────────────────────────────────────────────────

/**
 * Resolve all technician shifts in a UTC window into concrete ResolvedShift
 * objects, expanding recurring shifts and merging exception rows.
 *
 * technicianUserIds = null → all technicians in the company.
 */
async function resolveTechnicianShifts(
  companyId: string,
  technicianUserIds: string[] | null,
  windowStart: Date,
  windowEnd: Date,
  companyTimezone: string,
): Promise<ResolvedShift[]> {
  const baseRows = await technicianShiftsRepository.listBaseShiftsInWindow(
    companyId,
    technicianUserIds,
    windowStart,
    windowEnd,
  );

  const oneOffRows = baseRows.filter((r) => !r.recurrenceRule);
  const recurringRows = baseRows.filter((r) => !!r.recurrenceRule);

  const allBaseIds = recurringRows.map((r) => r.id);

  // Window dates for exception lookup.
  const windowStartDate = formatDateInTz(windowStart, companyTimezone);
  const windowEndDate = formatDateInTz(windowEnd, companyTimezone);

  const exceptions = allBaseIds.length > 0
    ? await technicianShiftsRepository.listExceptionsForBases(
        companyId,
        allBaseIds,
        windowStartDate,
        windowEndDate,
      )
    : [];

  // Build exception map: baseShiftId → (occurrenceDate → exceptionRow)
  const exceptionMap = new Map<string, Map<string, typeof exceptions[0]>>();
  for (const exc of exceptions) {
    if (!exc.recurrenceParentId || !exc.occurrenceDate) continue;
    if (!exceptionMap.has(exc.recurrenceParentId)) {
      exceptionMap.set(exc.recurrenceParentId, new Map());
    }
    exceptionMap.get(exc.recurrenceParentId)!.set(exc.occurrenceDate, exc);
  }

  const results: ResolvedShift[] = [];

  // ── One-off shifts ─────────────────────────────────────────────────────────
  for (const row of oneOffRows) {
    if (row.isCancelled) continue;
    results.push({
      id: row.id,
      baseShiftId: row.id,
      technicianUserId: row.technicianUserId,
      templateId: row.templateId ?? null,
      shiftType: row.shiftType as ShiftType,
      shiftSubtype: row.shiftSubtype as ShiftSubtype | undefined,
      label: row.label ?? undefined,
      color: row.color ?? undefined,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      allDay: row.allDay,
      isOvernight: isOvernight(row.startsAt, row.endsAt, companyTimezone),
      occurrenceDate: null,
      note: row.note ?? undefined,
    });
  }

  // ── Recurring shifts ───────────────────────────────────────────────────────
  for (const base of recurringRows) {
    const expanded = expandRecurringShift(
      {
        startsAt: base.startsAt,
        endsAt: base.endsAt,
        allDay: base.allDay,
        timeOfDayStart: base.timeOfDayStart,
        timeOfDayEnd: base.timeOfDayEnd,
        recurrenceRule: base.recurrenceRule!,
        recurrenceEndDate: base.recurrenceEndDate ?? null,
      },
      windowStart,
      windowEnd,
      companyTimezone,
    );

    const baseExceptions = exceptionMap.get(base.id);

    for (const occ of expanded) {
      const exception = baseExceptions?.get(occ.occurrenceDate);

      if (exception) {
        // Cancelled occurrence: skip.
        if (exception.isCancelled) continue;
        // Edited occurrence: use exception's bounds and properties.
        results.push({
          id: exception.id,
          baseShiftId: base.id,
          technicianUserId: base.technicianUserId,
          templateId: base.templateId ?? null,
          shiftType: (exception.shiftType ?? base.shiftType) as ShiftType,
          shiftSubtype: (exception.shiftSubtype ?? base.shiftSubtype) as ShiftSubtype | undefined,
          label: (exception.label ?? base.label) ?? undefined,
          color: (exception.color ?? base.color) ?? undefined,
          startsAt: exception.startsAt,
          endsAt: exception.endsAt,
          allDay: exception.allDay,
          isOvernight: isOvernight(exception.startsAt, exception.endsAt, companyTimezone),
          occurrenceDate: occ.occurrenceDate,
          note: (exception.note ?? base.note) ?? undefined,
        });
      } else {
        // Normal (unmodified) occurrence: use expanded bounds.
        results.push({
          id: base.id,
          baseShiftId: base.id,
          technicianUserId: base.technicianUserId,
          templateId: base.templateId ?? null,
          shiftType: base.shiftType as ShiftType,
          shiftSubtype: base.shiftSubtype as ShiftSubtype | undefined,
          label: base.label ?? undefined,
          color: base.color ?? undefined,
          startsAt: occ.startsAt,
          endsAt: occ.endsAt,
          allDay: base.allDay,
          isOvernight: isOvernight(occ.startsAt, occ.endsAt, companyTimezone),
          occurrenceDate: occ.occurrenceDate,
          note: base.note ?? undefined,
        });
      }
    }
  }

  // Sort ascending by startsAt.
  results.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return results;
}

/**
 * Resolve a single technician's availability for one calendar date.
 */
async function resolveTechnicianAvailability(
  companyId: string,
  technicianUserId: string,
  date: string,   // YYYY-MM-DD in company tz
  companyTimezone: string,
): Promise<TechnicianAvailability> {
  const { start: dayStart, end: dayEnd } = getDayUTCBounds(date, companyTimezone);

  const shifts = await resolveTechnicianShifts(
    companyId,
    [technicianUserId],
    dayStart,
    dayEnd,
    companyTimezone,
  );

  const normalShifts = shifts.filter((s) => s.shiftType === "normal");
  const onCallShifts = shifts.filter((s) => s.shiftType === "on_call");
  const unavailableShifts = shifts.filter((s) => s.shiftType === "unavailable");

  return {
    technicianUserId,
    date,
    isAvailable: unavailableShifts.length === 0,
    normalShifts,
    onCallShifts,
    unavailableShifts,
  };
}

/**
 * Return all shifts for a technician that overlap the proposed [start, end) window.
 * Optionally exclude a specific shift ID (e.g. when editing an existing shift).
 */
async function resolveShiftConflicts(
  companyId: string,
  technicianUserId: string,
  proposedStart: Date,
  proposedEnd: Date,
  companyTimezone: string,
  opts?: { excludeShiftId?: string },
): Promise<ResolvedShift[]> {
  const shifts = await resolveTechnicianShifts(
    companyId,
    [technicianUserId],
    proposedStart,
    proposedEnd,
    companyTimezone,
  );

  return shifts.filter((s) => {
    if (opts?.excludeShiftId && s.id === opts.excludeShiftId) return false;
    // Standard interval overlap: a.start < b.end AND a.end > b.start
    return s.startsAt < proposedEnd && s.endsAt > proposedStart;
  });
}

/**
 * Return all unavailable (time-off) shifts for the given technicians
 * within the window.
 */
async function resolveTimeOffBlocks(
  companyId: string,
  technicianUserIds: string[] | null,
  windowStart: Date,
  windowEnd: Date,
  companyTimezone: string,
): Promise<ResolvedShift[]> {
  const shifts = await resolveTechnicianShifts(
    companyId,
    technicianUserIds,
    windowStart,
    windowEnd,
    companyTimezone,
  );
  return shifts.filter((s) => s.shiftType === "unavailable");
}

/**
 * Compute on-call coverage across all technicians in the window.
 * Returns whether the window is fully covered, the on-call shifts,
 * and any gaps.
 */
async function resolveOnCallCoverage(
  companyId: string,
  windowStart: Date,
  windowEnd: Date,
  companyTimezone: string,
): Promise<OnCallCoverage> {
  const allShifts = await resolveTechnicianShifts(
    companyId,
    null,
    windowStart,
    windowEnd,
    companyTimezone,
  );
  const onCallShifts = allShifts.filter((s) => s.shiftType === "on_call");

  if (onCallShifts.length === 0) {
    return {
      covered: false,
      onCallShifts: [],
      gaps: [{ startsAt: windowStart, endsAt: windowEnd }],
    };
  }

  // Compute gaps: merge overlapping on-call intervals, find uncovered portions.
  const sorted = [...onCallShifts].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );

  const gaps: Array<{ startsAt: Date; endsAt: Date }> = [];
  let covered = windowStart.getTime();

  for (const s of sorted) {
    const sStart = s.startsAt.getTime();
    const sEnd = s.endsAt.getTime();
    if (sStart > covered) {
      gaps.push({ startsAt: new Date(covered), endsAt: new Date(sStart) });
    }
    if (sEnd > covered) covered = sEnd;
  }

  if (covered < windowEnd.getTime()) {
    gaps.push({ startsAt: new Date(covered), endsAt: windowEnd });
  }

  return {
    covered: gaps.length === 0,
    onCallShifts,
    gaps,
  };
}

/**
 * Validate a proposed assignment against the technician's availability.
 * All warnings are advisory — isValid is always true. Callers decide
 * whether to surface or act on any warning.
 */
async function validateAssignmentAgainstAvailability(
  companyId: string,
  technicianUserId: string,
  proposedStart: Date,
  proposedEnd: Date,
  companyTimezone: string,
  opts?: { excludeShiftId?: string },
): Promise<AssignmentValidation> {
  const conflicts = await resolveShiftConflicts(
    companyId,
    technicianUserId,
    proposedStart,
    proposedEnd,
    companyTimezone,
    { excludeShiftId: opts?.excludeShiftId },
  );

  const warnings: AssignmentWarning[] = [];

  // Advisory: tech has an unavailable block in this window.
  const unavailableConflicts = conflicts.filter((s) => s.shiftType === "unavailable");
  for (const s of unavailableConflicts) {
    warnings.push({ code: "UNAVAILABLE_CONFLICT", conflictingShift: s });
  }

  // Advisory: no normal shift covers this window.
  const normalShifts = conflicts.filter((s) => s.shiftType === "normal");
  if (normalShifts.length === 0) {
    warnings.push({ code: "OUTSIDE_SHIFT" });
  }

  // Advisory: no on-call coverage in window.
  const onCallCoverage = await resolveOnCallCoverage(
    companyId,
    proposedStart,
    proposedEnd,
    companyTimezone,
  );
  if (!onCallCoverage.covered && onCallCoverage.onCallShifts.length === 0) {
    warnings.push({ code: "NO_ONCALL_COVERAGE" });
  }

  return { isValid: true, warnings };
}

// ─── Exported service object ─────────────────────────────────────────────────

export const availabilityEngine = {
  resolveTechnicianShifts,
  resolveTechnicianAvailability,
  resolveShiftConflicts,
  resolveTimeOffBlocks,
  resolveOnCallCoverage,
  validateAssignmentAgainstAvailability,
};
