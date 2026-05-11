/**
 * Open-slot gap computation for the tech Today page.
 *
 * Extracted from TodayPage.tsx so the algorithm can be unit-tested
 * independently of React.
 */

/** Minimal visit shape required by the gap finder. */
export interface ScheduledBlock {
  scheduledStartRaw: string | null;
  scheduledEndRaw: string | null;
}

export interface OpenSlot {
  startIso: string;
  endIso: string;
  durationMinutes: number;
  /**
   * Index into the visits array of the visit that PRECEDES this gap.
   * i.e. gap falls between visits[afterIndex] and visits[afterIndex + 1].
   * Used by the All-view interleave renderer to insert slot cards at the
   * right position without re-computing gap boundaries.
   */
  afterIndex: number;
}

/** Ceil ms to the next 15-minute clock boundary. */
function nextQuarterHour(ms: number): number {
  const QUARTER = 15 * 60_000;
  return Math.ceil(ms / QUARTER) * QUARTER;
}

/**
 * Returns gaps ≥ minDurationMins between consecutive visits.
 *
 * Rules:
 *  - scheduledEndRaw preferred; falls back to scheduledStartRaw + 60 min.
 *  - opts.now: clamp any gap whose start is in the past to the next
 *    15-minute boundary. Gaps that shrink below minDurationMins after
 *    clamping are excluded. Only pass this when rendering today's schedule.
 *  - Gaps under minDurationMins (default 30) are never shown.
 */
export function computeOpenSlots(
  visits: ScheduledBlock[],
  minDurationMins = 30,
  opts?: { now?: number },
): OpenSlot[] {
  const slots: OpenSlot[] = [];
  for (let i = 0; i < visits.length - 1; i++) {
    const curr = visits[i];
    const next = visits[i + 1];
    if (!next.scheduledStartRaw) continue;

    let gapStartMs: number;
    if (curr.scheduledEndRaw) {
      gapStartMs = new Date(curr.scheduledEndRaw).getTime();
    } else if (curr.scheduledStartRaw) {
      // Fallback: treat visit as 60 minutes (matches dashboard capacity default).
      gapStartMs = new Date(curr.scheduledStartRaw).getTime() + 60 * 60_000;
    } else {
      continue;
    }
    if (Number.isNaN(gapStartMs)) continue;

    const gapEndMs = new Date(next.scheduledStartRaw).getTime();
    if (Number.isNaN(gapEndMs) || gapEndMs <= gapStartMs) continue;

    // Clamp past-start blocks to next 15-min boundary when viewing today.
    if (opts?.now !== undefined && opts.now > gapStartMs) {
      gapStartMs = nextQuarterHour(opts.now);
    }

    if (gapEndMs <= gapStartMs) continue;
    const durationMinutes = Math.floor((gapEndMs - gapStartMs) / 60_000);
    if (durationMinutes < minDurationMins) continue;

    slots.push({
      startIso: new Date(gapStartMs).toISOString(),
      endIso: new Date(gapEndMs).toISOString(),
      durationMinutes,
      afterIndex: i,
    });
  }
  return slots;
}
