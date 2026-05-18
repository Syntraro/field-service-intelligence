/**
 * RRULE expansion utility — Technician Shift Management Phase 1.
 *
 * Pure, deterministic, no database access.
 * Only WEEKLY recurrence is supported (v1 scope).
 *
 * DST safety:
 *   All occurrence UTC bounds are resolved from (occurrence date, HH:MM,
 *   company timezone) using getDayUTCBounds, which anchors at noon UTC —
 *   never from a fixed offset of the base shift's starts_at. This ensures
 *   occurrence times remain wall-clock-correct across DST transitions.
 *
 * Overnight shifts:
 *   When time_of_day_end < time_of_day_start, the shift crosses midnight.
 *   The end is resolved against the NEXT calendar day's UTC bounds.
 *   occurrence_date is always the START date.
 *
 * DST fall-back note:
 *   When the clocks fall back, the repeated local hour uses the pre-
 *   transition offset (earlier / daylight interpretation). This is the
 *   correct interpretation for scheduling — the shift starts at the earlier
 *   wall-clock occurrence of that time.
 */
import { getDayUTCBounds, addCalendarDay } from "./dayBoundaries";
import { getStartOfDayInTimezone } from "../domain/scheduling";

/** BYDAY abbreviation to JS getDay() value (0=Sun…6=Sat). */
const BYDAY_TO_JS: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

/** JS getDay() value (0=Sun…6=Sat) back to BYDAY abbreviation. */
const JS_TO_BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

/** Days from Monday (Mon=0 … Sun=6) used for within-week ordering. */
const BYDAY_FROM_MONDAY: Record<string, number> = {
  MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6,
};

/**
 * Parse a simple RRULE string (FREQ=WEEKLY only) into components.
 * Returns null when the rule is not weekly or is unparsable.
 */
interface ParsedRRule {
  freq: "WEEKLY";
  interval: number;
  byday: string[];          // ["MO", "WE", "FR"]
  until: string | null;     // YYYY-MM-DD or null
  count: number | null;
}

function parseRRule(rrule: string): ParsedRRule | null {
  const parts: Record<string, string> = {};
  for (const seg of rrule.split(";")) {
    const eq = seg.indexOf("=");
    if (eq === -1) continue;
    parts[seg.slice(0, eq).trim().toUpperCase()] = seg.slice(eq + 1).trim();
  }

  const freq = parts["FREQ"]?.toUpperCase();

  // Normalise FREQ=DAILY (interval=1 only) to a FREQ=WEEKLY all-7-days rule
  // so the same expansion loop handles it without a separate code path.
  if (freq === "DAILY") {
    const interval = parts["INTERVAL"] ? parseInt(parts["INTERVAL"], 10) : 1;
    if (isNaN(interval) || interval !== 1) return null; // only daily supported
    let until: string | null = null;
    if (parts["UNTIL"]) {
      const raw = parts["UNTIL"].replace(/T.*$/, "");
      if (/^\d{8}$/.test(raw)) {
        until = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
      }
    }
    const count = parts["COUNT"] ? parseInt(parts["COUNT"], 10) : null;
    return {
      freq: "WEEKLY",
      interval: 1,
      byday: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"],
      until,
      count,
    };
  }

  if (freq !== "WEEKLY") return null;

  const interval = parts["INTERVAL"] ? parseInt(parts["INTERVAL"], 10) : 1;
  if (isNaN(interval) || interval < 1) return null;

  const bydayRaw = parts["BYDAY"] ?? "";
  const byday = bydayRaw
    .split(",")
    .map((d) => d.trim().toUpperCase())
    .filter((d) => d in BYDAY_TO_JS);
  // Empty byday is intentional: RFC 5545 says FREQ=WEEKLY with no BYDAY means
  // "repeat on the same day of week as DTSTART". expandRecurringShift handles this.

  let until: string | null = null;
  if (parts["UNTIL"]) {
    // UNTIL can be "YYYYMMDD" or "YYYYMMDDTHHmmssZ" — extract date portion.
    const raw = parts["UNTIL"].replace(/T.*$/, "");
    if (/^\d{8}$/.test(raw)) {
      until = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    }
  }

  const count = parts["COUNT"] ? parseInt(parts["COUNT"], 10) : null;

  return { freq: "WEEKLY", interval, byday, until, count };
}

/**
 * Format a Date to YYYY-MM-DD in the given IANA timezone.
 */
function formatDateInTz(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

/**
 * Parse HH:MM string to total minutes since midnight.
 */
function parseHHMM(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Resolve the UTC start/end instants for a single occurrence.
 *
 * DST-safe: resolves wall-clock times by offsetting from the day's UTC
 * midnight boundary — which getDayUTCBounds computes via a noon-UTC anchor.
 */
function resolveOccurrenceBounds(
  occDate: string,   // YYYY-MM-DD in company timezone
  allDay: boolean,
  timeOfDayStart: string | null,
  timeOfDayEnd: string | null,
  timezone: string,
): { startsAt: Date; endsAt: Date } {
  if (allDay || !timeOfDayStart || !timeOfDayEnd) {
    const { start, end } = getDayUTCBounds(occDate, timezone);
    return { startsAt: start, endsAt: end };
  }

  const dayBounds = getDayUTCBounds(occDate, timezone);
  const startMinutes = parseHHMM(timeOfDayStart);
  const endMinutes = parseHHMM(timeOfDayEnd);

  const startsAt = new Date(dayBounds.start.getTime() + startMinutes * 60_000);

  // Overnight: end time is earlier in the day than start time.
  let endsAt: Date;
  if (endMinutes < startMinutes) {
    // End crosses midnight — resolve against next calendar day.
    const nextDate = addCalendarDay(occDate);
    const nextDayBounds = getDayUTCBounds(nextDate, timezone);
    endsAt = new Date(nextDayBounds.start.getTime() + endMinutes * 60_000);
  } else {
    endsAt = new Date(dayBounds.start.getTime() + endMinutes * 60_000);
  }

  return { startsAt, endsAt };
}

/**
 * Get the Monday of the week containing the given date string (YYYY-MM-DD).
 * Returns a YYYY-MM-DD string for that Monday.
 */
function getMondayOfWeek(dateYmd: string): string {
  const [y, m, d] = dateYmd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0=Sun, 1=Mon … 6=Sat
  // Days to subtract to get to Monday: Mon=0, Tue=-1 … Sun=-6 → (dow+6)%7
  const daysFromMon = (dow + 6) % 7;
  const monday = new Date(dt.getTime() - daysFromMon * 86_400_000);
  return monday.toISOString().slice(0, 10);
}

/**
 * Get the day-of-week JS value (0=Sun … 6=Sat) for a YYYY-MM-DD string.
 */
function getDayOfWeek(dateYmd: string): number {
  const [y, m, d] = dateYmd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export interface ExpandedOccurrence {
  startsAt: Date;
  endsAt: Date;
  occurrenceDate: string; // YYYY-MM-DD in company timezone (always the start date)
}

/**
 * Expand a recurring shift into concrete occurrences within a UTC window.
 *
 * @param baseShift   - The base shift row (DB columns, camelCase)
 * @param windowStart - UTC start of the query window (inclusive)
 * @param windowEnd   - UTC end of the query window (exclusive)
 * @param companyTimezone - IANA timezone string
 * @param maxLookaheadDays - Safety cap; defaults to 365
 */
export function expandRecurringShift(
  baseShift: {
    startsAt: Date;
    endsAt: Date;
    allDay: boolean;
    timeOfDayStart: string | null;
    timeOfDayEnd: string | null;
    recurrenceRule: string;
    recurrenceEndDate: string | null; // YYYY-MM-DD in company tz
  },
  windowStart: Date,
  windowEnd: Date,
  companyTimezone: string,
  maxLookaheadDays = 365,
): ExpandedOccurrence[] {
  const parsed = parseRRule(baseShift.recurrenceRule);
  if (!parsed) return [];

  // DTSTART: base shift's start date in company timezone.
  const dtStartDate = formatDateInTz(baseShift.startsAt, companyTimezone);

  // Window dates in company timezone.
  const windowStartDate = formatDateInTz(windowStart, companyTimezone);
  const windowEndDate = formatDateInTz(windowEnd, companyTimezone);

  // Maximum end date: min of recurrenceEndDate, UNTIL, windowEndDate, today+maxLookaheadDays.
  const todayPlus = addCalendarDay(
    formatDateInTz(new Date(), companyTimezone),
    maxLookaheadDays,
  );
  const candidates = [windowEndDate, todayPlus];
  if (baseShift.recurrenceEndDate) candidates.push(baseShift.recurrenceEndDate);
  if (parsed.until) candidates.push(parsed.until);
  const maxEndDate = candidates.reduce((a, b) => (a < b ? a : b));

  // RFC 5545: FREQ=WEEKLY with no BYDAY means "repeat on the same day-of-week as DTSTART".
  const effectiveByday =
    parsed.byday.length > 0
      ? parsed.byday
      : [JS_TO_BYDAY[getDayOfWeek(dtStartDate)]];

  // Sort BYDAY by days-from-Monday so we emit occurrences in order within a week.
  const sortedByday = [...effectiveByday].sort(
    (a, b) => (BYDAY_FROM_MONDAY[a] ?? 0) - (BYDAY_FROM_MONDAY[b] ?? 0),
  );

  const results: ExpandedOccurrence[] = [];
  let countEmitted = 0;

  // Start from the Monday of DTSTART's week and step by interval weeks.
  let weekMonday = getMondayOfWeek(dtStartDate);

  while (weekMonday <= maxEndDate) {
    for (const day of sortedByday) {
      const jsDay = BYDAY_TO_JS[day];
      // Monday of this week has getUTCDay() === 1.
      const mondayJsDay = 1;
      const daysOffset = (jsDay - mondayJsDay + 7) % 7;
      const occDate = addCalendarDay(weekMonday, daysOffset);

      // Skip occurrences before DTSTART.
      if (occDate < dtStartDate) continue;
      // Stop if past max end.
      if (occDate > maxEndDate) continue;

      // Apply COUNT limit.
      if (parsed.count !== null && countEmitted >= parsed.count) {
        return results;
      }

      // Count this occurrence regardless of window — COUNT applies to
      // all occurrences, not just those in the query window.
      countEmitted++;

      // Emit only if this occurrence overlaps the query window.
      if (occDate >= windowStartDate && occDate <= windowEndDate) {
        const { startsAt, endsAt } = resolveOccurrenceBounds(
          occDate,
          baseShift.allDay,
          baseShift.timeOfDayStart,
          baseShift.timeOfDayEnd,
          companyTimezone,
        );

        // Final UTC overlap check with the query window.
        if (startsAt < windowEnd && endsAt > windowStart) {
          results.push({ startsAt, endsAt, occurrenceDate: occDate });
        }
      }
    }

    // Advance by INTERVAL weeks.
    weekMonday = addCalendarDay(weekMonday, parsed.interval * 7);
  }

  return results;
}
