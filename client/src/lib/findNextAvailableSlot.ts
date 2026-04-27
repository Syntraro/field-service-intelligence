/**
 * findNextAvailableSlot — find the earliest open gap across all technicians
 * that fits a requested duration.
 *
 * 2026-04-26 v3 (current): derives availability from `workday` bounds minus
 * `kind: "booked"` blocks, NOT from the server's pre-filtered `kind: "open"`
 * blocks. Reasons:
 *
 *   1. The server's `SCHEDULE_BLOCK_OPEN_THRESHOLD_MINUTES = 120` (server/
 *      storage/capacity.ts) means open blocks shorter than 2 hours are NOT
 *      emitted. A tech with 90 minutes of remaining afternoon would have no
 *      `kind: "open"` row at all — but the dispatch board UI still shows
 *      that tech as available for an 90-minute job.
 *
 *   2. Open blocks emit their FULL extent (e.g. 9–17 if a tech is booked
 *      10–11). When the user is searching at 2 PM, the helper used to drop
 *      the entire 11–17 open block because its start (11) was in the past
 *      — even though 14–17 was perfectly bookable.
 *
 * The new algorithm:
 *   - For each technician with a `workday: { startISO, endISO }`:
 *     - `windowStart = max(workday.startISO, now)` — clip past time when today.
 *     - `windowEnd   = workday.endISO`.
 *     - Subtract the technician's `kind: "booked"` blocks from
 *       `[windowStart, windowEnd]`, merging overlapping busy intervals.
 *     - Walk the resulting gap list left-to-right; the FIRST gap whose
 *       length ≥ requestedDuration produces a candidate.
 *   - Pick the candidate with the earliest start across all technicians.
 *   - Ties on start time → smallest `technicianId` (deterministic).
 *
 * `formatSlotTimeLabel(date, time)` is the companion helper for rendering
 * the slot's start as a 12-hour clock string. It does pure string math on
 * the same `HH:mm` slice that lands in the form's `<input type="time">`,
 * so the toast and the form can never disagree on what was selected.
 */

export interface CapacityBlock {
  kind: "booked" | "open";
  startISO: string;
  endISO: string;
  durationMinutes: number;
}

export interface CapacityWorkday {
  startISO: string;
  endISO: string;
}

export interface CapacityTech {
  technicianId: string;
  name: string;
  /** All schedule rows for the day. Booked blocks are the only ones we
   *  treat as authoritative — server-side open-block filtering means
   *  we recompute gaps locally. */
  scheduleBlocks: CapacityBlock[];
  /** Working window for today (already in the company's local clock as
   *  a UTC ISO instant). Optional — when missing, the technician is
   *  treated as off today and contributes no availability. */
  workday?: CapacityWorkday | null;
}

export interface CapacityResponse {
  technicians: CapacityTech[];
  /** IANA timezone of the company that the workday + scheduleBlocks
   *  ISO instants are anchored to. Optional for back-compat with older
   *  test fixtures; the server has emitted this since 2026-04. */
  timezone?: string;
}

export interface OpenSlotMatch {
  technicianId: string;
  technicianName: string;
  /** ISO timestamp of the slot start (UTC). */
  startISO: string;
  /** ISO timestamp of the slot end. Will equal `startISO + requestedDuration`
   *  unless the requested duration was zero, in which case it's the gap end. */
  endISO: string;
  /** YYYY-MM-DD slice of `startISO`, ready to drop into a date input. */
  date: string;
  /** HH:mm slice of `startISO`, ready to drop into a `<input type="time">`. */
  time: string;
  /** Echoes the caller's requested duration so the UI can fill the field. */
  durationMinutes: number;
}

interface BusyInterval {
  start: number;
  end: number;
}

/** A single open gap for a technician within their workday. Returned by
 *  `computeOpenGapsForTech`. Same fields as `OpenSlotMatch` minus `technicianId`
 *  / `technicianName` so callers that already know the tech don't carry
 *  redundant identity around. */
export interface OpenGap {
  startISO: string;
  endISO: string;
  /** YYYY-MM-DD slice of `startISO`. */
  date: string;
  /** HH:mm slice of `startISO`. */
  time: string;
  /** Length of the slot, in minutes. Equals the requested duration when the
   *  gap is large enough to fit it; never larger. */
  durationMinutes: number;
}

/**
 * Merge overlapping busy intervals in place. Input must be sorted by `start`.
 * Returns a new merged array.
 */
function mergeBusy(intervals: BusyInterval[]): BusyInterval[] {
  if (intervals.length === 0) return [];
  const out: BusyInterval[] = [{ start: intervals[0].start, end: intervals[0].end }];
  for (let i = 1; i < intervals.length; i++) {
    const cur = intervals[i];
    const last = out[out.length - 1];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ start: cur.start, end: cur.end });
    }
  }
  return out;
}

/**
 * Find the earliest start within `[windowStart, windowEnd]` such that
 * `[start, start + requiredMs]` does not overlap any merged busy interval.
 * Returns the start ms, or null when no such start exists.
 */
function findEarliestGapStart(
  windowStart: number,
  windowEnd: number,
  busy: BusyInterval[],
  requiredMs: number,
): number | null {
  if (windowEnd - windowStart < requiredMs) return null;
  let cursor = windowStart;
  for (const b of busy) {
    if (b.end <= cursor) continue; // already past
    if (b.start - cursor >= requiredMs) {
      return cursor;
    }
    cursor = Math.max(cursor, b.end);
    if (cursor >= windowEnd) return null;
  }
  if (windowEnd - cursor >= requiredMs) {
    return cursor;
  }
  return null;
}

export interface FindNextAvailableOptions {
  /** Optional now-anchor (defaults to Date.now()). Tests pass a deterministic value. */
  now?: Date | number;
  /** Restrict the search to these technicians only. When non-empty, technicians
   *  outside the list are skipped — so if the user has pre-selected a tech in
   *  the Schedule row, "Find next available" honors that choice instead of
   *  picking a random other tech.
   *  When empty/undefined, all technicians are considered (legacy behavior). */
  preferredTechnicianIds?: string[];
}

/** Resolve `options.now` to milliseconds. Centralized so all helpers share
 *  the exact same anchor when called by the same render pass. */
function resolveNowMs(now?: Date | number): number {
  if (typeof now === "number") return now;
  if (now instanceof Date) return now.getTime();
  return Date.now();
}

/**
 * Build the merged busy-interval list for a single technician within their
 * effective scheduling window. Internal helper used by both
 * `computeOpenGapsForTech` and `findNextAvailableSlot` so the two helpers
 * never disagree on what counts as "busy".
 */
function buildBusyForTech(
  tech: CapacityTech | null | undefined,
  nowMs: number,
): { windowStart: number; windowEnd: number; busy: BusyInterval[] } | null {
  if (!tech || !tech.workday) return null;
  const workStartMs = Date.parse(tech.workday.startISO);
  const workEndMs = Date.parse(tech.workday.endISO);
  if (!Number.isFinite(workStartMs) || !Number.isFinite(workEndMs)) return null;
  if (workEndMs <= workStartMs) return null;

  const windowStart = Math.max(workStartMs, nowMs);
  const windowEnd = workEndMs;
  if (windowEnd <= windowStart) return { windowStart, windowEnd, busy: [] };

  const blocks = Array.isArray(tech.scheduleBlocks) ? tech.scheduleBlocks : [];
  const busy: BusyInterval[] = [];
  for (const b of blocks) {
    if (!b || b.kind !== "booked") continue;
    if (typeof b.startISO !== "string" || typeof b.endISO !== "string") continue;
    const bs = Date.parse(b.startISO);
    const be = Date.parse(b.endISO);
    if (!Number.isFinite(bs) || !Number.isFinite(be)) continue;
    if (be <= bs) continue;
    const clippedStart = Math.max(bs, windowStart);
    const clippedEnd = Math.min(be, windowEnd);
    if (clippedEnd <= clippedStart) continue;
    busy.push({ start: clippedStart, end: clippedEnd });
  }
  busy.sort((a, b) => a.start - b.start || a.end - b.end);
  return { windowStart, windowEnd, busy: mergeBusy(busy) };
}

/**
 * Enumerate all open gaps for a single technician that fit `requestedDurationMinutes`.
 * Reuses the same workday/booked-block math as `findNextAvailableSlot`. Past
 * time is clipped at `options.now`.
 *
 * Used by the Create-Job suggestion list: "Available: 9 PM, 10 PM, …" surfaces
 * the top N entries from this array. For just the earliest opening across the
 * whole roster, prefer `findNextAvailableSlot()` (it's a thin wrapper over the
 * same primitives plus tech-tie-breaking).
 *
 * Returns an empty array when the tech is off today, has no remaining window,
 * or every gap is shorter than the requested duration.
 */
export function computeOpenGapsForTech(
  tech: CapacityTech | null | undefined,
  requestedDurationMinutes: number,
  options?: FindNextAvailableOptions,
): OpenGap[] {
  const wantedMin = Math.max(0, Math.floor(requestedDurationMinutes || 0));
  const wantedMs = Math.max(wantedMin * 60_000, 1);
  const nowMs = resolveNowMs(options?.now);
  const built = buildBusyForTech(tech, nowMs);
  if (!built) return [];
  const { windowStart, windowEnd, busy } = built;
  if (windowEnd - windowStart < wantedMs) return [];

  const out: OpenGap[] = [];
  let cursor = windowStart;
  for (const b of busy) {
    if (b.end <= cursor) continue;
    if (b.start > cursor && b.start - cursor >= wantedMs) {
      const startMs = cursor;
      const endMs = startMs + (wantedMin > 0 ? wantedMin * 60_000 : b.start - cursor);
      const startISO = new Date(startMs).toISOString();
      out.push({
        startISO,
        endISO: new Date(endMs).toISOString(),
        date: startISO.slice(0, 10),
        time: startISO.slice(11, 16),
        durationMinutes: wantedMin > 0 ? wantedMin : Math.round((b.start - cursor) / 60_000),
      });
    }
    cursor = Math.max(cursor, b.end);
    if (cursor >= windowEnd) break;
  }
  if (windowEnd - cursor >= wantedMs) {
    const startMs = cursor;
    const endMs = startMs + (wantedMin > 0 ? wantedMin * 60_000 : windowEnd - cursor);
    const startISO = new Date(startMs).toISOString();
    out.push({
      startISO,
      endISO: new Date(endMs).toISOString(),
      date: startISO.slice(0, 10),
      time: startISO.slice(11, 16),
      durationMinutes: wantedMin > 0 ? wantedMin : Math.round((windowEnd - cursor) / 60_000),
    });
  }
  return out;
}

/**
 * 2026-04-26: One technician's open availability for the day, grouped
 * for a dispatcher-controlled picker. Each `OpenGap` represents a real
 * open WINDOW (start → end, full extent, with `durationMinutes`
 * reflecting the window's actual length), filtered to windows ≥ the
 * requested duration so the dispatcher only sees actionable choices.
 *
 * Used by the "Find Availability" inline panel on the Create New Job
 * surface (replaces the old auto-pick "Find next available" button).
 */
export interface TechAvailability {
  technicianId: string;
  technicianName: string;
  /** Real open windows for this tech that fit the requested duration.
   *  Each gap's `durationMinutes` is the window's full length, NOT the
   *  requested-slot length — the dispatcher needs to see how much
   *  headroom they have (e.g. "8:00 AM – 11:30 AM · 3.5h open"). */
  gaps: OpenGap[];
}

/**
 * Group every technician's open windows for the day, filtered to those
 * that fit `requestedDurationMinutes`. Returns one entry per technician
 * that has at least one fitting window; technicians with no fitting
 * windows are dropped.
 *
 * Reuses `computeOpenGapsForTech` per tech with a 0-duration request so
 * each emitted gap reflects the real window extent, then filters to
 * windows ≥ requested duration. No new busy/window math is introduced.
 *
 * Sort order: the technician with the earliest first window leads.
 * Ties on first-window start break by technician name.
 */
export function groupOpenGapsByTech(
  capacity: CapacityResponse | null | undefined,
  requestedDurationMinutes: number,
  options?: FindNextAvailableOptions,
): TechAvailability[] {
  const wantedMin = Math.max(0, Math.floor(requestedDurationMinutes || 0));
  const techs = capacity?.technicians ?? [];
  const preferred = (options?.preferredTechnicianIds ?? []).filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  const preferredSet = preferred.length > 0 ? new Set(preferred) : null;

  const result: TechAvailability[] = [];
  for (const t of techs) {
    if (!t || typeof t.technicianId !== "string") continue;
    if (preferredSet && !preferredSet.has(t.technicianId)) continue;
    // Pass `0` so the helper emits each open WINDOW with its actual
    // duration. Then filter the windows that can accommodate the
    // requested job length.
    const fullWindows = computeOpenGapsForTech(t, 0, options);
    const fittingGaps = wantedMin > 0
      ? fullWindows.filter((g) => g.durationMinutes >= wantedMin)
      : fullWindows;
    if (fittingGaps.length === 0) continue;
    result.push({
      technicianId: t.technicianId,
      technicianName: t.name,
      gaps: fittingGaps,
    });
  }

  return result.sort((a, b) => {
    const aFirst = a.gaps[0]?.startISO ?? "";
    const bFirst = b.gaps[0]?.startISO ?? "";
    if (aFirst !== bFirst) return aFirst < bFirst ? -1 : 1;
    return a.technicianName.localeCompare(b.technicianName);
  });
}

/**
 * Return the booked blocks that overlap `[startMs, endMs)` for one technician.
 * Edge-touching is NOT an overlap (matches the dispatch board's exclusive-
 * boundary semantics in `dispatchOverlapUtils.rangesOverlap`).
 *
 * Used by the Create-Job conflict warning. Empty array → no warning.
 */
export function getOverlappingBookedBlocks(
  tech: CapacityTech | null | undefined,
  startMs: number,
  endMs: number,
): CapacityBlock[] {
  if (!tech || !Array.isArray(tech.scheduleBlocks)) return [];
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
  const out: CapacityBlock[] = [];
  for (const b of tech.scheduleBlocks) {
    if (!b || b.kind !== "booked") continue;
    if (typeof b.startISO !== "string" || typeof b.endISO !== "string") continue;
    const bs = Date.parse(b.startISO);
    const be = Date.parse(b.endISO);
    if (!Number.isFinite(bs) || !Number.isFinite(be)) continue;
    if (be <= bs) continue;
    if (bs < endMs && startMs < be) out.push(b);
  }
  return out;
}

export function findNextAvailableSlot(
  capacity: CapacityResponse | null | undefined,
  requestedDurationMinutes: number,
  optionsOrNow?: Date | number | FindNextAvailableOptions,
): OpenSlotMatch | null {
  // Back-compat shim: callers used to pass a bare `now` as the third arg.
  // Detect that shape and lift it into the new options object.
  const opts: FindNextAvailableOptions =
    typeof optionsOrNow === "object" && optionsOrNow !== null && !(optionsOrNow instanceof Date)
      ? optionsOrNow
      : { now: optionsOrNow };
  const techs = capacity?.technicians ?? [];
  const wantedMin = Math.max(0, Math.floor(requestedDurationMinutes || 0));
  const wantedMs = wantedMin * 60_000;
  const nowMs = resolveNowMs(opts.now);

  const preferred = (opts.preferredTechnicianIds ?? []).filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  const preferredSet = preferred.length > 0 ? new Set(preferred) : null;

  let best: OpenSlotMatch | null = null;
  let bestTechId = "";

  for (const t of techs) {
    // Honor the user's pre-selected technician(s).
    if (preferredSet && !preferredSet.has(t.technicianId)) continue;
    const built = buildBusyForTech(t, nowMs);
    if (!built) continue;
    const { windowStart, windowEnd, busy } = built;
    if (windowEnd - windowStart < Math.max(wantedMs, 1)) continue;

    const requiredMs = wantedMs > 0 ? wantedMs : 1;
    const gapStart = findEarliestGapStart(windowStart, windowEnd, busy, requiredMs);
    if (gapStart === null) continue;

    const gapEnd = (() => {
      for (const b of busy) {
        if (b.start >= gapStart) return Math.min(b.start, windowEnd);
      }
      return windowEnd;
    })();

    const candidateEndMs = wantedMs > 0 ? gapStart + wantedMs : gapEnd;
    const startISO = new Date(gapStart).toISOString();
    const endISO = new Date(candidateEndMs).toISOString();

    const candidate: OpenSlotMatch = {
      technicianId: t.technicianId,
      technicianName: t.name,
      startISO,
      endISO,
      date: startISO.slice(0, 10),
      time: startISO.slice(11, 16),
      durationMinutes: wantedMin > 0 ? wantedMin : Math.round((gapEnd - gapStart) / 60_000),
    };

    if (best === null) {
      best = candidate;
      bestTechId = t.technicianId;
      continue;
    }
    if (candidate.startISO < best.startISO) {
      best = candidate;
      bestTechId = t.technicianId;
    } else if (candidate.startISO === best.startISO && t.technicianId < bestTechId) {
      best = candidate;
      bestTechId = t.technicianId;
    }
  }

  return best;
}

/**
 * Render a slot's `date` + `time` slices as a 12-hour clock label
 * ("14:00" → "2:00 PM"). Pure string math — no Date / parseISO involved
 * — so the output is guaranteed to match what `<input type="time">`
 * displays for the same value. This is what the toast / UI copy must
 * use to describe a populated slot.
 *
 * Returns the original `time` (or "") on malformed input.
 */
export function formatSlotTimeLabel(date: string, time: string): string {
  const [yStr, moStr, dStr] = (date ?? "").split("-");
  const [hStr, mnStr] = (time ?? "").split(":");
  const y = parseInt(yStr, 10);
  const mo = parseInt(moStr, 10);
  const d = parseInt(dStr, 10);
  const h = parseInt(hStr, 10);
  const mn = parseInt(mnStr, 10);
  if (![y, mo, d, h, mn].every(Number.isFinite)) return time ?? "";
  if (h < 0 || h > 23 || mn < 0 || mn > 59) return time ?? "";

  let hour12 = h % 12;
  if (hour12 === 0) hour12 = 12;
  const period = h < 12 ? "AM" : "PM";
  const mm = String(mn).padStart(2, "0");
  return `${hour12}:${mm} ${period}`;
}
