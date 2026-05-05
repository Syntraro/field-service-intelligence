/**
 * timeBlockAdapter — view-model adapter from canonical `time_entries`
 * shape (returned by `GET /api/admin/timesheets/week`) into the
 * Week Timeline's `TimeBlock` rendering model (2026-05-04).
 *
 * Iteration 1 scope:
 *   • READ-ONLY adapter — no schema, no new endpoint, no mutation.
 *   • The brief's `TimeBlock` type is a UI shape only; the persistence
 *     layer remains `time_entries`.
 *   • Bucketing reuses the canonical `categoryForType` helper from
 *     the DayView's `categoryMap.ts` so the Week Timeline and Day View
 *     never disagree on what counts as drive vs on-site vs general.
 *   • `unassigned` blocks are NOT materialized here — gaps between
 *     consecutive blocks within the day are implicit (rendered as
 *     empty space in the timeline strip). A future iteration can add
 *     explicit unassigned blocks if the editor needs them.
 *
 * Tenant scope: not the adapter's concern. The server query is already
 * tenant-scoped via `req.companyId` on the route handler.
 */

import {
  categoryForType,
  type EntryCategory,
} from "../categoryMap";

// ─── Public types ───────────────────────────────────────────────────────────

/**
 * Minimum subset of fields the Week endpoint guarantees per entry.
 * Wider than what the timeline reads — extra keys are ignored. Documented
 * inline so the next reader can match the response shape at a glance.
 */
export interface WeekTimesheetEntry {
  id: string;
  technicianId: string;
  jobId: string | null;
  visitId: string | null;
  taskId?: string | null;
  type: string;
  startAt: string | Date;
  endAt: string | Date | null;
  durationMinutes: number | null;
  billable: boolean;
  notes: string | null;
  jobNumber: number | null;
  jobSummary: string | null;
  locationName: string | null;
  /** YYYY-MM-DD bucket the server already derived from startAt. */
  date: string;
}

/**
 * UI rendering shape for a single block on the timeline strip. Mirrors
 * the "TimeBlock" the brief described, narrowed to what the read-only
 * MVP needs.
 */
export interface TimeBlock {
  /** Underlying time_entries.id — not synthesised. */
  id: string;
  /** YYYY-MM-DD bucket. */
  date: string;
  /** ISO timestamp. */
  start: string;
  /** ISO timestamp. NULL for running entries (not rendered as a block). */
  end: string;
  /** Minutes between start/end — recomputed locally to defend against
   *  any server-side null/drift on durationMinutes. */
  durationMinutes: number;
  /** UI category — `drive` / `onsite` / `general` — from canonical
   *  categoryMap. The brief's "unassigned" is reserved for explicit
   *  blocks; gaps are implicit. */
  category: EntryCategory;
  /** Original `time_entries.type` value. Preserved so a future editor
   *  can round-trip the finer-grained enum without flattening. */
  rawType: string;
  /** Rendering metadata — read-only display strings. */
  jobId: string | null;
  visitId: string | null;
  jobNumber: number | null;
  jobSummary: string | null;
  locationName: string | null;
  notes: string | null;
  billable: boolean;
}

/**
 * Grouped display block — one VISIBLE card on the week timeline that
 * represents one or more raw `TimeBlock`s related to the same
 * job/visit/day (drive + on-site + admin time at the same site,
 * collapsed into a single card with summed duration).
 *
 * Raw entries are NEVER mutated. Groups are a render-time projection.
 *
 * Grouping key (decided in `groupBlocksForDay`):
 *   • If `jobId` is present:  `${date}|${jobId}|${visitId ?? ""}`
 *   • If `jobId` is null:     each entry stays its own group
 *     (general / admin / break / unrelated supplier-run time has no
 *      meaningful "site context" to share with a sibling entry).
 *
 * Time math:
 *   • `start` — earliest member's start
 *   • `end`   — latest member's end
 *   • `durationMinutes` — SUM of member durations (NOT end - start;
 *     gaps between entries don't count as worked time).
 *   • `category` — predominant category (most-minutes wins). Color is
 *     the only category signal in the visible card; the breakdown
 *     stays in the tooltip + the header pills.
 *   • `isMixedCategory` — true when the group spans more than one
 *     category. Lets the tooltip render "Drive 45m + On-site 29m"
 *     instead of a single label.
 *   • `billable` — OR over members. A non-billable member shouldn't
 *     dim the entire group if a billable member is present.
 *
 * `members` retains the raw blocks so a future drill-down (or the
 * tooltip composer) can show the breakdown without re-querying.
 */
export interface TimeBlockGroup {
  /** Synthesised id — singleton groups reuse the lone block's id;
   *  multi-member groups use `group-${id1}+${id2}+…` for stability. */
  id: string;
  date: string;
  start: string;
  end: string;
  durationMinutes: number;
  category: EntryCategory;
  isMixedCategory: boolean;
  jobId: string | null;
  visitId: string | null;
  jobNumber: number | null;
  jobSummary: string | null;
  locationName: string | null;
  billable: boolean;
  members: TimeBlock[];
  /** Per-category breakdown within this group — minutes. */
  memberCategoryMinutes: Record<EntryCategory, number>;
}

export interface DayTimeline {
  /** YYYY-MM-DD. */
  date: string;
  /** Mon → Sun within the queried week. */
  dayIndex: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** Raw per-entry blocks for this day, sorted ASC by start. Preserved
   *  so the per-category breakdown (`byCategory`) and downstream
   *  consumers that need entry-level granularity (audit, drill-down)
   *  still see one entry-per-block. The week timeline UI does NOT
   *  render this — it renders `groups` below. */
  blocks: TimeBlock[];
  /** Visible cards for this day's strip — `blocks` collapsed by
   *  (date, jobId, visitId). Sorted ASC by start. */
  groups: TimeBlockGroup[];
  /** Sum of every block's duration on this day (minutes). */
  totalMinutes: number;
  /** Per-category breakdown (minutes) — sourced from RAW blocks so
   *  the header pills preserve drive vs on-site vs general totals
   *  exactly, regardless of how blocks group visually. */
  byCategory: Record<EntryCategory, number>;
  /** First block's start timestamp (ISO) — null if no blocks. */
  earliestStart: string | null;
  /** Last block's end timestamp (ISO) — null if no blocks. */
  latestEnd: string | null;
  /** Pairs of block ids that overlap (for the warning indicator). */
  overlaps: Array<[string, string]>;
}

export interface WeekTotals {
  totalMinutes: number;
  byCategory: Record<EntryCategory, number>;
  /** Per-day total minutes — index aligned with `days[i].dayIndex`. */
  perDayMinutes: number[];
}

export interface WeekTimelineViewModel {
  weekStart: string;
  userId: string;
  days: DayTimeline[];
  weekTotals: WeekTotals;
}

// ─── Adapter helpers ────────────────────────────────────────────────────────

const ZERO_BY_CATEGORY = (): Record<EntryCategory, number> => ({
  onsite: 0,
  drive: 0,
  general: 0,
});

function isoToDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Convert a single canonical entry to a renderable block. Returns null
 * for running entries (endAt is null) — a running timer is shown on
 * the Day View, not the Week Timeline (no bounded width to render).
 */
function entryToBlock(entry: WeekTimesheetEntry): TimeBlock | null {
  if (!entry.endAt) return null;
  const start = isoToDate(entry.startAt);
  const end = isoToDate(entry.endAt);
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const durationMinutes =
    entry.durationMinutes != null && entry.durationMinutes > 0
      ? entry.durationMinutes
      : Math.round(ms / 60000);
  return {
    id: entry.id,
    date: entry.date,
    start: start.toISOString(),
    end: end.toISOString(),
    durationMinutes,
    category: categoryForType(entry.type),
    rawType: entry.type,
    jobId: entry.jobId,
    visitId: entry.visitId,
    jobNumber: entry.jobNumber,
    jobSummary: entry.jobSummary,
    locationName: entry.locationName,
    notes: entry.notes,
    billable: entry.billable,
  };
}

const ZERO_BY_CATEGORY_LITERAL = (): Record<EntryCategory, number> => ({
  onsite: 0,
  drive: 0,
  general: 0,
});

/**
 * Group raw blocks within a single day into displayable `TimeBlockGroup`s.
 * Pure function over an already-sorted blocks array (sorted by start ASC).
 *
 * Grouping rule:
 *   • Any entry with a `jobId` joins the bucket keyed by
 *     `${date}|${jobId}|${visitId ?? ""}`. So drive + on-site for the
 *     same visit collapse to one card; drive + on-site for two
 *     different visits at the same job stay separate.
 *   • Any entry with NO jobId becomes its own bucket — general /
 *     admin / break / supplier-run with no job context don't share a
 *     "site" we can meaningfully aggregate.
 */
export function groupBlocksForDay(blocks: TimeBlock[]): TimeBlockGroup[] {
  const buckets = new Map<string, TimeBlock[]>();
  for (const b of blocks) {
    const key = b.jobId
      ? `${b.date}|${b.jobId}|${b.visitId ?? ""}`
      : `${b.date}|individual|${b.id}`;
    const list = buckets.get(key) ?? [];
    list.push(b);
    buckets.set(key, list);
  }

  const groups: TimeBlockGroup[] = [];
  // Array.from() avoids needing `--downlevelIteration` on the Map
  // iterator — keeps the file portable across the project's TS
  // target settings.
  for (const members of Array.from(buckets.values())) {
    members.sort((a: TimeBlock, b: TimeBlock) =>
      a.start < b.start ? -1 : a.start > b.start ? 1 : 0,
    );
    const memberCategoryMinutes = ZERO_BY_CATEGORY_LITERAL();
    let earliestStart = members[0].start;
    let latestEnd = members[0].end;
    let totalMinutes = 0;
    let billable = false;
    for (const m of members) {
      memberCategoryMinutes[m.category] += m.durationMinutes;
      totalMinutes += m.durationMinutes;
      if (m.start < earliestStart) earliestStart = m.start;
      if (m.end > latestEnd) latestEnd = m.end;
      if (m.billable) billable = true;
    }

    // Predominant category — most-minutes wins. Ties broken by the
    // canonical onsite > drive > general order so a 30/30 drive+onsite
    // group reads as on-site (matches the operator mental model where
    // drive is a precursor to on-site).
    const ordered: EntryCategory[] = ["onsite", "drive", "general"];
    let predominant: EntryCategory = "onsite";
    let max = -1;
    for (const cat of ordered) {
      if (memberCategoryMinutes[cat] > max) {
        max = memberCategoryMinutes[cat];
        predominant = cat;
      }
    }

    const isMixedCategory =
      ordered.filter((c) => memberCategoryMinutes[c] > 0).length > 1;

    const rep = members[0];
    const id =
      members.length === 1
        ? rep.id
        : `group-${members.map((m: TimeBlock) => m.id).join("+")}`;

    groups.push({
      id,
      date: rep.date,
      start: earliestStart,
      end: latestEnd,
      durationMinutes: totalMinutes,
      category: predominant,
      isMixedCategory,
      jobId: rep.jobId,
      visitId: rep.visitId,
      jobNumber: rep.jobNumber,
      jobSummary: rep.jobSummary,
      locationName: rep.locationName,
      billable,
      members,
      memberCategoryMinutes,
    });
  }

  groups.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return groups;
}

/**
 * Detect overlap pairs within a sorted-by-start blocks array. Quadratic
 * worst-case is fine — a single tech rarely has more than ~30 blocks
 * per day. Returns id pairs (always [earlier, later]) so the warning
 * indicator can pinpoint the offenders.
 */
function detectOverlaps(blocks: TimeBlock[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < blocks.length; i++) {
    const a = blocks[i];
    for (let j = i + 1; j < blocks.length; j++) {
      const b = blocks[j];
      if (b.start >= a.end) break; // sorted — nothing further can overlap
      // a.start <= b.start (sorted) AND b.start < a.end → overlap.
      if (b.start < a.end) pairs.push([a.id, b.id]);
    }
  }
  return pairs;
}

/**
 * Build the 7-day skeleton (Mon → Sun) for a given `weekStart` (Monday).
 * Days that have no entries still appear in the output with empty arrays
 * so the rendering loop doesn't need to special-case empty rows.
 */
function buildDaySkeleton(weekStart: string): DayTimeline[] {
  const monday = new Date(`${weekStart}T00:00:00.000Z`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday.getTime() + i * 86400000);
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    return {
      date,
      dayIndex: i as DayTimeline["dayIndex"],
      blocks: [],
      groups: [],
      totalMinutes: 0,
      byCategory: ZERO_BY_CATEGORY(),
      earliestStart: null,
      latestEnd: null,
      overlaps: [],
    };
  });
}

// ─── Public adapter API ─────────────────────────────────────────────────────

/**
 * Adapt a raw week response to the Week Timeline's view-model.
 *
 * The output is fully self-contained — the Week Timeline component reads
 * nothing else from the network and never calls back into this module.
 * Stable over re-renders because every field is derived from the input
 * deterministically (callers should `useMemo(() => buildWeekTimelineViewModel(...), [resp])`).
 */
export function buildWeekTimelineViewModel(input: {
  weekStart: string;
  userId: string;
  entries: WeekTimesheetEntry[];
}): WeekTimelineViewModel {
  const days = buildDaySkeleton(input.weekStart);
  const dayByDate = new Map(days.map((d) => [d.date, d]));

  // Bucket entries → blocks → days.
  for (const entry of input.entries) {
    const block = entryToBlock(entry);
    if (!block) continue;
    const day = dayByDate.get(block.date);
    if (!day) continue; // entry outside the queried week — defensive
    day.blocks.push(block);
  }

  // Sort + compute per-day aggregates.
  for (const day of days) {
    day.blocks.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    let total = 0;
    const byCat = ZERO_BY_CATEGORY();
    for (const b of day.blocks) {
      total += b.durationMinutes;
      byCat[b.category] += b.durationMinutes;
    }
    day.totalMinutes = total;
    day.byCategory = byCat; // raw — drive vs on-site vs general preserved
    day.earliestStart = day.blocks[0]?.start ?? null;
    day.latestEnd = day.blocks[day.blocks.length - 1]?.end ?? null;
    day.overlaps = detectOverlaps(day.blocks);
    // Visible cards — collapse drive + on-site for the same job/visit
    // into single groups. Raw `blocks` stays intact for category
    // breakdowns + downstream consumers.
    day.groups = groupBlocksForDay(day.blocks);
  }

  // Week aggregates.
  const weekTotals: WeekTotals = {
    totalMinutes: 0,
    byCategory: ZERO_BY_CATEGORY(),
    perDayMinutes: days.map((d) => d.totalMinutes),
  };
  for (const day of days) {
    weekTotals.totalMinutes += day.totalMinutes;
    weekTotals.byCategory.onsite += day.byCategory.onsite;
    weekTotals.byCategory.drive += day.byCategory.drive;
    weekTotals.byCategory.general += day.byCategory.general;
  }

  return {
    weekStart: input.weekStart,
    userId: input.userId,
    days,
    weekTotals,
  };
}

// ─── Render-math helpers (used by the timeline strip) ───────────────────────

/**
 * Hard clamp for the dynamic week-range computation. The brief calls
 * out: never extend the timeline before 5AM or after 10PM regardless
 * of what extreme entries the data carries. Off-shift outliers should
 * NOT push the entire week's grid into a 24h view.
 */
export const STRIP_CLAMP_START_HOUR = 5;
export const STRIP_CLAMP_END_HOUR = 22; // exclusive upper bound (i.e. 10PM ends at hour 22)

/**
 * Default visible range when no entries exist anywhere in the week.
 * Intentionally compact (7AM–9PM = 14 hours) so an empty week's grid
 * is still legible at typical viewport widths.
 */
const DEFAULT_RANGE = { startHour: 7, endHour: 21 };

/**
 * Compute the [hourFloor, hourCeil] range that should fill the
 * horizontal strip for a given block list. The result is always a
 * whole-hour-aligned range so the hour-grid lines render cleanly.
 *
 *   • `floorStart`: the earliest block's start hour rounded DOWN.
 *   • `ceilEnd`: the latest block's end hour rounded UP.
 *   • Clamp to [STRIP_CLAMP_START_HOUR, STRIP_CLAMP_END_HOUR] so
 *     extreme outliers can't blow up the strip.
 *   • If no blocks → DEFAULT_RANGE (7–21).
 *
 * Caller passes either ONE day's blocks (to compute that day's
 * private range) or ALL the week's blocks flattened (to compute a
 * shared range every row aligns to). The week timeline uses the
 * latter — see `computeWeekStripRange` below.
 */
export function computeStripRange(
  blocks: TimeBlock[],
  options: {
    referenceDate?: string;
    defaultStartHour?: number;
    defaultEndHour?: number;
  } = {},
): { startHour: number; endHour: number } {
  const defaultStart = options.defaultStartHour ?? DEFAULT_RANGE.startHour;
  const defaultEnd = options.defaultEndHour ?? DEFAULT_RANGE.endHour;
  if (blocks.length === 0) {
    return { startHour: defaultStart, endHour: defaultEnd };
  }
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const b of blocks) {
    const s = new Date(b.start);
    const e = new Date(b.end);
    // floor — round down to the hour the block starts on
    earliest = Math.min(earliest, s.getHours());
    // ceil — round up so the last block's tail is fully visible
    const endHourCeil = e.getMinutes() > 0 ? e.getHours() + 1 : e.getHours();
    latest = Math.max(latest, endHourCeil);
  }
  // Clamp + ensure a sensible minimum width (at least 1 hour visible).
  const startHour = Math.max(STRIP_CLAMP_START_HOUR, earliest);
  const endHour = Math.min(STRIP_CLAMP_END_HOUR, latest);
  if (endHour <= startHour) {
    return { startHour: defaultStart, endHour: defaultEnd };
  }
  return { startHour, endHour };
}

/**
 * Convenience — compute a SHARED hour range across every block in the
 * week so all 7 day rows render aligned grid lines. Floors earliest /
 * ceils latest across ALL days, clamps to [5, 22], falls back to the
 * default range when the week is empty.
 */
export function computeWeekStripRange(
  days: DayTimeline[],
): { startHour: number; endHour: number } {
  const allBlocks = days.flatMap((d) => d.blocks);
  return computeStripRange(allBlocks);
}

/**
 * Compute pixel-positioning for a block given the strip range and
 * pixels-per-hour. Used by tests + any caller that wants fixed-pixel
 * dispatch-style sizing. The Week Timeline UI itself uses the
 * percent-based variant below so the strip always fills the available
 * width without horizontal scroll.
 */
export function computeBlockGeometry(
  block: TimeBlock,
  strip: { startHour: number; endHour: number; pxPerHour: number },
): { left: number; width: number } {
  const start = new Date(block.start);
  const end = new Date(block.end);
  const startMinutesFromStripStart =
    start.getHours() * 60 + start.getMinutes() - strip.startHour * 60;
  const endMinutesFromStripStart =
    end.getHours() * 60 + end.getMinutes() - strip.startHour * 60;
  const left = (startMinutesFromStripStart / 60) * strip.pxPerHour;
  const width =
    ((endMinutesFromStripStart - startMinutesFromStripStart) / 60) * strip.pxPerHour;
  return { left, width: Math.max(2, width) };
}

/**
 * Compute percent-based positioning for a block (raw or grouped).
 *
 *   leftPct  = (minutesFromStripStart / totalStripMinutes) * 100
 *   widthPct = (spanMinutes / totalStripMinutes) * 100
 *
 * IMPORTANT: width here uses the BLOCK SPAN (end - start), not the
 * duration. For a raw entry these are equal. For a `TimeBlockGroup`
 * they DIFFER — the group's `durationMinutes` is the SUM of member
 * durations (gaps don't count), but the visible card must paint over
 * the full earliest-start → latest-end window. If a future product
 * decision wants the card width to reflect summed duration instead,
 * swap the math here only.
 *
 * Both leftPct + widthPct are CLAMPED to [0, 100] so a block whose
 * actual times fall outside the visible strip (a defensive case the
 * dynamic range computation prevents in practice, but worth guarding)
 * doesn't render outside its container.
 *
 * Pair with a CSS `min-width` to enforce a minimum-clickable-width
 * floor — the brief asks for ~40px. The percent value alone can
 * resolve to sub-pixel widths on narrow viewports.
 */
export function computeBlockPercent(
  block: { start: string; end: string },
  strip: { startHour: number; endHour: number },
): { leftPct: number; widthPct: number } {
  const totalStripMinutes = (strip.endHour - strip.startHour) * 60;
  if (totalStripMinutes <= 0) return { leftPct: 0, widthPct: 0 };
  const start = new Date(block.start);
  const end = new Date(block.end);
  const startMinutesFromStripStart =
    start.getHours() * 60 + start.getMinutes() - strip.startHour * 60;
  const endMinutesFromStripStart =
    end.getHours() * 60 + end.getMinutes() - strip.startHour * 60;
  const rawLeftPct = (startMinutesFromStripStart / totalStripMinutes) * 100;
  const rawWidthPct =
    ((endMinutesFromStripStart - startMinutesFromStripStart) /
      totalStripMinutes) *
    100;
  // Clamp left into [0, 100). Clamp width so left+width never exceeds 100.
  const leftPct = Math.max(0, Math.min(99.9, rawLeftPct));
  const widthPct = Math.max(0, Math.min(100 - leftPct, rawWidthPct));
  return { leftPct, widthPct };
}

/** Pretty-print "Xh Ym" — used for totals labels. */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "0h 0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}
