/**
 * Today's Capacity — per-technician open-slot computation for Dashboard.
 *
 * Canonical sources reused (no duplicate logic introduced):
 *   - Schedulable tech list:    filterSchedulableTechnicians()       (domain/scheduling)
 *   - Today's visits (blockers): schedulingRepository.getScheduledJobsInRange()
 *                                 (same source as GET /api/calendar + dispatch board)
 *   - Per-tech workday:          teamRepository.getWorkingHours()     (workingHours table)
 *   - Company-default workday:   businessHoursRepository.getCompanyBusinessHours()
 *   - Tech name resolution:      resolveTechnicianName()
 *
 * Output shape is tuned for the Dashboard's "Today's Capacity" card — one
 * primary open slot per tech plus a total-available-minutes figure for the
 * optional fit hint. We intentionally do NOT enumerate every micro-gap;
 * the UI needs a single crisp signal.
 *
 * Gap thresholds:
 *   - Ignore any gap < 30 minutes.
 *   - 30–89 min is a "limited_opening".
 *   - 90+ min is a "next_opening" or "open_now" depending on current time.
 */

import { schedulingRepository } from "./scheduling";
import { teamRepository } from "./team";
import { businessHoursRepository } from "./businessHours";
import { companyRepository } from "./company";
import {
  DEFAULT_TIMEZONE,
  filterSchedulableTechnicians,
  getStartOfDayInTimezone,
  getStartOfNextDayInTimezone,
} from "../domain/scheduling";
import { resolveTechnicianName } from "../lib/resolveTechnicianName";

const MIN_SLOT_MINUTES = 30;
/**
 * Minimum duration (minutes) for an Open row to appear inside the tech
 * tile's day-at-a-glance schedule. Independent of MIN_SLOT_MINUTES — this
 * threshold governs tile display only; finer ≥30min slots still power the
 * capacity state/summary logic above.
 */
const SCHEDULE_BLOCK_OPEN_THRESHOLD_MINUTES = 120;

export type CapacityState =
  | "open_now"
  | "next_opening"
  | "limited_opening"
  | "fully_open"
  | "fully_booked"
  | "day_over"
  | "off_today";

/**
 * One row inside the tech tile's day-at-a-glance schedule list.
 *
 * - `booked` → a scheduled (non-cancelled) visit. Includes completed visits
 *   so the tile still shows the full day even after shifts wrap up.
 * - `open`   → a gap between booked visits (or leading/trailing edge of the
 *   workday) that is at least SCHEDULE_BLOCK_OPEN_THRESHOLD_MINUTES long.
 *
 * Blocks are emitted in chronological order and clipped to the tech's
 * canonical workday bounds. No gap smaller than the threshold is shipped
 * to the client — filtering happens server-side so every consumer sees
 * the same "operationally meaningful" view.
 */
export interface ScheduleBlock {
  kind: "booked" | "open";
  startISO: string;
  endISO: string;
  durationMinutes: number;
  /** Customer/location label. Present on booked blocks only. */
  title?: string;
  /**
   * 2026-04-23: short job/visit description ("No heat", "Annual PM", etc.).
   * Sourced from jobs.summary with jobs.description as fallback; both are
   * already selected by schedulingRepository.getScheduledJobsInRange, so
   * no new join is introduced. Present on booked blocks only.
   */
  description?: string;
  /** Visit metadata for future click-through. Present on booked blocks only. */
  visitId?: string;
  jobId?: string;
  visitStatus?: string;
}

export interface TechnicianCapacity {
  technicianId: string;
  name: string;
  state: CapacityState;
  /** Primary open slot. null when state is fully_booked / day_over / off_today. */
  slot: { startISO: string; endISO: string; durationMinutes: number } | null;
  /** Total remaining available minutes today across ALL meaningful gaps (≥30min). */
  totalAvailableMinutes: number;
  /**
   * Count of meaningful (≥30min) remaining slots today. Lets the UI distinguish
   * "one clean block" (==1) from "fragmented day" (>1) without shipping per-gap
   * detail. fully_open → 1; fully_booked/day_over/off_today → 0.
   */
  meaningfulSlotCount: number;
  /** Full workday bounds today (so the UI can show "Fully open today · 8h available"). */
  workday: { startISO: string; endISO: string } | null;
  workdaySource: "custom" | "company";
  /**
   * Full-day schedule rows (booked visits + ≥120min open gaps) for the
   * tech tile. Empty when state === "off_today". Clipped to workday
   * bounds. Frontend renders this list verbatim.
   */
  scheduleBlocks: ScheduleBlock[];
  /** Count of booked visits today (non-cancelled, includes completed). */
  visitCount: number;
  /** Total scheduled/booked minutes today (sum of booked block durations). */
  bookedMinutes: number;
}

/**
 * Card-level aggregate for the Today's Capacity summary strip.
 *
 * Definitions (kept server-side so they can't drift across consumers):
 *
 *  - dispatchableNowCount: techs with state === "open_now" only. Pre-shift
 *    `fully_open` techs are NOT counted — they aren't on duty yet, so a
 *    dispatcher can't hand them a call "right now".
 *
 *  - isAnyOpenNow: convenience flag derived from dispatchableNowCount > 0.
 *    Lets the UI render "Earliest: Now" without re-inspecting states.
 *
 *  - earliestAvailabilityAt: earliest slot.startISO across techs whose
 *    state is one of open_now / fully_open / next_opening / limited_opening
 *    AND whose slot is non-null. null when no tech has any meaningful
 *    opening remaining today.
 *
 *  - totalMeaningfulAvailableMinutes: sum of per-tech totalAvailableMinutes.
 *    By construction, off_today / day_over / fully_booked contribute 0,
 *    and sub-30-minute gaps are already excluded upstream.
 *
 *  - techniciansWithRoomLaterCount: techs with meaningfulSlotCount > 0.
 *    Includes open_now, fully_open, next_opening, limited_opening.
 */
export interface CapacitySummary {
  dispatchableNowCount: number;
  isAnyOpenNow: boolean;
  earliestAvailabilityAt: string | null;
  totalMeaningfulAvailableMinutes: number;
  techniciansWithRoomLaterCount: number;
}

/**
 * Other-scheduled-visit row — a visit that the per-tech capacity grid
 * cannot place but that dispatch shows. Surfaced verbatim in the
 * dashboard's "Other scheduled visits" section so dispatchers see EVERY
 * scheduled visit on the board.
 *
 * 2026-05-04: introduced as a "scheduled-but-not-in-grid" bucket. A
 * visit lands here iff it produced ZERO entries in the schedulable
 * per-tech grid. That covers four origin cases, distinguished by
 * `technicianName`:
 *
 *   • disabled / non-schedulable tech → tech's resolved display name
 *     (or comma-joined names when multiple)
 *   • soft-deleted / platform-role user → `"Removed user"`
 *   • no assignee at all              → `"Unassigned"`
 *
 * Visits with at least one schedulable assignee never appear here —
 * they're already in the per-tech grid above.
 *
 * Capacity math (capacity %, available minutes, open slots, summary
 * aggregate) does NOT consider these rows; they are display-only.
 */
export interface OffRosterAssignment {
  visitId: string;
  jobId: string;
  /** Customer-facing label — customerCompanyName ?? locationName. */
  title: string;
  /** Customer company name when present (separate from `title` so the UI
   *  can format it independently). */
  companyName: string | null;
  /** Resolved label for the row. See interface doc-comment for the four
   *  origin cases and how they map to this string. */
  technicianName: string;
  scheduledStart: string;
  scheduledEnd: string;
  status: string;
}

interface Interval {
  start: number; // epoch ms
  end: number;
}

/** Parse "HH:MM" → minutes-from-midnight. Null when invalid/absent. */
function parseHHMM(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Interval[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

interface VisitForBlocks {
  start: number;
  end: number;
  title: string;
  description?: string;
  visitId: string;
  jobId: string;
  visitStatus: string;
}

/**
 * Emit one booked block per visit at the visit's REAL start/end (no
 * working-hours clipping). Outside-hours visits stay attached to the
 * tech's column at their actual time so dispatchers see every assigned
 * piece of work, regardless of whether it falls inside the configured
 * shift. Visits are emitted in chronological order. Overlaps are
 * preserved as separate blocks (dispatchers need to see overlaps as a
 * data-quality signal).
 *
 * 2026-05-04: split out of `buildScheduleBlocks` so booked emission no
 * longer shares a window with gap emission. Previously a single pass
 * clipped visits to the workday before emitting booked blocks, which
 * silently dropped any visit fully outside hours.
 */
function buildBookedBlocks(visits: VisitForBlocks[]): ScheduleBlock[] {
  const sorted = visits.slice().sort((a, b) => a.start - b.start || a.end - b.end);
  return sorted.map(v => ({
    kind: "booked",
    startISO: new Date(v.start).toISOString(),
    endISO: new Date(v.end).toISOString(),
    durationMinutes: Math.round((v.end - v.start) / 60_000),
    title: v.title,
    description: v.description,
    visitId: v.visitId,
    jobId: v.jobId,
    visitStatus: v.visitStatus,
  }));
}

/**
 * Emit Open blocks for gaps inside the configured workday only.
 *
 * Visits are clipped to `[workStartMs, workEndMs]` for the purposes of
 * "what blocks the workday" — a 5-6 PM visit when the workday ends at
 * 5 PM produces zero workday-clipped busy time, so it does NOT create
 * a fake open slot at 6 PM.
 *
 * Gaps shorter than SCHEDULE_BLOCK_OPEN_THRESHOLD_MINUTES are suppressed
 * (matching the prior behavior the dispatcher UI relies on). When there
 * are no busy-within-workday intervals, a single Open block covering
 * the whole workday is emitted (subject to the same threshold).
 *
 * 2026-05-04: split out of `buildScheduleBlocks`. The math is unchanged
 * from the prior single-pass version — only the input pruning that used
 * to drop outside-hours visits before they could become booked blocks
 * is gone (booked emission now lives in `buildBookedBlocks`).
 */
function buildOpenGapBlocks(
  workStartMs: number,
  workEndMs: number,
  visits: VisitForBlocks[],
): ScheduleBlock[] {
  if (workEndMs <= workStartMs) return [];
  const thresholdMs = SCHEDULE_BLOCK_OPEN_THRESHOLD_MINUTES * 60_000;
  const busy = mergeIntervals(
    visits
      .map(v => ({ start: Math.max(v.start, workStartMs), end: Math.min(v.end, workEndMs) }))
      .filter(v => v.end > v.start),
  );

  const out: ScheduleBlock[] = [];
  let cursor = workStartMs;
  for (const b of busy) {
    if (b.start - cursor >= thresholdMs) {
      out.push({
        kind: "open",
        startISO: new Date(cursor).toISOString(),
        endISO: new Date(b.start).toISOString(),
        durationMinutes: Math.round((b.start - cursor) / 60_000),
      });
    }
    cursor = Math.max(cursor, b.end);
  }
  if (workEndMs - cursor >= thresholdMs) {
    out.push({
      kind: "open",
      startISO: new Date(cursor).toISOString(),
      endISO: new Date(workEndMs).toISOString(),
      durationMinutes: Math.round((workEndMs - cursor) / 60_000),
    });
  }
  return out;
}

/**
 * Build the tech tile's chronological day view by merging two
 * independently-windowed passes:
 *
 *   • booked blocks → emitted at their REAL times via `buildBookedBlocks`.
 *     Visits outside the configured workday are kept; dispatchers still
 *     see assigned work scheduled before/after hours.
 *   • open gaps → derived from `buildOpenGapBlocks` against the workday
 *     window only. Outside-hours time never becomes an Open slot.
 *
 * The two streams are concatenated and sorted by start time. When two
 * blocks share a start, the booked block sorts first so the rendered
 * list reads as "booked at X, then open from Y" rather than the other
 * way around.
 *
 * Capacity math (`freeSlots`, `meaningfulSlotCount`, `totalAvailable
 * Minutes`, the summary aggregate) is computed elsewhere in the
 * per-tech loop and is unaffected by this refactor — it always read
 * `busyByTech` directly, never the schedule-block list.
 */
function buildScheduleBlocks(
  workStartMs: number,
  workEndMs: number,
  visits: VisitForBlocks[],
): ScheduleBlock[] {
  const booked = buildBookedBlocks(visits);
  const gaps = buildOpenGapBlocks(workStartMs, workEndMs, visits);
  return [...booked, ...gaps].sort((a, b) => {
    const aStart = Date.parse(a.startISO);
    const bStart = Date.parse(b.startISO);
    if (aStart !== bStart) return aStart - bStart;
    if (a.kind !== b.kind) return a.kind === "booked" ? -1 : 1;
    return Date.parse(a.endISO) - Date.parse(b.endISO);
  });
}

/** Subtract busy intervals from [windowStart, windowEnd], returning free slots (sorted). */
function freeSlots(
  windowStart: number,
  windowEnd: number,
  busy: Interval[],
): Interval[] {
  if (windowEnd <= windowStart) return [];
  const clipped = busy
    .map(b => ({ start: Math.max(b.start, windowStart), end: Math.min(b.end, windowEnd) }))
    .filter(b => b.end > b.start);
  const merged = mergeIntervals(clipped);
  const out: Interval[] = [];
  let cursor = windowStart;
  for (const b of merged) {
    if (b.start > cursor) out.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < windowEnd) out.push({ start: cursor, end: windowEnd });
  return out;
}

/**
 * Compute per-tech capacity for "today" in the COMPANY'S local timezone.
 *
 * Historical bug: prior to 2026-04-20 this used server-local midnight
 * (`new Date().setHours(0,0,0,0)`). Hosted servers run in UTC, so the
 * resulting `workStartMs` carried UTC wall-clock times (e.g. 9:00 AM UTC),
 * which the browser then re-rendered in its own local zone — producing
 * nonsensical rows like "4:00 AM – 1:00 PM · Open" for EST users. Fixed
 * by using the canonical `getCompanyTimezone()` + `getStartOfDayInTimezone()`
 * helpers already used by `/api/calendar`.
 *
 * @param companyId - Tenant ID.
 * @param now - Current time anchor (defaults to new Date()). Exposed for testability.
 * @param timezoneOverride - IANA TZ for testability. Defaults to the company's
 *                           configured timezone via companyRepository.
 */
export async function getTodayCapacity(
  companyId: string,
  now: Date = new Date(),
  timezoneOverride?: string,
): Promise<{
  generatedAt: string;
  /**
   * IANA timezone of the company. All times in `technicians[*].slot`,
   * `scheduleBlocks`, and `workday` are UTC ISO instants that correspond
   * to wall-clock times in THIS zone. Frontend must format them with
   * `{ timeZone: <this value> }` so users in other zones still see the
   * company-local time the dispatch board shows.
   */
  timezone: string;
  technicians: TechnicianCapacity[];
  summary: CapacitySummary;
  /**
   * Visits assigned to non-schedulable technicians (disabled OR
   * isSchedulable=false). Surfaced so Dashboard "Today's Schedule" can
   * render them in a labelled rollup — capacity math above DOES NOT
   * include these visits or their technicians.
   */
  offRosterAssignments: OffRosterAssignment[];
}> {
  // --- Day window (company-local day) -------------------------------------
  const timezone =
    timezoneOverride ?? (await companyRepository.getCompanyTimezone(companyId)) ?? DEFAULT_TIMEZONE;
  const dayStart = getStartOfDayInTimezone(now, timezone);
  const dayEnd = getStartOfNextDayInTimezone(now, timezone);

  // Day-of-week of "today" in the company's local calendar. Derived from
  // the company-local YMD (not from dayStart.getUTCDay() — that breaks for
  // positive UTC offsets where the UTC instant of local midnight lands on
  // the previous UTC day).
  const localYmdFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const ymdParts = localYmdFmt.formatToParts(now);
  const localY = Number(ymdParts.find(p => p.type === "year")?.value ?? "0");
  const localM = Number(ymdParts.find(p => p.type === "month")?.value ?? "1") - 1;
  const localD = Number(ymdParts.find(p => p.type === "day")?.value ?? "1");
  const dow = new Date(Date.UTC(localY, localM, localD)).getUTCDay(); // 0=Sun..6=Sat

  const nowMs = now.getTime();
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayEnd.getTime();

  // --- Canonical roster + schedules ---------------------------------------
  const members = await teamRepository.getTeamMembers(companyId);
  const { schedulable, excluded } = filterSchedulableTechnicians(members, "capacity:getTodayCapacity");

  // 2026-05-04: lookup tables for the secondary "Other scheduled visits"
  // bucket. The dashboard's per-tech grid only renders visits whose
  // assignee appears in `schedulable`. Anything else — disabled tech,
  // non-schedulable tech, soft-deleted user, platform-role user, or no
  // assignee at all — would silently disappear without a secondary
  // surface, even though dispatch shows the visit. We classify each
  // assignee ID into one of three buckets:
  //   • schedulable → drives the per-tech grid + capacity math
  //   • excluded   → surfaces in the secondary list with the tech name
  //   • orphaned   → surfaces in the secondary list as "Removed user"
  // (Unassigned visits are detected by an empty assignedTechnicianIds
  // array — no map lookup needed.)
  const schedulableIds = new Set(schedulable.map(m => m.id));
  const excludedTechNames = new Map<string, string>();
  for (const { user } of excluded) {
    excludedTechNames.set(user.id, resolveTechnicianName(user as any));
  }

  const [companyHours, ...perTechHours] = await Promise.all([
    businessHoursRepository.getCompanyBusinessHours(companyId),
    ...schedulable.map(m => teamRepository.getWorkingHours(m.id)),
  ]);

  const companyDay = companyHours.find(h => h.dayOfWeek === dow) ?? null;
  const companyWorkingToday = companyDay?.isOpen ?? false;
  const companyStartMin = companyDay?.startMinutes ?? null;
  const companyEndMin = companyDay?.endMinutes ?? null;

  // --- Today's visits (canonical query — same as calendar/dispatch) -------
  const todaysVisits = await schedulingRepository.getScheduledJobsInRange(
    companyId,
    dayStart,
    dayEnd,
  );

  // Build per-tech busy-interval map (for capacity gap math) AND a parallel
  // per-tech visit-metadata map (for schedule-block rendering). Different
  // inclusion rules:
  //   - busyByTech: excludes completed (already done — no longer blocking
  //     for "remaining capacity") AND cancelled.
  //   - visitsByTech: includes completed (tile shows the full day, past
  //     work included) but excludes cancelled.
  // Both skip all-day and visits missing scheduled end.
  interface VisitMeta {
    start: number;
    end: number;
    title: string;
    description?: string;
    visitId: string;
    jobId: string;
    visitStatus: string;
  }
  const busyByTech = new Map<string, Interval[]>();
  const visitsByTech = new Map<string, VisitMeta[]>();
  // 2026-05-04: secondary "Other scheduled visits" list. A visit lands
  // here iff it produced ZERO entries in the schedulable per-tech grid.
  // Cases covered:
  //   • Visit assigned to a disabled / non-schedulable tech only → tech name
  //   • Visit assigned to a soft-deleted / platform-role user only → "Removed user"
  //   • Visit with no assignee at all → "Unassigned"
  //   • Visit with mixed schedulable + non-schedulable assignees → grid only
  //     (the schedulable column already shows it; we don't double-list).
  // Capacity math (busyByTech / freeSlots / summary) only sees schedulable
  // assignees, so it is byte-for-byte identical to the pre-2026-05-04 code.
  const offRosterAssignments: OffRosterAssignment[] = [];
  for (const v of todaysVisits) {
    if (v.isAllDay) continue;
    if (v.visitStatus === "cancelled") continue;
    if (!v.scheduledStart) continue;
    const start = new Date(v.scheduledStart).getTime();
    // 2026-05-04: derive a fallback end for legacy rows that predate the
    // `normalizeVisitSchedule` write-side guard. New rows always carry a
    // valid `scheduledEnd > scheduledStart`; legacy rows may have
    // `scheduled_end IS NULL` and would otherwise be silently dropped
    // here (the original cause of the dispatch-vs-dashboard mismatch).
    // Fallback uses the office's `estimatedDurationMinutes`, defaulting
    // to 60 and floored at 30 — same rules the write-side guard applies.
    let end: number;
    if (v.scheduledEnd) {
      end = new Date(v.scheduledEnd).getTime();
    } else {
      const fallbackMin = Math.max(v.estimatedDurationMinutes ?? 60, 30);
      end = start + fallbackMin * 60_000;
    }
    if (!(end > start)) continue;
    const clippedStart = Math.max(start, dayStartMs);
    const clippedEnd = Math.min(end, dayEndMs);
    if (clippedEnd <= clippedStart) continue;
    const title = v.customerCompanyName ?? v.locationName ?? "Unassigned location";
    const description = (v.summary?.trim() || v.description?.trim()) || undefined;
    const meta: VisitMeta = {
      start: clippedStart,
      end: clippedEnd,
      title,
      description,
      visitId: v.visitId ?? v.id,
      jobId: v.jobId,
      visitStatus: v.visitStatus ?? "scheduled",
    };

    const techIds = v.assignedTechnicianIds ?? [];
    let placedInGrid = false;
    const excludedNames: string[] = [];
    let hasOrphanAssignee = false;

    for (const techId of techIds) {
      if (schedulableIds.has(techId)) {
        // Schedulable assignee → grid render + capacity math.
        const metaArr = visitsByTech.get(techId) ?? [];
        metaArr.push(meta);
        visitsByTech.set(techId, metaArr);
        // Completed visits don't block remaining capacity.
        if (v.visitStatus !== "completed") {
          const arr = busyByTech.get(techId) ?? [];
          arr.push({ start: clippedStart, end: clippedEnd });
          busyByTech.set(techId, arr);
        }
        placedInGrid = true;
        continue;
      }
      const excludedName = excludedTechNames.get(techId);
      if (excludedName !== undefined) {
        excludedNames.push(excludedName);
      } else {
        // ID is not in `members` at all — soft-deleted or platform-role.
        hasOrphanAssignee = true;
      }
    }

    if (placedInGrid) continue;

    // Visit produced zero schedulable grid entries → secondary list.
    let technicianName: string;
    if (excludedNames.length > 0) {
      // Multiple disabled assignees: comma-join so each off-roster
      // assignment is named.
      technicianName = excludedNames.join(", ");
    } else if (hasOrphanAssignee) {
      technicianName = "Removed user";
    } else {
      technicianName = "Unassigned";
    }

    offRosterAssignments.push({
      visitId: meta.visitId,
      jobId: meta.jobId,
      title,
      companyName: v.customerCompanyName ?? null,
      technicianName,
      scheduledStart: new Date(clippedStart).toISOString(),
      scheduledEnd: new Date(clippedEnd).toISOString(),
      status: meta.visitStatus,
    });
  }
  // Stable order for the UI: chronological by start, then by label.
  offRosterAssignments.sort((a, b) => {
    const t = Date.parse(a.scheduledStart) - Date.parse(b.scheduledStart);
    if (t !== 0) return t;
    return a.technicianName.localeCompare(b.technicianName);
  });

  // 2026-05-05 Lead Visits: pre-sales onsite appointments BLOCK
  // technician availability today (we don't want to double-book a
  // tech against a quote-bound onsite). They do NOT count as jobs:
  //   - DO add to busyByTech (gap math sees them).
  //   - DO NOT add to visitsByTech (visitCount + bookedMinutes stay
  //     job-only).
  //   - DO NOT add to scheduleBlocks (the tech tile lists job visits
  //     only — lead visits surface in dispatch separately).
  //   - DO NOT add to offRosterAssignments (lead visits assigned to
  //     non-schedulable users are dispatch's concern).
  // This keeps job KPIs / dashboard tiles untouched while the
  // booking math correctly reflects "this tech is busy at 2pm."
  const { listLeadVisitsInRange } = await import("./leadVisits");
  const todaysLeadVisits = await listLeadVisitsInRange(
    companyId,
    dayStart,
    dayEnd,
  );
  for (const lv of todaysLeadVisits) {
    if (lv.isAllDay) continue;
    if (lv.status === "cancelled" || lv.status === "completed") continue;
    if (!lv.scheduledStart) continue;
    const start = new Date(lv.scheduledStart).getTime();
    let end: number;
    if (lv.scheduledEnd) {
      end = new Date(lv.scheduledEnd).getTime();
    } else {
      const fallbackMin = Math.max(lv.estimatedDurationMinutes ?? 60, 30);
      end = start + fallbackMin * 60_000;
    }
    if (!(end > start)) continue;
    const clippedStart = Math.max(start, dayStartMs);
    const clippedEnd = Math.min(end, dayEndMs);
    if (clippedEnd <= clippedStart) continue;

    const techIds = lv.assignedTechnicianIds ?? [];
    for (const techId of techIds) {
      // Only schedulable techs feed the gap math — same rule used
      // for job visits above. Non-schedulable assignees are silently
      // skipped here (lead visits don't have an off-roster surface).
      if (!schedulableIds.has(techId)) continue;
      const arr = busyByTech.get(techId) ?? [];
      arr.push({ start: clippedStart, end: clippedEnd });
      busyByTech.set(techId, arr);
    }
  }

  // --- Per-tech capacity --------------------------------------------------
  const technicians: TechnicianCapacity[] = schedulable.map((member, idx) => {
    const name = resolveTechnicianName(member as any);
    const useCustom = (member as any).useCustomSchedule === true;
    const customHours = perTechHours[idx] ?? [];
    const customDay = useCustom ? customHours.find(h => h.dayOfWeek === dow) : undefined;

    let workStartMin: number | null = null;
    let workEndMin: number | null = null;
    let isWorking: boolean;
    let source: "custom" | "company";
    if (useCustom && customDay) {
      source = "custom";
      isWorking = !!customDay.isWorking;
      workStartMin = parseHHMM(customDay.startTime);
      workEndMin = parseHHMM(customDay.endTime);
    } else {
      source = "company";
      isWorking = companyWorkingToday;
      workStartMin = companyStartMin;
      workEndMin = companyEndMin;
    }

    const baseWorkday = (isWorking && workStartMin != null && workEndMin != null && workEndMin > workStartMin)
      ? {
          startISO: new Date(dayStartMs + workStartMin * 60_000).toISOString(),
          endISO: new Date(dayStartMs + workEndMin * 60_000).toISOString(),
        }
      : null;

    // --- Schedule blocks for tile (computed once, used by every return path).
    // off_today: empty. Every other state: blocks across [workStart, workEnd]
    // including past booked visits so the tile shows a full day-at-a-glance.
    const techVisits = visitsByTech.get(member.id) ?? [];
    const visitCount = techVisits.length;
    const bookedMinutes = techVisits.reduce(
      (acc, v) => acc + Math.round((v.end - v.start) / 60_000),
      0,
    );
    const hasValidWorkday =
      isWorking && workStartMin != null && workEndMin != null && workEndMin > workStartMin;

    // 2026-04-26 polish v6: schedule blocks now render for off-shift techs
    // who have assigned visits. The dashboard's "Today's Schedule" used to
    // show "No work" for these techs even though Dispatch Board showed the
    // job — accidental bookings became invisible to dispatchers. The
    // off_today state is preserved on the response so the client can label
    // the tech "(off shift)" while still rendering the blocks.
    const scheduleBlocks: ScheduleBlock[] = (() => {
      if (hasValidWorkday) {
        return buildScheduleBlocks(
          dayStartMs + workStartMin! * 60_000,
          dayStartMs + workEndMin! * 60_000,
          techVisits,
        );
      }
      if (techVisits.length === 0) return [];
      // No workday but there ARE assigned visits — derive a window from the
      // visits themselves (earliest start → latest end) so buildScheduleBlocks
      // has bounds. Clamp at the calendar day so a runaway visit doesn't
      // produce a malformed window.
      const minVisitStart = Math.min(...techVisits.map((v) => v.start));
      const maxVisitEnd = Math.max(...techVisits.map((v) => v.end));
      const dayEndMs = dayStartMs + 24 * 60 * 60_000;
      const windowStart = Math.max(dayStartMs, minVisitStart);
      const windowEnd = Math.min(dayEndMs, maxVisitEnd);
      if (windowEnd <= windowStart) return [];
      return buildScheduleBlocks(windowStart, windowEnd, techVisits);
    })();

    if (!hasValidWorkday) {
      return {
        technicianId: member.id,
        name,
        state: "off_today",
        slot: null,
        totalAvailableMinutes: 0,
        meaningfulSlotCount: 0,
        workday: baseWorkday,
        workdaySource: source,
        scheduleBlocks,
        visitCount,
        bookedMinutes,
      };
    }

    const workStartMs = dayStartMs + workStartMin! * 60_000;
    const workEndMs = dayStartMs + workEndMin! * 60_000;

    // Has the workday already ended?
    if (nowMs >= workEndMs) {
      return {
        technicianId: member.id,
        name,
        state: "day_over",
        slot: null,
        totalAvailableMinutes: 0,
        meaningfulSlotCount: 0,
        workday: baseWorkday,
        workdaySource: source,
        scheduleBlocks,
        visitCount,
        bookedMinutes,
      };
    }

    const busy = busyByTech.get(member.id) ?? [];
    const hasAnyBusy = busy.length > 0;

    // "Fully open today": no visits at all AND today not yet started (or
    // current time still at/before workday start).
    if (!hasAnyBusy && nowMs <= workStartMs) {
      const durationMinutes = Math.round((workEndMs - workStartMs) / 60_000);
      return {
        technicianId: member.id,
        name,
        state: "fully_open",
        slot: {
          startISO: new Date(workStartMs).toISOString(),
          endISO: new Date(workEndMs).toISOString(),
          durationMinutes,
        },
        totalAvailableMinutes: durationMinutes,
        meaningfulSlotCount: 1,
        workday: baseWorkday,
        workdaySource: source,
        scheduleBlocks,
        visitCount,
        bookedMinutes,
      };
    }

    // Compute free slots within [max(workStart, now), workEnd].
    const effectiveStart = Math.max(workStartMs, nowMs);
    const slots = freeSlots(effectiveStart, workEndMs, busy);
    const meaningful = slots.filter(s => (s.end - s.start) >= MIN_SLOT_MINUTES * 60_000);
    const totalAvailableMinutes = meaningful.reduce(
      (acc, s) => acc + Math.round((s.end - s.start) / 60_000),
      0,
    );

    if (meaningful.length === 0) {
      return {
        technicianId: member.id,
        name,
        state: "fully_booked",
        slot: null,
        totalAvailableMinutes: 0,
        meaningfulSlotCount: 0,
        workday: baseWorkday,
        workdaySource: source,
        scheduleBlocks,
        visitCount,
        bookedMinutes,
      };
    }

    const primary = meaningful[0];
    const primaryMinutes = Math.round((primary.end - primary.start) / 60_000);

    // Is the tech currently free? (now not inside any busy interval AND
    // now >= workStart AND the first meaningful slot starts now or earlier)
    const inBusyNow = busy.some(b => nowMs >= b.start && nowMs < b.end);
    const isOpenNow = !inBusyNow && nowMs >= workStartMs && primary.start <= nowMs + 60_000;

    let state: CapacityState;
    if (isOpenNow) {
      state = "open_now";
    } else if (primaryMinutes < 90) {
      state = "limited_opening";
    } else {
      state = "next_opening";
    }

    return {
      technicianId: member.id,
      name,
      state,
      slot: {
        startISO: new Date(primary.start).toISOString(),
        endISO: new Date(primary.end).toISOString(),
        durationMinutes: primaryMinutes,
      },
      totalAvailableMinutes,
      meaningfulSlotCount: meaningful.length,
      workday: baseWorkday,
      workdaySource: source,
      scheduleBlocks,
      visitCount,
      bookedMinutes,
    };
  });

  // Dispatcher-first sort:
  //   1. open_now              — immediately dispatchable; longest usable block first
  //   2. fully_open            — no visits + day hasn't started; most total time first
  //   3. next_opening          — currently busy but has a strong (≥90min) window later; soonest first
  //   4. limited_opening       — only <90min window remaining; soonest first
  //   5. fully_booked          — no room today
  //   6. day_over              — workday already over
  //   7. off_today             — not scheduled to work
  // Rationale: open_now is always the top dispatch target. fully_open beats
  // next_opening because a pre-shift tech with an entire empty day is more
  // flexible than one mid-day with a constrained window. Ties break by the
  // metric that matters for each state (usable block length for open/fully_
  // open, start time for next/limited) then by name for deterministic output.
  const stateRank: Record<CapacityState, number> = {
    open_now: 0,
    fully_open: 1,
    next_opening: 2,
    limited_opening: 3,
    fully_booked: 4,
    day_over: 5,
    off_today: 6,
  };
  technicians.sort((a, b) => {
    const r = stateRank[a.state] - stateRank[b.state];
    if (r !== 0) return r;
    if (a.state === "open_now" || a.state === "fully_open") {
      // Longer primary block first, then more total minutes, then name.
      const slotDiff = (b.slot?.durationMinutes ?? 0) - (a.slot?.durationMinutes ?? 0);
      if (slotDiff !== 0) return slotDiff;
      const totalDiff = b.totalAvailableMinutes - a.totalAvailableMinutes;
      if (totalDiff !== 0) return totalDiff;
    } else if (a.state === "next_opening" || a.state === "limited_opening") {
      // Soonest opening first.
      const aStart = a.slot ? Date.parse(a.slot.startISO) : Number.MAX_SAFE_INTEGER;
      const bStart = b.slot ? Date.parse(b.slot.startISO) : Number.MAX_SAFE_INTEGER;
      if (aStart !== bStart) return aStart - bStart;
    }
    return a.name.localeCompare(b.name);
  });

  // --- Card-level summary aggregate ---------------------------------------
  // Single O(n) pass over the (already-computed) per-tech list. Keeps the
  // summary definitions adjacent to the per-tech state definitions so they
  // can't drift. See CapacitySummary doc-comment for exact semantics.
  let dispatchableNowCount = 0;
  let totalMeaningfulAvailableMinutes = 0;
  let techniciansWithRoomLaterCount = 0;
  let earliestMs: number | null = null;
  const OPENING_STATES: CapacityState[] = ["open_now", "fully_open", "next_opening", "limited_opening"];
  for (const t of technicians) {
    if (t.state === "open_now") dispatchableNowCount++;
    totalMeaningfulAvailableMinutes += t.totalAvailableMinutes;
    if (t.meaningfulSlotCount > 0) techniciansWithRoomLaterCount++;
    if (t.slot && OPENING_STATES.includes(t.state)) {
      const startMs = Date.parse(t.slot.startISO);
      if (Number.isFinite(startMs) && (earliestMs === null || startMs < earliestMs)) {
        earliestMs = startMs;
      }
    }
  }

  const summary: CapacitySummary = {
    dispatchableNowCount,
    isAnyOpenNow: dispatchableNowCount > 0,
    earliestAvailabilityAt: earliestMs !== null ? new Date(earliestMs).toISOString() : null,
    totalMeaningfulAvailableMinutes,
    techniciansWithRoomLaterCount,
  };

  return { generatedAt: now.toISOString(), timezone, technicians, summary, offRosterAssignments };
}
