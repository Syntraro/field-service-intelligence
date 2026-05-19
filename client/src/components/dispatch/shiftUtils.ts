/**
 * shiftUtils — pure utility functions for technician shift processing.
 * No React, no hooks, no side-effects. Safe to unit-test directly.
 *
 * Used by dispatchDataCore and DispatchPreview to partition, map,
 * and query shift entries fetched from /api/shift-management/availability.
 */
import type { DispatchShiftEntry } from "./dispatchPreviewTypes";

/** Standard interval overlap: a.start < b.end AND a.end > b.start */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/** Split a flat shift array into 3 typed buckets. */
export function partitionShifts(shifts: DispatchShiftEntry[]): {
  normal: DispatchShiftEntry[];
  onCall: DispatchShiftEntry[];
  unavailable: DispatchShiftEntry[];
} {
  return {
    normal: shifts.filter((s) => s.shiftType === "normal"),
    onCall: shifts.filter((s) => s.shiftType === "on_call"),
    unavailable: shifts.filter((s) => s.shiftType === "unavailable"),
  };
}

/** Build a per-tech map from a flat shift array. */
export function buildShiftsByTech(
  shifts: DispatchShiftEntry[],
): Map<string, DispatchShiftEntry[]> {
  const m = new Map<string, DispatchShiftEntry[]>();
  for (const s of shifts) {
    const arr = m.get(s.technicianUserId) ?? [];
    arr.push(s);
    m.set(s.technicianUserId, arr);
  }
  return m;
}

/**
 * Find all shift entries from a per-tech map that overlap [startISO, endISO).
 * Returns empty array when inputs are invalid or no overlap found.
 */
export function findOverlappingShifts(
  shiftsByTech: Map<string, DispatchShiftEntry[]>,
  techIds: string[],
  startISO: string,
  endISO: string,
): DispatchShiftEntry[] {
  if (!techIds.length) return [];
  const startMs = Date.parse(startISO);
  const endMs = Date.parse(endISO);
  if (!isFinite(startMs) || !isFinite(endMs) || endMs <= startMs) return [];

  const matches: DispatchShiftEntry[] = [];
  for (const techId of techIds) {
    const list = shiftsByTech.get(techId) ?? [];
    for (const shift of list) {
      const sStart = Date.parse(shift.startsAt);
      const sEnd = Date.parse(shift.endsAt);
      if (overlaps(sStart, sEnd, startMs, endMs)) {
        matches.push(shift);
      }
    }
  }
  return matches;
}

/**
 * Returns true if the tech has at least one normal shift whose time window
 * overlaps [startISO, endISO). Used for the outside-shift advisory check.
 */
export function hasNormalShiftCovering(
  normalShiftsByTech: Map<string, DispatchShiftEntry[]>,
  techId: string,
  startISO: string,
  endISO: string,
): boolean {
  const startMs = Date.parse(startISO);
  const endMs = Date.parse(endISO);
  if (!isFinite(startMs) || !isFinite(endMs)) return false;
  const shifts = normalShiftsByTech.get(techId) ?? [];
  return shifts.some((s) => overlaps(Date.parse(s.startsAt), Date.parse(s.endsAt), startMs, endMs));
}

/**
 * Returns true if the sequence end time (endISO) falls within at least one of
 * the technician's normal shift windows. Used to warn when a same-cell Board
 * reorder pushes visits past the end of the tech's scheduled shift.
 *
 * Safe to call when shift data is unavailable — returns true (no warning) when
 * endISO cannot be parsed or when no normal shifts exist for the tech.
 */
export function isSequenceWithinShiftHours(
  normalShiftsByTech: Map<string, DispatchShiftEntry[]>,
  techId: string,
  _startISO: string,
  endISO: string,
): boolean {
  const endMs = Date.parse(endISO);
  if (!isFinite(endMs)) return true;
  const shifts = normalShiftsByTech.get(techId) ?? [];
  if (shifts.length === 0) return true; // no shift data → no warning
  return shifts.some(s => {
    const sStart = Date.parse(s.startsAt);
    const sEnd   = Date.parse(s.endsAt);
    return sStart <= endMs && endMs <= sEnd;
  });
}

/**
 * Returns true if the tech has any normal shift entry on the given date
 * (YYYY-MM-DD in company timezone). Recurring shifts use their occurrenceDate;
 * one-off shifts are matched against their UTC startsAt date.
 */
export function isTechShiftedOnDate(
  normalShiftsByTech: Map<string, DispatchShiftEntry[]>,
  techId: string,
  dateStr: string, // YYYY-MM-DD
): boolean {
  const shifts = normalShiftsByTech.get(techId) ?? [];
  return shifts.some((s) => {
    if (s.occurrenceDate) return s.occurrenceDate === dateStr;
    // One-off: approximate by UTC start date
    return s.startsAt.slice(0, 10) === dateStr;
  });
}
