/**
 * RRULE expansion tests — Technician Shift Management Phase 1 (2026-05-18).
 *
 * Pure unit tests: no database, no network. Tests the deterministic
 * expansion of weekly recurring shifts including DST transitions,
 * overnight shifts, exceptions, COUNT, UNTIL, and INTERVAL.
 */
import { describe, it, expect } from "vitest";
import { expandRecurringShift, type ExpandedOccurrence } from "../server/lib/rruleExpansion";
import { getDayUTCBounds } from "../server/lib/dayBoundaries";

// ─── Helpers ─────────────────────────────────────────────────────────────────

type BaseShiftInput = Parameters<typeof expandRecurringShift>[0];

function makeBase(overrides: Partial<BaseShiftInput> = {}): BaseShiftInput {
  return {
    startsAt: new Date("2026-01-05T13:00:00Z"),  // Mon Jan 5 2026, 08:00 EST
    endsAt: new Date("2026-01-05T21:00:00Z"),    // Mon Jan 5 2026, 16:00 EST
    allDay: false,
    timeOfDayStart: "08:00",
    timeOfDayEnd: "16:00",
    recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
    recurrenceEndDate: null,
    ...overrides,
  };
}

function occDates(occs: ExpandedOccurrence[]): string[] {
  return occs.map((o) => o.occurrenceDate);
}

const NY = "America/New_York";
const UTC = "UTC";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("expandRecurringShift", () => {
  it("weekly weekday recurrence — window in middle of series", () => {
    const base = makeBase({
      startsAt: new Date("2026-01-05T13:00:00Z"),
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
    });
    // Window: Wed Jan 7 – Fri Jan 9 2026 (UTC noon to noon to be safe)
    const windowStart = new Date("2026-01-07T00:00:00Z");
    const windowEnd = new Date("2026-01-10T00:00:00Z");
    const results = expandRecurringShift(base, windowStart, windowEnd, NY);
    const dates = occDates(results);
    expect(dates).toContain("2026-01-07"); // Wednesday
    expect(dates).toContain("2026-01-09"); // Friday
    expect(dates).not.toContain("2026-01-05"); // Monday — before window
    expect(dates).not.toContain("2026-01-12"); // next Monday — after window
  });

  it("stops at recurrenceEndDate even if window extends past it", () => {
    const base = makeBase({
      recurrenceEndDate: "2026-01-12",
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
    });
    const windowStart = new Date("2026-01-01T00:00:00Z");
    const windowEnd = new Date("2026-01-31T00:00:00Z");
    const results = expandRecurringShift(base, windowStart, windowEnd, NY);
    const dates = occDates(results);
    // Must not exceed recurrenceEndDate
    for (const d of dates) {
      expect(d <= "2026-01-12").toBe(true);
    }
    expect(dates).toContain("2026-01-12"); // Monday — exactly the end date
    expect(dates).not.toContain("2026-01-14"); // Wednesday — past end
  });

  it("open-ended series capped at maxLookaheadDays", () => {
    const base = makeBase({
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
      recurrenceEndDate: null,
    });
    const windowStart = new Date("2026-01-05T00:00:00Z");
    const windowEnd = new Date("2030-01-01T00:00:00Z"); // Very wide window
    const results = expandRecurringShift(base, windowStart, windowEnd, NY, 30);
    // With maxLookaheadDays=30, should not go beyond 30 days from today
    expect(results.length).toBeGreaterThan(0);
    // No occurrence should be more than 30 days past today
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 31);
    for (const occ of results) {
      expect(occ.startsAt.getTime()).toBeLessThan(cutoff.getTime());
    }
  });

  it("DST spring forward: occurrence on 2026-03-08 resolves to correct UTC", () => {
    // America/New_York: clocks spring forward at 2:00 AM on Mar 8 2026.
    // Before the cutover: EST = UTC-5. After: EDT = UTC-4.
    // 08:00 on Mar 7 (before cutover) → 13:00 UTC (EST)
    // 08:00 on Mar 8 (after cutover at 2am) → 12:00 UTC (EDT)
    const base = makeBase({
      startsAt: new Date("2026-03-02T13:00:00Z"),  // Mon Mar 2 2026, 08:00 EST
      recurrenceRule: "FREQ=WEEKLY;BYDAY=SU",       // every Sunday
      timeOfDayStart: "08:00",
      timeOfDayEnd: "16:00",
    });
    // Window covers Sun Mar 8
    const windowStart = new Date("2026-03-08T00:00:00Z");
    const windowEnd = new Date("2026-03-09T00:00:00Z");
    const results = expandRecurringShift(base, windowStart, windowEnd, NY);
    expect(results.length).toBe(1);
    // 08:00 EDT on Mar 8 = 12:00 UTC (EDT = UTC-4)
    expect(results[0].occurrenceDate).toBe("2026-03-08");
    // startsAt should be 12:00 UTC (08:00 in EDT = UTC-4)
    expect(results[0].startsAt.getUTCHours()).toBe(12);
    // endsAt should be 20:00 UTC (16:00 in EDT = UTC-4)
    expect(results[0].endsAt.getUTCHours()).toBe(20);
  });

  it("DST fall back: week before and week of give different UTC but same local time", () => {
    // America/New_York: clocks fall back at 2:00 AM on Nov 1 2026.
    // Oct 25 (before cutover): EDT = UTC-4 → 08:00 EDT = 12:00 UTC
    // Nov 1 (after cutover):   EST = UTC-5 → 08:00 EST = 13:00 UTC
    const base = makeBase({
      startsAt: new Date("2026-10-19T12:00:00Z"),  // Mon Oct 19 2026, 08:00 EDT
      recurrenceRule: "FREQ=WEEKLY;BYDAY=SU",       // every Sunday
      timeOfDayStart: "08:00",
      timeOfDayEnd: "16:00",
    });
    // Oct 25 (before fall back)
    const oct25Start = new Date("2026-10-25T00:00:00Z");
    const oct25End = new Date("2026-10-26T00:00:00Z");
    const oct25Results = expandRecurringShift(base, oct25Start, oct25End, NY);

    // Nov 1 (after fall back)
    const nov1Start = new Date("2026-11-01T00:00:00Z");
    const nov1End = new Date("2026-11-02T00:00:00Z");
    const nov1Results = expandRecurringShift(base, nov1Start, nov1End, NY);

    expect(oct25Results.length).toBe(1);
    expect(nov1Results.length).toBe(1);
    // Oct 25: 08:00 EDT = 12:00 UTC
    expect(oct25Results[0].startsAt.getUTCHours()).toBe(12);
    // Nov 1: 08:00 EST = 13:00 UTC
    expect(nov1Results[0].startsAt.getUTCHours()).toBe(13);
  });

  it("overnight shift: endsAt is next calendar day; occurrenceDate is start date", () => {
    // Overnight shift: 22:00–06:00 EST spans midnight.
    // 22:00 EST (UTC-5) = 03:00 UTC next day.
    // We need a wide enough UTC window to capture this.
    const base = makeBase({
      startsAt: new Date("2026-01-06T03:00:00Z"),  // Tue Jan 6 2026, 22:00 EST (Mon)
      endsAt: new Date("2026-01-06T11:00:00Z"),    // Tue Jan 6 2026, 06:00 EST (Tue)
      timeOfDayStart: "22:00",
      timeOfDayEnd: "06:00",              // end < start → overnight
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
    });
    // Window covers Mon Jan 5 through Wed Jan 7 (UTC) so the overnight occurrence
    // starting at 03:00 UTC Jan 6 is included.
    const windowStart = new Date("2026-01-05T00:00:00Z");
    const windowEnd = new Date("2026-01-07T00:00:00Z");
    const results = expandRecurringShift(base, windowStart, windowEnd, NY);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const occ = results[0];
    // occurrenceDate is the START date (Monday Jan 5 in NY tz)
    expect(occ.occurrenceDate).toBe("2026-01-05");
    // endsAt should be after startsAt
    expect(occ.endsAt.getTime()).toBeGreaterThan(occ.startsAt.getTime());
    // The difference should be 8 hours (22:00 → 06:00 = 8h)
    const diffHours = (occ.endsAt.getTime() - occ.startsAt.getTime()) / 3_600_000;
    expect(diffHours).toBeCloseTo(8, 0);
  });

  it("COUNT limit: stops after N occurrences", () => {
    const base = makeBase({
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=5",
      recurrenceEndDate: null,
    });
    const windowStart = new Date("2026-01-05T00:00:00Z");
    const windowEnd = new Date("2026-02-28T00:00:00Z");
    const results = expandRecurringShift(base, windowStart, windowEnd, NY, 365);
    // COUNT=5 → at most 5 occurrences in total
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it("UNTIL: stops at specified date", () => {
    const base = makeBase({
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO;UNTIL=20260119",
      recurrenceEndDate: null,
    });
    const windowStart = new Date("2026-01-01T00:00:00Z");
    const windowEnd = new Date("2026-02-01T00:00:00Z");
    const results = expandRecurringShift(base, windowStart, windowEnd, NY);
    const dates = occDates(results);
    // Jan 5, Jan 12, Jan 19 (all Mondays up to UNTIL Jan 19)
    expect(dates).toContain("2026-01-05");
    expect(dates).toContain("2026-01-12");
    expect(dates).toContain("2026-01-19");
    // Jan 26 is after UNTIL
    expect(dates).not.toContain("2026-01-26");
  });

  it("INTERVAL=2: every other week", () => {
    const base = makeBase({
      startsAt: new Date("2026-01-05T13:00:00Z"),  // Mon Jan 5
      recurrenceRule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO",
      recurrenceEndDate: null,
    });
    const windowStart = new Date("2026-01-01T00:00:00Z");
    const windowEnd = new Date("2026-02-01T00:00:00Z");
    const results = expandRecurringShift(base, windowStart, windowEnd, NY);
    const dates = occDates(results);
    // Jan 5 (DTSTART), Jan 19 (skip Jan 12), Feb 2 (after window)
    expect(dates).toContain("2026-01-05");
    expect(dates).not.toContain("2026-01-12"); // skipped
    expect(dates).toContain("2026-01-19");
    expect(dates).not.toContain("2026-01-26"); // skipped
  });

  it("FREQ=DAILY normalizes to all-7-days weekly (produces occurrences every day)", () => {
    // FREQ=DAILY;BYDAY=MO is an unusual rule — BYDAY is ignored for DAILY; we normalize
    // FREQ=DAILY to FREQ=WEEKLY;BYDAY=all-7 for uniform expansion.
    const base = makeBase({
      recurrenceRule: "FREQ=DAILY",
      recurrenceEndDate: "2026-01-09",
    });
    const windowStart = new Date("2026-01-05T00:00:00Z");
    const windowEnd = new Date("2026-01-12T00:00:00Z");
    const results = expandRecurringShift(base, windowStart, windowEnd, NY);
    const dates = occDates(results);
    // Should produce Mon-Fri within the window (Jan 5–9, capped by recurrenceEndDate)
    expect(dates).toContain("2026-01-05");
    expect(dates).toContain("2026-01-06");
    expect(dates).toContain("2026-01-07");
    expect(dates).toContain("2026-01-08");
    expect(dates).toContain("2026-01-09");
    expect(dates).not.toContain("2026-01-10"); // past recurrenceEndDate
  });

  it("FREQ=MONTHLY returns empty (unsupported)", () => {
    const base = makeBase({ recurrenceRule: "FREQ=MONTHLY" });
    const windowStart = new Date("2026-01-01T00:00:00Z");
    const windowEnd = new Date("2026-06-01T00:00:00Z");
    expect(expandRecurringShift(base, windowStart, windowEnd, NY)).toHaveLength(0);
  });

  it("all-day shift: bounds cover full calendar day", () => {
    const base: BaseShiftInput = {
      startsAt: new Date("2026-01-05T05:00:00Z"), // Mon Jan 5 UTC
      endsAt: new Date("2026-01-06T05:00:00Z"),
      allDay: true,
      timeOfDayStart: null,
      timeOfDayEnd: null,
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
      recurrenceEndDate: null,
    };
    const windowStart = new Date("2026-01-05T00:00:00Z");
    const windowEnd = new Date("2026-01-06T00:00:00Z");
    const results = expandRecurringShift(base, windowStart, windowEnd, NY);
    expect(results.length).toBe(1);
    // All-day: startsAt should be midnight local (05:00 UTC for EST)
    expect(results[0].startsAt.getUTCHours()).toBe(5);
  });

  it("UNTIL with full datetime form YYYYMMDDTHHMMSSZ", () => {
    const base = makeBase({
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO;UNTIL=20260119T235959Z",
      recurrenceEndDate: null,
    });
    const windowStart = new Date("2026-01-01T00:00:00Z");
    const windowEnd = new Date("2026-02-01T00:00:00Z");
    const results = expandRecurringShift(base, windowStart, windowEnd, NY);
    const dates = occDates(results);
    expect(dates).toContain("2026-01-19");
    expect(dates).not.toContain("2026-01-26");
  });
});

// ─── FREQ=WEEKLY no BYDAY — Saturday on-call bug fix ─────────────────────────

describe("FREQ=WEEKLY no BYDAY — defaults to DTSTART day of week", () => {
  it("Saturday on-call recurs on Saturdays in subsequent weeks", () => {
    // DTSTART is Saturday Jan 10 2026 (UTC date: note NY=UTC-5, so Jan 10 13:00 UTC = Jan 10 08:00 EST)
    const base = makeBase({
      startsAt: new Date("2026-01-10T13:00:00Z"), // Sat Jan 10, 08:00 EST
      endsAt:   new Date("2026-01-10T21:00:00Z"), // Sat Jan 10, 16:00 EST
      recurrenceRule: "FREQ=WEEKLY",               // no BYDAY — must default to Saturday
      timeOfDayStart: "08:00",
      timeOfDayEnd:   "16:00",
    });

    // Query next week (Jan 12–18): should find Sat Jan 17
    const windowStart = new Date("2026-01-12T00:00:00Z");
    const windowEnd   = new Date("2026-01-19T00:00:00Z");
    const results = expandRecurringShift(base, windowStart, windowEnd, NY);
    const dates = occDates(results);

    expect(dates).toContain("2026-01-17"); // Sat Jan 17
    expect(dates).not.toContain("2026-01-12"); // Mon
    expect(dates).not.toContain("2026-01-14"); // Wed
  });

  it("Monday shift recurs on Mondays with no BYDAY", () => {
    const base = makeBase({
      startsAt: new Date("2026-01-05T13:00:00Z"), // Mon Jan 5
      endsAt:   new Date("2026-01-05T21:00:00Z"),
      recurrenceRule: "FREQ=WEEKLY",
      timeOfDayStart: "08:00",
      timeOfDayEnd:   "16:00",
    });

    const windowStart = new Date("2026-01-12T00:00:00Z");
    const windowEnd   = new Date("2026-01-19T00:00:00Z");
    const results = expandRecurringShift(base, windowStart, windowEnd, NY);
    const dates = occDates(results);

    expect(dates).toContain("2026-01-12"); // Mon Jan 12
    expect(dates).not.toContain("2026-01-13"); // Tue — not the DTSTART day
  });

  it("Sunday shift recurs on Sundays with no BYDAY", () => {
    // Jan 11 2026 is a Sunday
    const base = makeBase({
      startsAt: new Date("2026-01-11T13:00:00Z"),
      endsAt:   new Date("2026-01-11T21:00:00Z"),
      recurrenceRule: "FREQ=WEEKLY",
      timeOfDayStart: "08:00",
      timeOfDayEnd:   "16:00",
    });

    const windowStart = new Date("2026-01-18T00:00:00Z");
    const windowEnd   = new Date("2026-01-26T00:00:00Z");
    const results = expandRecurringShift(base, windowStart, windowEnd, NY);
    const dates = occDates(results);

    expect(dates).toContain("2026-01-18"); // Sun Jan 18
    expect(dates).not.toContain("2026-01-19"); // Mon
  });
});

// ─── FREQ=WEEKLY;INTERVAL=2 no BYDAY — biweekly ──────────────────────────────

describe("FREQ=WEEKLY;INTERVAL=2 — biweekly recurrence", () => {
  it("Sat on-call every other week — appears week 2, absent week 1", () => {
    const base = makeBase({
      startsAt: new Date("2026-01-10T13:00:00Z"), // Sat Jan 10 DTSTART
      endsAt:   new Date("2026-01-10T21:00:00Z"),
      recurrenceRule: "FREQ=WEEKLY;INTERVAL=2",
      timeOfDayStart: "08:00",
      timeOfDayEnd:   "16:00",
    });

    // Week 1 (Jan 12–18): skipped — no occurrence
    const w1 = expandRecurringShift(
      base, new Date("2026-01-12T00:00:00Z"), new Date("2026-01-19T00:00:00Z"), NY,
    );
    expect(occDates(w1)).not.toContain("2026-01-17");

    // Week 2 (Jan 19–25): Sat Jan 24 should appear
    const w2 = expandRecurringShift(
      base, new Date("2026-01-19T00:00:00Z"), new Date("2026-01-26T00:00:00Z"), NY,
    );
    expect(occDates(w2)).toContain("2026-01-24");

    // Week 3 (Jan 26–Feb 1): skipped again
    const w3 = expandRecurringShift(
      base, new Date("2026-01-26T00:00:00Z"), new Date("2026-02-02T00:00:00Z"), NY,
    );
    expect(occDates(w3)).not.toContain("2026-01-31");
  });

  it("biweekly with explicit BYDAY", () => {
    const base = makeBase({
      startsAt: new Date("2026-01-10T13:00:00Z"),
      recurrenceRule: "FREQ=WEEKLY;BYDAY=SA,SU;INTERVAL=2",
      timeOfDayStart: "09:00",
      timeOfDayEnd:   "17:00",
    });

    // Week 2 (Jan 19–25): Sat Jan 24 + Sun Jan 25
    const w2 = expandRecurringShift(
      base, new Date("2026-01-19T00:00:00Z"), new Date("2026-01-26T00:00:00Z"), NY,
    );
    const dates = occDates(w2);
    expect(dates).toContain("2026-01-24"); // Sat
    expect(dates).toContain("2026-01-25"); // Sun
  });
});

// ─── All-7-days weekly — date range / vacation ────────────────────────────────

describe("FREQ=WEEKLY;BYDAY=all-7-days — vacation date range", () => {
  it("appears on each day from start through recurrenceEndDate", () => {
    const base: BaseShiftInput = {
      startsAt: new Date("2026-01-12T05:00:00Z"), // Mon Jan 12 00:00 EST
      endsAt:   new Date("2026-01-13T05:00:00Z"),
      allDay: true,
      timeOfDayStart: null,
      timeOfDayEnd:   null,
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU",
      recurrenceEndDate: "2026-01-14", // 3-day block: Mon/Tue/Wed
    };

    const windowStart = new Date("2026-01-12T00:00:00Z");
    const windowEnd   = new Date("2026-01-19T00:00:00Z");

    const results = expandRecurringShift(base, windowStart, windowEnd, NY);
    const dates = occDates(results);

    expect(dates).toContain("2026-01-12"); // Mon
    expect(dates).toContain("2026-01-13"); // Tue
    expect(dates).toContain("2026-01-14"); // Wed
    expect(dates).not.toContain("2026-01-15"); // Thu — after end
    expect(dates).not.toContain("2026-01-19"); // next Mon — after end
  });
});
