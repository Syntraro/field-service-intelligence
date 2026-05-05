/**
 * Week Stack adapter — chronological-rows contract (2026-05-04).
 *
 * Locks the Stack View weekly-review contract:
 *   • Rows are chronological (sorted by `startAt`).
 *   • Consecutive entries with the same `jobId` collapse into ONE row
 *     (drive + on-site → single Job row). Detail breakdown is Day View only.
 *   • Consecutive jobless entries collapse into ONE General Time row.
 *   • Unallocated session minutes (max(0, sessionMinutes - entriesTotal))
 *     surface as ONE synthetic General Time row (`isUnallocated: true`)
 *     inserted at the top of the day.
 *   • day.totalMinutes === day.jobMinutes + day.generalMinutes
 *     === sum(row.totalMinutes for row in rows)
 *     === max(entriesMinutes, sessionMinutes) when session data exists.
 *
 * No DB / fetch mocks — adapter is pure.
 */

import { describe, it, expect } from "vitest";

import {
  buildWeekStackViewModel,
  type WeekStackEntry,
} from "../client/src/components/timesheets/stack/buildWeekStackViewModel";

const WEEK_START = "2026-05-04"; // Monday
const MON = "2026-05-04";
const TUE = "2026-05-05";
const WED = "2026-05-06";

function entry(over: Partial<WeekStackEntry> & { id: string }): WeekStackEntry {
  return {
    id: over.id,
    jobId: over.jobId ?? null,
    jobNumber: over.jobNumber ?? null,
    jobSummary: over.jobSummary ?? null,
    locationName: over.locationName ?? null,
    type: over.type ?? "on_site",
    startAt: over.startAt ?? `${MON}T08:00:00.000Z`,
    endAt: over.endAt ?? `${MON}T10:00:00.000Z`,
    durationMinutes: over.durationMinutes ?? 120,
    billable: over.billable ?? true,
    date: over.date ?? MON,
  };
}

function findDay(vm: ReturnType<typeof buildWeekStackViewModel>, date: string) {
  return vm.days.find((d) => d.date === date)!;
}

function generalRows(rows: ReturnType<typeof buildWeekStackViewModel>["days"][number]["rows"]) {
  return rows.filter((r) => r.kind === "general");
}

function jobRows(rows: ReturnType<typeof buildWeekStackViewModel>["days"][number]["rows"]) {
  return rows.filter((r) => r.kind === "job");
}

describe("buildWeekStackViewModel — job-only entries", () => {
  it("collapses consecutive same-job entries (e.g. drive + on-site) into one Job row", () => {
    const vm = buildWeekStackViewModel({
      weekStart: WEEK_START,
      entries: [
        entry({
          id: "a",
          jobId: "job-1",
          jobNumber: 1001,
          locationName: "Acme",
          type: "travel_to_job",
          startAt: `${MON}T08:00:00.000Z`,
          endAt: `${MON}T08:30:00.000Z`,
          durationMinutes: 30,
        }),
        entry({
          id: "b",
          jobId: "job-1",
          jobNumber: 1001,
          locationName: "Acme",
          type: "on_site",
          startAt: `${MON}T08:30:00.000Z`,
          endAt: `${MON}T10:00:00.000Z`,
          durationMinutes: 90,
        }),
      ],
    });
    const mon = findDay(vm, MON);
    expect(mon.rows).toHaveLength(1);
    expect(mon.rows[0].kind).toBe("job");
    expect(mon.rows[0].jobId).toBe("job-1");
    expect(mon.rows[0].totalMinutes).toBe(120);
    expect(mon.rows[0].entryCount).toBe(2);
    expect(mon.jobMinutes).toBe(120);
    expect(mon.generalMinutes).toBe(0);
    expect(mon.totalMinutes).toBe(120);
  });

  it("emits separate Job rows when the same job is interleaved with another job", () => {
    const vm = buildWeekStackViewModel({
      weekStart: WEEK_START,
      entries: [
        entry({ id: "a", jobId: "job-1", jobNumber: 1001, durationMinutes: 30, startAt: `${MON}T08:00:00.000Z` }),
        entry({ id: "b", jobId: "job-2", jobNumber: 1002, durationMinutes: 60, startAt: `${MON}T08:30:00.000Z` }),
        entry({ id: "c", jobId: "job-1", jobNumber: 1001, durationMinutes: 30, startAt: `${MON}T09:30:00.000Z` }),
      ],
    });
    const mon = findDay(vm, MON);
    expect(mon.rows).toHaveLength(3);
    expect(mon.rows.map((r) => r.jobId)).toEqual(["job-1", "job-2", "job-1"]);
    expect(mon.rows.map((r) => r.totalMinutes)).toEqual([30, 60, 30]);
    expect(mon.jobMinutes).toBe(120);
    expect(mon.generalMinutes).toBe(0);
  });
});

describe("buildWeekStackViewModel — general-only entries", () => {
  it("collapses consecutive jobless entries into a single General Time row", () => {
    const vm = buildWeekStackViewModel({
      weekStart: WEEK_START,
      entries: [
        entry({ id: "a", jobId: null, type: "admin", durationMinutes: 30, startAt: `${MON}T08:00:00.000Z` }),
        entry({ id: "b", jobId: null, type: "other", durationMinutes: 45, startAt: `${MON}T08:30:00.000Z` }),
      ],
    });
    const mon = findDay(vm, MON);
    expect(mon.rows).toHaveLength(1);
    expect(mon.rows[0].kind).toBe("general");
    expect(mon.rows[0].totalMinutes).toBe(75);
    expect(mon.rows[0].entryCount).toBe(2);
    expect(mon.rows[0].isUnallocated).toBe(false);
    expect(mon.jobMinutes).toBe(0);
    expect(mon.generalMinutes).toBe(75);
  });
});

describe("buildWeekStackViewModel — no entries but session time exists", () => {
  it("emits ONE synthetic General Time row carrying the full session minutes", () => {
    const vm = buildWeekStackViewModel({
      weekStart: WEEK_START,
      entries: [],
      dailySessionMinutes: { [MON]: 240 },
    });
    const mon = findDay(vm, MON);
    expect(mon.rows).toHaveLength(1);
    const r = mon.rows[0];
    expect(r.kind).toBe("general");
    expect(r.isUnallocated).toBe(true);
    expect(r.entryCount).toBe(0);
    expect(r.totalMinutes).toBe(240);
    expect(mon.entriesMinutes).toBe(0);
    expect(mon.sessionMinutes).toBe(240);
    expect(mon.unallocatedSessionMinutes).toBe(240);
    expect(mon.totalMinutes).toBe(240);
    expect(mon.jobMinutes).toBe(0);
    expect(mon.generalMinutes).toBe(240);
  });

  it("emits no rows when session time is zero and there are no entries", () => {
    const vm = buildWeekStackViewModel({
      weekStart: WEEK_START,
      entries: [],
      dailySessionMinutes: { [MON]: 0 },
    });
    const mon = findDay(vm, MON);
    expect(mon.rows).toHaveLength(0);
    expect(mon.totalMinutes).toBe(0);
    expect(mon.unallocatedSessionMinutes).toBe(0);
  });
});

describe("buildWeekStackViewModel — session minutes exceed allocated entries", () => {
  it("prepends a synthetic unallocated General Time row at the top of the day", () => {
    const vm = buildWeekStackViewModel({
      weekStart: WEEK_START,
      entries: [
        entry({
          id: "a",
          jobId: "job-1",
          jobNumber: 1001,
          durationMinutes: 180,
          startAt: `${MON}T09:00:00.000Z`,
        }),
        entry({
          id: "b",
          jobId: null,
          type: "admin",
          durationMinutes: 30,
          startAt: `${MON}T12:00:00.000Z`,
        }),
      ],
      dailySessionMinutes: { [MON]: 480 },
    });
    const mon = findDay(vm, MON);
    expect(mon.entriesMinutes).toBe(210);
    expect(mon.sessionMinutes).toBe(480);
    expect(mon.unallocatedSessionMinutes).toBe(270);
    // Three rows: synthetic unallocated, job, real general entry — in order.
    expect(mon.rows).toHaveLength(3);
    expect(mon.rows[0].kind).toBe("general");
    expect(mon.rows[0].isUnallocated).toBe(true);
    expect(mon.rows[0].totalMinutes).toBe(270);
    expect(mon.rows[1].kind).toBe("job");
    expect(mon.rows[1].totalMinutes).toBe(180);
    expect(mon.rows[2].kind).toBe("general");
    expect(mon.rows[2].isUnallocated).toBe(false);
    expect(mon.rows[2].totalMinutes).toBe(30);
    // Day total invariant.
    expect(mon.totalMinutes).toBe(480);
    expect(mon.totalMinutes).toBe(mon.rows.reduce((s, r) => s + r.totalMinutes, 0));
    expect(mon.jobMinutes).toBe(180);
    expect(mon.generalMinutes).toBe(300);
  });
});

describe("buildWeekStackViewModel — allocated entries equal or exceed session total", () => {
  it("does not invent any synthetic row when entries cover the session exactly", () => {
    const vm = buildWeekStackViewModel({
      weekStart: WEEK_START,
      entries: [
        entry({ id: "a", jobId: "job-1", jobNumber: 1001, durationMinutes: 240, startAt: `${MON}T08:00:00.000Z` }),
        entry({ id: "b", jobId: "job-2", jobNumber: 1002, durationMinutes: 240, startAt: `${MON}T12:00:00.000Z` }),
      ],
      dailySessionMinutes: { [MON]: 480 },
    });
    const mon = findDay(vm, MON);
    expect(mon.rows).toHaveLength(2);
    expect(mon.rows.every((r) => !r.isUnallocated)).toBe(true);
    expect(mon.unallocatedSessionMinutes).toBe(0);
    expect(mon.totalMinutes).toBe(480);
  });

  it("entries-win contract: when entries exceed session, no row is truncated", () => {
    const vm = buildWeekStackViewModel({
      weekStart: WEEK_START,
      entries: [
        entry({ id: "a", jobId: "job-1", jobNumber: 1001, durationMinutes: 600, startAt: `${MON}T08:00:00.000Z` }),
      ],
      dailySessionMinutes: { [MON]: 240 },
    });
    const mon = findDay(vm, MON);
    expect(mon.entriesMinutes).toBe(600);
    expect(mon.sessionMinutes).toBe(240);
    expect(mon.unallocatedSessionMinutes).toBe(0);
    expect(mon.rows).toHaveLength(1);
    expect(mon.rows[0].totalMinutes).toBe(600);
    expect(mon.totalMinutes).toBe(600);
  });
});

describe("buildWeekStackViewModel — chronological mix (the canonical scenario)", () => {
  it("interleaves job + general rows in time order with leading unallocated row", () => {
    // Tech is clocked in 7:30–11:00 (210 min). First entry starts at 8:00 →
    // 30 min unallocated. Then: General Time (admin) from 8:00–8:15, Job
    // from 8:15–9:30, General (break) from 9:30–9:45, Job from 9:45–10:30.
    const vm = buildWeekStackViewModel({
      weekStart: WEEK_START,
      entries: [
        entry({
          id: "g1",
          jobId: null,
          type: "admin",
          startAt: `${MON}T08:00:00.000Z`,
          endAt: `${MON}T08:15:00.000Z`,
          durationMinutes: 15,
        }),
        entry({
          id: "j1",
          jobId: "job-A",
          jobNumber: 100000,
          locationName: "Cards Are Us",
          jobSummary: "fix",
          type: "on_site",
          startAt: `${MON}T08:15:00.000Z`,
          endAt: `${MON}T09:30:00.000Z`,
          durationMinutes: 75,
        }),
        entry({
          id: "g2",
          jobId: null,
          type: "break",
          startAt: `${MON}T09:30:00.000Z`,
          endAt: `${MON}T09:45:00.000Z`,
          durationMinutes: 15,
        }),
        entry({
          id: "j2",
          jobId: "job-B",
          jobNumber: 100045,
          locationName: "ABC Industries",
          jobSummary: "maintenance",
          type: "on_site",
          startAt: `${MON}T09:45:00.000Z`,
          endAt: `${MON}T10:30:00.000Z`,
          durationMinutes: 45,
        }),
      ],
      dailySessionMinutes: { [MON]: 180 }, // 30 unallocated
    });

    const mon = findDay(vm, MON);
    expect(mon.rows).toHaveLength(5);
    expect(mon.rows.map((r) => r.kind)).toEqual([
      "general", // unallocated
      "general", // admin
      "job",     // #100000
      "general", // break
      "job",     // #100045
    ]);
    expect(mon.rows[0].isUnallocated).toBe(true);
    expect(mon.rows[0].totalMinutes).toBe(30);
    expect(mon.rows[1].totalMinutes).toBe(15);
    expect(mon.rows[2].jobNumber).toBe(100000);
    expect(mon.rows[2].locationName).toBe("Cards Are Us");
    expect(mon.rows[3].totalMinutes).toBe(15);
    expect(mon.rows[4].jobNumber).toBe(100045);

    expect(mon.jobMinutes).toBe(75 + 45);
    expect(mon.generalMinutes).toBe(30 + 15 + 15);
    expect(mon.totalMinutes).toBe(180);
    expect(mon.totalMinutes).toBe(mon.rows.reduce((s, r) => s + r.totalMinutes, 0));
  });
});

describe("buildWeekStackViewModel — multi-day weekly totals", () => {
  it("correctly accumulates job/general totals across multiple days without leakage", () => {
    const vm = buildWeekStackViewModel({
      weekStart: WEEK_START,
      entries: [
        // Mon: 4h on a job + 1h general; session 8h → 3h unallocated
        entry({
          id: "m-job",
          date: MON,
          jobId: "job-1",
          jobNumber: 1001,
          locationName: "Acme",
          type: "on_site",
          startAt: `${MON}T08:00:00.000Z`,
          endAt: `${MON}T12:00:00.000Z`,
          durationMinutes: 240,
        }),
        entry({
          id: "m-gen",
          date: MON,
          jobId: null,
          type: "admin",
          startAt: `${MON}T12:00:00.000Z`,
          endAt: `${MON}T13:00:00.000Z`,
          durationMinutes: 60,
        }),
        // Tue: 6h on a job; session 6h → 0 unallocated
        entry({
          id: "t-job",
          date: TUE,
          jobId: "job-2",
          jobNumber: 1002,
          locationName: "Beta",
          type: "on_site",
          startAt: `${TUE}T09:00:00.000Z`,
          endAt: `${TUE}T15:00:00.000Z`,
          durationMinutes: 360,
        }),
        // Wed: only session, no entries → 5h general unallocated
      ],
      dailySessionMinutes: {
        [MON]: 480,
        [TUE]: 360,
        [WED]: 300,
      },
    });

    expect(findDay(vm, MON).totalMinutes).toBe(480);
    expect(findDay(vm, MON).jobMinutes).toBe(240);
    expect(findDay(vm, MON).generalMinutes).toBe(240); // 60 admin + 180 unallocated
    expect(findDay(vm, MON).rows.filter((r) => r.isUnallocated)).toHaveLength(1);
    expect(findDay(vm, MON).rows.find((r) => r.isUnallocated)!.totalMinutes).toBe(180);

    expect(findDay(vm, TUE).totalMinutes).toBe(360);
    expect(findDay(vm, TUE).jobMinutes).toBe(360);
    expect(findDay(vm, TUE).generalMinutes).toBe(0);

    expect(findDay(vm, WED).totalMinutes).toBe(300);
    expect(findDay(vm, WED).jobMinutes).toBe(0);
    expect(findDay(vm, WED).generalMinutes).toBe(300);
    expect(findDay(vm, WED).rows).toHaveLength(1);
    expect(findDay(vm, WED).rows[0].isUnallocated).toBe(true);

    // Week totals.
    expect(vm.weekTotals.totalMinutes).toBe(480 + 360 + 300);
    expect(vm.weekTotals.jobMinutes).toBe(240 + 360);
    expect(vm.weekTotals.generalMinutes).toBe(240 + 0 + 300);
    // Sanity: job + general === total.
    expect(vm.weekTotals.jobMinutes + vm.weekTotals.generalMinutes).toBe(
      vm.weekTotals.totalMinutes,
    );
  });
});

describe("buildWeekStackViewModel — invariants", () => {
  it("day.totalMinutes === sum(row.totalMinutes) for every day", () => {
    const vm = buildWeekStackViewModel({
      weekStart: WEEK_START,
      entries: [
        entry({ id: "a", date: MON, jobId: "j1", jobNumber: 1, durationMinutes: 75, startAt: `${MON}T08:00:00.000Z` }),
        entry({ id: "b", date: MON, jobId: null, type: "break", durationMinutes: 15, startAt: `${MON}T09:15:00.000Z` }),
        entry({ id: "c", date: TUE, jobId: "j1", jobNumber: 1, durationMinutes: 200, startAt: `${TUE}T09:00:00.000Z` }),
      ],
      dailySessionMinutes: { [MON]: 300, [TUE]: 200 },
    });
    for (const day of vm.days) {
      const sum = day.rows.reduce((s, r) => s + r.totalMinutes, 0);
      expect(day.totalMinutes).toBe(sum);
      expect(day.totalMinutes).toBe(day.jobMinutes + day.generalMinutes);
    }
  });

  it("rows are sorted in chronological order within each day", () => {
    const vm = buildWeekStackViewModel({
      weekStart: WEEK_START,
      entries: [
        // Intentionally out-of-order on input.
        entry({ id: "c", date: MON, jobId: "j2", jobNumber: 2, durationMinutes: 30, startAt: `${MON}T11:00:00.000Z` }),
        entry({ id: "a", date: MON, jobId: "j1", jobNumber: 1, durationMinutes: 30, startAt: `${MON}T08:00:00.000Z` }),
        entry({ id: "b", date: MON, jobId: null, type: "admin", durationMinutes: 30, startAt: `${MON}T09:00:00.000Z` }),
      ],
    });
    const mon = findDay(vm, MON);
    const sortMs = mon.rows.map((r) => r.sortMs);
    const sorted = [...sortMs].sort((a, b) => a - b);
    expect(sortMs).toEqual(sorted);
  });
});
