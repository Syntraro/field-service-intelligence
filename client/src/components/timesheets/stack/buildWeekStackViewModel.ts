/**
 * Week Stack view-model adapter (experimental — 2026-05-04).
 *
 * Projects /api/admin/timesheets/week + (optionally) per-day work_sessions
 * minutes from /api/payroll/weekly into the chronological-rows shape that
 * `WeekStackPage` renders for weekly review.
 *
 * Contract:
 *   1. Each day's `rows` are chronological (ascending startAt).
 *   2. Consecutive time_entries with the same `jobId` collapse into ONE
 *      row. Drive-to-job + on-site entries for the same job surface as a
 *      single Job row whose duration is the sum of their durationMinutes.
 *      Per-type breakdown (drive / on-site / break) is intentionally NOT
 *      surfaced here — that detail belongs in Day View.
 *   3. Consecutive jobless entries (jobId === null — admin / break / other)
 *      collapse into ONE General Time row.
 *   4. "Unallocated" session minutes — `max(0, sessionMinutes - entriesTotal)`
 *      — surface as ONE synthetic General Time row inserted at the start
 *      of the day. This represents clocked-in time the technician did not
 *      log to any entry. We don't know exactly when the gaps occurred
 *      without per-session clock-in/out detail; surfacing them as a single
 *      leading row matches the canonical "clocked in at 8:00, started job
 *      at 8:30" example without inventing positional information.
 *   5. `day.totalMinutes === day.jobMinutes + day.generalMinutes`. Day total
 *      always equals the sum of visible row durations.
 *
 * Pure function. No fetching, no UI imports. Trivial to delete with the
 * page if the experiment is dropped.
 */

import { addDays, format, parseISO } from "date-fns";

export interface WeekStackEntry {
  id: string;
  jobId: string | null;
  jobNumber: number | null;
  jobSummary: string | null;
  locationName: string | null;
  type: string;
  startAt: string;
  endAt: string | null;
  durationMinutes: number | null;
  billable: boolean;
  date: string;
}

export type WeekStackRowKind = "job" | "general";

export interface WeekStackRow {
  key: string;
  kind: WeekStackRowKind;
  totalMinutes: number;
  /** Sortable epoch ms. The synthetic unallocated row uses the day's
   *  midnight so it always sorts to the top. */
  sortMs: number;
  /** Job rows: `jobId` populated. General rows: `jobId === null`. */
  jobId: string | null;
  jobNumber: number | null;
  jobSummary: string | null;
  locationName: string | null;
  /** Any underlying entry has `endAt === null` (still running). */
  hasOpenEntry: boolean;
  /** Number of underlying time_entries that contributed. 0 for the
   *  synthetic unallocated General Time row. */
  entryCount: number;
  /** Only true on the single synthetic row created from unallocated
   *  session minutes. Lets the UI render an explanatory subtitle. */
  isUnallocated: boolean;
}

export interface WeekStackDay {
  date: string;
  dayLabel: string;
  totalMinutes: number;
  jobMinutes: number;
  generalMinutes: number;
  /** Minutes from work_sessions for the day, if known. `null` when no
   *  session payload was supplied. */
  sessionMinutes: number | null;
  /** Sum of `time_entries.durationMinutes` for the day. */
  entriesMinutes: number;
  /** `max(0, sessionMinutes - entriesMinutes)` when session data exists,
   *  else 0. Surfaced for tests + tooltips. */
  unallocatedSessionMinutes: number;
  hasIssue: boolean;
  rows: WeekStackRow[];
}

export interface WeekStackViewModel {
  weekStart: string;
  weekDates: string[];
  days: WeekStackDay[];
  weekTotals: {
    totalMinutes: number;
    jobMinutes: number;
    generalMinutes: number;
  };
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function buildWeekStackViewModel({
  weekStart,
  entries,
  dailySessionMinutes,
}: {
  weekStart: string;
  entries: WeekStackEntry[];
  /** Optional per-day clocked-in minutes from work_sessions, keyed by
   *  `YYYY-MM-DD`. Days absent from the map fall back to entries-only
   *  totaling. */
  dailySessionMinutes?: Record<string, number>;
}): WeekStackViewModel {
  const monday = parseISO(weekStart);
  const weekDates = Array.from({ length: 7 }, (_, i) =>
    format(addDays(monday, i), "yyyy-MM-dd"),
  );

  const byDate = new Map<string, WeekStackEntry[]>();
  for (const e of entries) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date)!.push(e);
  }

  let totalWeekMinutes = 0;
  let jobWeekMinutes = 0;
  let generalWeekMinutes = 0;

  const days: WeekStackDay[] = weekDates.map((date, i) => {
    const dayEntries = (byDate.get(date) ?? [])
      .slice()
      .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));

    const rows: WeekStackRow[] = [];
    let cur: WeekStackRow | null = null;
    let entriesMinutes = 0;
    let dayJobMinutes = 0;
    let dayGeneralMinutes = 0;

    for (const e of dayEntries) {
      const m = e.durationMinutes ?? 0;
      entriesMinutes += m;
      const kind: WeekStackRowKind = e.jobId ? "job" : "general";

      if (cur !== null && cur.kind === kind && cur.jobId === e.jobId) {
        // Same-jobId run (or same general run) — collapse into the open row.
        cur.totalMinutes += m;
        cur.entryCount += 1;
        if (!e.endAt) cur.hasOpenEntry = true;
        if (cur.jobNumber == null && e.jobNumber != null) cur.jobNumber = e.jobNumber;
        if (!cur.jobSummary && e.jobSummary) cur.jobSummary = e.jobSummary;
        if (!cur.locationName && e.locationName) cur.locationName = e.locationName;
      } else {
        cur = {
          key: `${kind}-${e.id}`,
          kind,
          totalMinutes: m,
          sortMs: Date.parse(e.startAt),
          jobId: e.jobId,
          jobNumber: e.jobNumber,
          jobSummary: e.jobSummary,
          locationName: e.locationName,
          hasOpenEntry: !e.endAt,
          entryCount: 1,
          isUnallocated: false,
        };
        rows.push(cur);
      }

      if (kind === "job") dayJobMinutes += m;
      else dayGeneralMinutes += m;
    }

    const sessionMinutes = dailySessionMinutes?.[date] ?? null;
    const unallocated = sessionMinutes !== null
      ? Math.max(0, sessionMinutes - entriesMinutes)
      : 0;

    if (unallocated > 0) {
      // Synthetic General Time row at the top of the day. We use UTC midnight
      // for `sortMs` so the synthetic row always lands first chronologically
      // even if some real entry has an oddball pre-midnight startAt.
      const syntheticSortMs = parseISO(`${date}T00:00:00.000Z`).getTime();
      rows.unshift({
        key: `unallocated-${date}`,
        kind: "general",
        totalMinutes: unallocated,
        sortMs: syntheticSortMs,
        jobId: null,
        jobNumber: null,
        jobSummary: null,
        locationName: null,
        hasOpenEntry: false,
        entryCount: 0,
        isUnallocated: true,
      });
      dayGeneralMinutes += unallocated;
    }

    rows.sort((a, b) => a.sortMs - b.sortMs);

    const dayTotal = dayJobMinutes + dayGeneralMinutes;
    const hasIssue = rows.some((r) => r.hasOpenEntry);

    totalWeekMinutes += dayTotal;
    jobWeekMinutes += dayJobMinutes;
    generalWeekMinutes += dayGeneralMinutes;

    return {
      date,
      dayLabel: DAY_LABELS[i],
      totalMinutes: dayTotal,
      jobMinutes: dayJobMinutes,
      generalMinutes: dayGeneralMinutes,
      sessionMinutes,
      entriesMinutes,
      unallocatedSessionMinutes: unallocated,
      hasIssue,
      rows,
    };
  });

  return {
    weekStart,
    weekDates,
    days,
    weekTotals: {
      totalMinutes: totalWeekMinutes,
      jobMinutes: jobWeekMinutes,
      generalMinutes: generalWeekMinutes,
    },
  };
}

export function formatHm(minutes: number): string {
  if (minutes <= 0) return "0:00";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${m.toString().padStart(2, "0")}`;
}
