/**
 * Pure utility functions for the weekly schedule grid.
 * No React dependencies — safe to import in unit tests.
 */

export interface WeeklyHoursRow {
  dayOfWeek: number;
  startTime: string | null;
  endTime: string | null;
  isWorking: boolean;
}

/**
 * Fallback times injected when toggling a day to working with no existing
 * times. These satisfy server-side validation:
 *   workingHourEntrySchema.refine: isWorking=true requires startTime + endTime.
 * They are stored but never shown in the Phase 1 Working/Not Working UI.
 */
export const WORKING_DAY_DEFAULTS = {
  startTime: "08:00",
  endTime: "17:00",
} as const;

/**
 * Produce a full 7-day array (dayOfWeek 0–6) from a sparse saved list.
 * Missing days default to { isWorking: false, startTime: null, endTime: null }.
 */
export function initWeeklyHours(
  savedHours: WeeklyHoursRow[],
  allDays: number[],
): WeeklyHoursRow[] {
  const byDay = new Map(savedHours.map((h) => [h.dayOfWeek, h]));
  return allDays.map(
    (d) => byDay.get(d) ?? { dayOfWeek: d, startTime: null, endTime: null, isWorking: false },
  );
}

/**
 * Return a new hours array with the target day's isWorking flipped.
 *
 * Preservation rules:
 * - Toggling OFF: keeps existing startTime/endTime (server allows null times for
 *   non-working days; preserving avoids data loss when re-enabling the day).
 * - Toggling ON with existing times: preserves them as-is.
 * - Toggling ON with no times: injects WORKING_DAY_DEFAULTS so the server-side
 *   refine check (isWorking=true requires valid start + end) does not reject.
 */
export function toggleDayWorking(
  hours: WeeklyHoursRow[],
  dayOfWeek: number,
  isWorking: boolean,
): WeeklyHoursRow[] {
  return hours.map((h) => {
    if (h.dayOfWeek !== dayOfWeek) return h;
    if (isWorking && !h.startTime) {
      return { ...h, isWorking, ...WORKING_DAY_DEFAULTS };
    }
    return { ...h, isWorking };
  });
}
