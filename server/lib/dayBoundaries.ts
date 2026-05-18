/**
 * UTC day-boundary utility (2026-05-17 Phase 3 Team Schedule).
 *
 * Single canonical source for converting YYYY-MM-DD calendar dates to
 * UTC Date bounds in a company's IANA timezone.
 *
 * DST-safety: every boundary is computed by anchoring at noon UTC of the
 * target calendar day. Noon UTC is always unambiguous (no timezone has an
 * offset larger than ±14h, so noon UTC is still "the same local day" in
 * every timezone). The end-of-day bound is computed as the *start* of the
 * NEXT calendar day — NOT as "start-of-day + 24h" — so 23-hour (spring-
 * forward) and 25-hour (fall-back) days are handled correctly.
 *
 * This resolves the known DST limitation of getStartOfNextDayInTimezone()
 * which adds a fixed 24h and is used in capacity.ts for backwards
 * compatibility with existing callers. New code must use this module.
 */
import { getStartOfDayInTimezone } from "../domain/scheduling";

/** Add `n` calendar days to a YYYY-MM-DD string. UTC-based arithmetic
 *  so it's timezone-independent. */
export function addCalendarDay(dateYmd: string, n = 1): string {
  const [y, m, d] = dateYmd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** Generate every YYYY-MM-DD in [startYmd, endYmd] inclusive, sorted
 *  ascending. Returns an empty array when start > end. */
export function datesInRange(startYmd: string, endYmd: string): string[] {
  const dates: string[] = [];
  let cur = startYmd;
  while (cur <= endYmd) {
    dates.push(cur);
    cur = addCalendarDay(cur);
  }
  return dates;
}

/** UTC midnight bounds for a single YYYY-MM-DD in the given timezone.
 *
 *  Returns:
 *    start  — midnight local ≡ UTC start of that local calendar day
 *    end    — midnight local next day ≡ UTC start of next calendar day
 *
 *  The half-open interval [start, end) is correct for the standard
 *  overlap predicate: `row.startsAt < end AND row.endsAt > start`. */
export function getDayUTCBounds(
  dateYmd: string,
  timezone: string,
): { start: Date; end: Date } {
  const anchor = new Date(dateYmd + "T12:00:00Z");
  const start = getStartOfDayInTimezone(anchor, timezone);

  const nextAnchor = new Date(addCalendarDay(dateYmd) + "T12:00:00Z");
  const end = getStartOfDayInTimezone(nextAnchor, timezone);

  return { start, end };
}

/** Pre-compute UTC bounds for every date in [startYmd, endYmd].
 *  Returns a Map<YYYY-MM-DD, { start, end }> for O(1) per-day lookup. */
export function buildDayBoundsMap(
  startYmd: string,
  endYmd: string,
  timezone: string,
): Map<string, { start: Date; end: Date }> {
  const map = new Map<string, { start: Date; end: Date }>();
  for (const date of datesInRange(startYmd, endYmd)) {
    map.set(date, getDayUTCBounds(date, timezone));
  }
  return map;
}

/** UTC bounds for the entire date range: start of startYmd … end of endYmd.
 *  Used as the window for a single time-off overlap query covering all days. */
export function getRangeUTCBounds(
  startYmd: string,
  endYmd: string,
  timezone: string,
): { rangeStart: Date; rangeEnd: Date } {
  const { start: rangeStart } = getDayUTCBounds(startYmd, timezone);
  const { end: rangeEnd } = getDayUTCBounds(endYmd, timezone);
  return { rangeStart, rangeEnd };
}
