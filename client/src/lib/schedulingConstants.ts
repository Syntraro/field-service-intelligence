/**
 * Canonical Scheduling Constants
 *
 * SINGLE SOURCE OF TRUTH for duration options and day-of-week labels
 * used across scheduling, dispatch, recurring jobs, and team management surfaces.
 *
 * All consumers must import from this module instead of defining locally.
 *
 * 2026-04-08: Extracted from QuickAddJobDialog, JobScheduleFields,
 * DispatchDetailPanel, RecurringJobsPage, and TeamMemberDetail.
 */

// ============================================================================
// Duration options
// ============================================================================

/**
 * Standard duration values in minutes.
 * Used by dispatch (raw numbers + formatDuration) and scheduling forms.
 * Superset: includes all values from all surfaces.
 */
export const DURATION_MINUTES: number[] = [15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480];

/**
 * Duration options with abbreviated labels (for compact forms/dialogs).
 * Subset: 9 most common values for job creation forms.
 */
export const DURATION_OPTIONS_SHORT = [
  { value: 15, label: "15m" },
  { value: 30, label: "30m" },
  { value: 45, label: "45m" },
  { value: 60, label: "1h" },
  { value: 90, label: "1.5h" },
  { value: 120, label: "2h" },
  { value: 180, label: "3h" },
  { value: 240, label: "4h" },
  { value: 480, label: "8h" },
] as const;

/**
 * Duration options with verbose labels (for schedule detail fields).
 */
export const DURATION_OPTIONS_LONG = [
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 45, label: "45 min" },
  { value: 60, label: "1 hour" },
  { value: 90, label: "1.5 hours" },
  { value: 120, label: "2 hours" },
  { value: 180, label: "3 hours" },
  { value: 240, label: "4 hours" },
  { value: 480, label: "8 hours" },
] as const;

// ============================================================================
// Time-of-day options (15-minute granularity)
// ============================================================================

/**
 * Lazy-built canonical time options. 96 entries, every 15 minutes from
 * 00:00 to 23:45. `value` is "HH:mm" (matches `<input type="time">`),
 * `label` is the user-facing 12-hour display ("9:00 AM").
 *
 * 2026-04-26: extracted from JobScheduleFields so the QuickAddJobDialog's
 * compact schedule row can use the same dropdown — eliminates the native
 * `<input type="time">` inconsistency the redesigned Create New modal
 * surfaces side-by-side with date / duration / assignee.
 */
function buildTimeOptions(): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const period = h < 12 ? "AM" : "PM";
      const hour12 = h % 12 === 0 ? 12 : h % 12;
      const label = `${hour12}:${String(m).padStart(2, "0")} ${period}`;
      out.push({ value, label });
    }
  }
  return out;
}

export const TIME_OPTIONS_15MIN: ReadonlyArray<{ value: string; label: string }> = buildTimeOptions();

// ============================================================================
// Smart scheduling defaults (2026-04-26)
// ============================================================================

/** Granularity for time pickers and rounding. Matches TIME_OPTIONS_15MIN. */
export const SCHEDULING_INTERVAL_MINUTES = 15;

/**
 * Granularity for the "today" smart-default rounding. Matches what dispatchers
 * verbally pick when scheduling on the fly — "let's start at 9 PM," not
 * "let's start at 8:45 PM" — so 8:41 PM defaults to 9:00 PM, 8:01 PM defaults
 * to 9:00 PM, and 9:00 PM exactly stays 9:00 PM.
 *
 * The time picker still snaps to SCHEDULING_INTERVAL_MINUTES (15) — this
 * coarser value applies only to the auto-default.
 */
export const SMART_DEFAULT_ROUNDING_MINUTES = 60;

/** Fallback "start of business day" for default times when target date isn't today. */
export const BUSINESS_DAY_START_TIME = "09:00";

/**
 * Round a wall-clock time UP to the next scheduling interval.
 * Example: (20, 41) at 15-min interval → "21:00" (no nextDay).
 * Wraps to "00:00" with `nextDay: true` when rounding crosses midnight.
 */
export function roundUpTimeToInterval(
  hours: number,
  minutes: number,
  intervalMinutes: number = SCHEDULING_INTERVAL_MINUTES,
): { time: string; nextDay: boolean } {
  const total = hours * 60 + minutes;
  const remainder = total % intervalMinutes;
  const rounded = remainder === 0 ? total : total + (intervalMinutes - remainder);
  if (rounded >= 24 * 60) return { time: "00:00", nextDay: true };
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return {
    time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
    nextDay: false,
  };
}

/**
 * Wall-clock parts of `now` in the given IANA timezone. Falls back to browser
 * local when timezone is empty/invalid — keeps old browsers and Intl-stripped
 * test envs from throwing. Returns YYYY-MM-DD + 24-hour hours/minutes.
 */
export function getWallClockInTimezone(
  now: Date,
  timezone?: string | null,
): { ymd: string; hours: number; minutes: number } {
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(now);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
      const y = get("year");
      const mo = get("month");
      const d = get("day");
      const rawH = Number(get("hour"));
      const mn = Number(get("minute"));
      // Some Intl runtimes emit "24" for midnight. Normalize.
      const hours = rawH === 24 ? 0 : rawH;
      if (y && mo && d && Number.isFinite(hours) && Number.isFinite(mn)) {
        return { ymd: `${y}-${mo}-${d}`, hours, minutes: mn };
      }
    } catch {
      /* fall through to browser local */
    }
  }
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return { ymd: `${y}-${mo}-${d}`, hours: now.getHours(), minutes: now.getMinutes() };
}

/**
 * Smart default {date, time} for "Create Job" forms.
 *
 * - Target date matches today (in company tz): time = current wall-clock
 *   rounded UP to the next scheduling interval. So "today" jobs created
 *   late in the day default to a workable upcoming slot, not 9 AM.
 *   When rounding crosses midnight, advances `date` by one day and uses
 *   the business-day default time.
 * - Target date is in the future (or absent): time = business default.
 *
 * Pure function — no side effects, no toasts. Caller decides how to apply.
 */
export function getSmartScheduleDefault(options?: {
  /** YYYY-MM-DD the user has selected. Defaults to "today" in tz. */
  targetDateYmd?: string;
  /** Now anchor. Defaults to new Date(). */
  now?: Date;
  /** Company IANA timezone. Falls back to browser local when absent. */
  timezone?: string | null;
  /** Override for the rounding interval. Default SMART_DEFAULT_ROUNDING_MINUTES
   *  (60) — matches the spec example "8:41 PM → 9:00 PM." Pass a smaller
   *  value to round to a tighter grid. */
  intervalMinutes?: number;
  /** Override for the business-day fallback. */
  businessStart?: string;
}): { date: string; time: string } {
  const now = options?.now ?? new Date();
  const interval = options?.intervalMinutes ?? SMART_DEFAULT_ROUNDING_MINUTES;
  const business = options?.businessStart ?? BUSINESS_DAY_START_TIME;
  const wall = getWallClockInTimezone(now, options?.timezone ?? null);
  const target = options?.targetDateYmd ?? wall.ymd;

  if (target !== wall.ymd) {
    return { date: target, time: business };
  }

  const { time, nextDay } = roundUpTimeToInterval(wall.hours, wall.minutes, interval);
  if (nextDay) {
    const [y, mo, d] = target.split("-").map(Number);
    const advanced = new Date(Date.UTC(y, (mo ?? 1) - 1, (d ?? 1) + 1));
    const ymd = `${advanced.getUTCFullYear()}-${String(advanced.getUTCMonth() + 1).padStart(2, "0")}-${String(advanced.getUTCDate()).padStart(2, "0")}`;
    return { date: ymd, time: business };
  }
  return { date: target, time };
}

// ============================================================================
// Day-of-week labels
// ============================================================================

/**
 * Days of week with abbreviated labels (0=Sunday).
 */
export const DAYS_OF_WEEK_SHORT = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
] as const;

/**
 * Days of week with full labels (0=Sunday).
 */
export const DAYS_OF_WEEK_FULL = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const;
