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

  // Resolve "now" to milliseconds. Default to current wall-clock; tests
  // pass a deterministic value.
  const nowMs =
    typeof opts.now === "number"
      ? opts.now
      : opts.now instanceof Date
        ? opts.now.getTime()
        : Date.now();

  // Build the preferred-tech filter set. Empty / undefined → consider all techs.
  const preferred = (opts.preferredTechnicianIds ?? []).filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  const preferredSet = preferred.length > 0 ? new Set(preferred) : null;

  let best: OpenSlotMatch | null = null;
  let bestTechId = "";

  for (const t of techs) {
    // Honor the user's pre-selected technician(s). The dispatcher's mental
    // model is: "find availability for THIS tech" — picking a different tech
    // would feel like the helper ignored their input.
    if (preferredSet && !preferredSet.has(t.technicianId)) continue;
    if (!t || !t.workday) continue; // off today / no workday → no availability
    const workStartMs = Date.parse(t.workday.startISO);
    const workEndMs = Date.parse(t.workday.endISO);
    if (!Number.isFinite(workStartMs) || !Number.isFinite(workEndMs)) continue;
    if (workEndMs <= workStartMs) continue;

    // Effective scheduling window: respects past-time when the workday is
    // today (nowMs falls inside it) and full workday otherwise.
    const windowStart = Math.max(workStartMs, nowMs);
    const windowEnd = workEndMs;
    if (windowEnd - windowStart < Math.max(wantedMs, 1)) continue; // nothing left, or zero-duration impossible

    // Collect booked blocks within [workStartMs, workEndMs]. We deliberately
    // ignore `kind: "open"` rows — they're a server-side derivation that's
    // already filtered to ≥ 120 min, which is too coarse for our purpose.
    const blocks = Array.isArray(t.scheduleBlocks) ? t.scheduleBlocks : [];
    const busy: BusyInterval[] = [];
    for (const b of blocks) {
      if (!b || b.kind !== "booked") continue;
      if (typeof b.startISO !== "string" || typeof b.endISO !== "string") continue;
      const bs = Date.parse(b.startISO);
      const be = Date.parse(b.endISO);
      if (!Number.isFinite(bs) || !Number.isFinite(be)) continue;
      if (be <= bs) continue;
      // Clip to the effective window so we only merge intervals that
      // actually compete for the time we're searching.
      const clippedStart = Math.max(bs, windowStart);
      const clippedEnd = Math.min(be, windowEnd);
      if (clippedEnd <= clippedStart) continue;
      busy.push({ start: clippedStart, end: clippedEnd });
    }
    busy.sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = mergeBusy(busy);

    // For zero-duration requests, treat as 1 ms so the gap-finder still
    // picks the earliest non-busy moment. Echoes back the gap's own duration
    // in the result.
    const requiredMs = wantedMs > 0 ? wantedMs : 1;
    const gapStart = findEarliestGapStart(windowStart, windowEnd, merged, requiredMs);
    if (gapStart === null) continue;

    const gapEnd = (() => {
      // Find the next busy interval that starts after gapStart, if any.
      // The slot ends either at the next busy start or at workday end.
      for (const b of merged) {
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
