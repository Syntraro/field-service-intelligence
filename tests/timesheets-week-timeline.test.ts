/**
 * Week Timeline — adapter + view-model unit tests +
 * dispatch-style architecture guards (2026-05-04 v2).
 *
 * Iteration 1 / read-only MVP coverage:
 *   • timeBlockAdapter is a pure function — every test exercises it
 *     deterministically without any DB / fetch mocks.
 *   • Source-level guards lock the dispatch-board visual contract:
 *     no card-inside-card, no standalone "Week Timeline" header card,
 *     mounted INSIDE PayrollPage's `viewMode === "week"` block, no
 *     mutations, no modals, deep-links back into Day View.
 *   • DayView untouched (regression guard).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

import {
  buildWeekTimelineViewModel,
  computeBlockGeometry,
  computeBlockPercent,
  computeStripRange,
  computeWeekStripRange,
  formatMinutes,
  groupBlocksForDay,
  STRIP_CLAMP_END_HOUR,
  STRIP_CLAMP_START_HOUR,
  type WeekTimesheetEntry,
  type DayTimeline,
  type TimeBlock,
} from "../client/src/components/timesheets/timeline/timeBlockAdapter";

// ─── Fixture builder ───────────────────────────────────────────────────────

const TENANT = "tenant-1";
const TECH = "tech-1";
const WEEK_START = "2026-05-04"; // Monday

function entry(over: Partial<WeekTimesheetEntry> = {}): WeekTimesheetEntry {
  return {
    id: over.id ?? `e-${Math.random().toString(36).slice(2, 9)}`,
    technicianId: TECH,
    jobId: "job-1",
    visitId: null,
    taskId: null,
    type: "on_site",
    startAt: "2026-05-04T08:00:00.000Z",
    endAt: "2026-05-04T11:00:00.000Z",
    durationMinutes: 180,
    billable: true,
    notes: null,
    jobNumber: 1001,
    jobSummary: "Test job",
    locationName: "Acme HQ",
    date: "2026-05-04",
    ...over,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Layer 0 — adapter behaviour (unchanged from v1)
// ═══════════════════════════════════════════════════════════════════════════

describe("buildWeekTimelineViewModel — skeleton", () => {
  it("emits a 7-day skeleton even with zero entries", () => {
    const vm = buildWeekTimelineViewModel({
      weekStart: WEEK_START,
      userId: TECH,
      entries: [],
    });
    expect(vm.days).toHaveLength(7);
    expect(vm.days.map((d) => d.dayIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(vm.days[0].date).toBe("2026-05-04"); // Mon
    expect(vm.days[6].date).toBe("2026-05-10"); // Sun
    expect(vm.weekTotals.totalMinutes).toBe(0);
    expect(vm.weekTotals.byCategory).toEqual({ onsite: 0, drive: 0, general: 0 });
  });
});

describe("buildWeekTimelineViewModel — bucketing", () => {
  it("buckets entries into the correct day", () => {
    const vm = buildWeekTimelineViewModel({
      weekStart: WEEK_START,
      userId: TECH,
      entries: [
        entry({ date: "2026-05-04", id: "mon" }),
        entry({ date: "2026-05-06", id: "wed" }),
        entry({ date: "2026-05-10", id: "sun" }),
      ],
    });
    expect(vm.days[0].blocks.map((b) => b.id)).toEqual(["mon"]);
    expect(vm.days[2].blocks.map((b) => b.id)).toEqual(["wed"]);
    expect(vm.days[6].blocks.map((b) => b.id)).toEqual(["sun"]);
  });

  it("ignores entries that fall outside the queried week (defensive)", () => {
    const vm = buildWeekTimelineViewModel({
      weekStart: WEEK_START,
      userId: TECH,
      entries: [
        entry({ date: "2026-04-27", id: "before" }),
        entry({ date: "2026-05-04", id: "in" }),
        entry({ date: "2026-05-11", id: "after" }),
      ],
    });
    const allBlocks = vm.days.flatMap((d) => d.blocks).map((b) => b.id);
    expect(allBlocks).toEqual(["in"]);
  });

  it("sorts blocks within a day by start time ascending", () => {
    const vm = buildWeekTimelineViewModel({
      weekStart: WEEK_START,
      userId: TECH,
      entries: [
        entry({
          id: "afternoon",
          startAt: "2026-05-04T14:00:00.000Z",
          endAt: "2026-05-04T15:00:00.000Z",
          durationMinutes: 60,
        }),
        entry({
          id: "morning",
          startAt: "2026-05-04T08:00:00.000Z",
          endAt: "2026-05-04T09:00:00.000Z",
          durationMinutes: 60,
        }),
      ],
    });
    expect(vm.days[0].blocks.map((b) => b.id)).toEqual(["morning", "afternoon"]);
  });

  it("drops running entries (endAt = null) — they belong on Day View, not week overview", () => {
    const vm = buildWeekTimelineViewModel({
      weekStart: WEEK_START,
      userId: TECH,
      entries: [
        entry({ id: "running", endAt: null, durationMinutes: null }),
        entry({ id: "finished" }),
      ],
    });
    const ids = vm.days.flatMap((d) => d.blocks).map((b) => b.id);
    expect(ids).toEqual(["finished"]);
  });

  it("drops zero/negative-duration entries", () => {
    const vm = buildWeekTimelineViewModel({
      weekStart: WEEK_START,
      userId: TECH,
      entries: [
        entry({
          id: "zero",
          startAt: "2026-05-04T08:00:00.000Z",
          endAt: "2026-05-04T08:00:00.000Z",
          durationMinutes: 0,
        }),
        entry({ id: "ok" }),
      ],
    });
    const ids = vm.days.flatMap((d) => d.blocks).map((b) => b.id);
    expect(ids).toEqual(["ok"]);
  });
});

describe("buildWeekTimelineViewModel — categorisation", () => {
  it("maps drive enum types to `drive`", () => {
    const vm = buildWeekTimelineViewModel({
      weekStart: WEEK_START,
      userId: TECH,
      entries: [
        entry({ id: "ttj", type: "travel_to_job" }),
        entry({ id: "tts", type: "travel_to_supplier" }),
        entry({ id: "tbj", type: "travel_between_jobs" }),
        entry({ id: "sr", type: "supplier_run" }),
      ],
    });
    expect(vm.days[0].blocks.map((b) => b.category)).toEqual([
      "drive",
      "drive",
      "drive",
      "drive",
    ]);
  });

  it("maps on-site enum types to `onsite`", () => {
    const vm = buildWeekTimelineViewModel({
      weekStart: WEEK_START,
      userId: TECH,
      entries: [
        entry({ id: "os", type: "on_site" }),
        entry({ id: "tw", type: "task_work" }),
      ],
    });
    expect(vm.days[0].blocks.map((b) => b.category)).toEqual(["onsite", "onsite"]);
  });

  it("maps admin / break / other / unknown to `general`", () => {
    const vm = buildWeekTimelineViewModel({
      weekStart: WEEK_START,
      userId: TECH,
      entries: [
        entry({ id: "ad", type: "admin" }),
        entry({ id: "br", type: "break" }),
        entry({ id: "ot", type: "other" }),
        entry({ id: "uk", type: "wat_is_dis" }),
      ],
    });
    expect(vm.days[0].blocks.map((b) => b.category)).toEqual([
      "general",
      "general",
      "general",
      "general",
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Layer 0 v4 — grouped cards (date, jobId, visitId)
// ═══════════════════════════════════════════════════════════════════════════

describe("groupBlocksForDay — combine drive + on-site for same job/visit", () => {
  function rawBlock(over: Partial<TimeBlock>): TimeBlock {
    // Defaults via spread so callers can EXPLICITLY pass null for
    // `jobId` / `visitId` to test the no-job-context grouping path
    // (a `??` fallback would silently coerce null back to the default).
    return {
      id: "x",
      date: "2026-05-04",
      start: "2026-05-04T16:46:00.000Z",
      end: "2026-05-04T17:31:00.000Z",
      durationMinutes: 45,
      category: "drive",
      rawType: "travel_to_job",
      jobId: "job-1",
      visitId: "visit-1",
      jobNumber: 9001,
      jobSummary: null,
      locationName: "Cards Are Us",
      notes: null,
      billable: true,
      ...over,
    };
  }

  it("collapses Drive (4:46–5:31) + On-site (5:31–6:00) for same visit into ONE group", () => {
    const drive = rawBlock({
      id: "drive-1",
      start: "2026-05-04T16:46:00.000Z",
      end: "2026-05-04T17:31:00.000Z",
      durationMinutes: 45,
      category: "drive",
      rawType: "travel_to_job",
    });
    const onsite = rawBlock({
      id: "onsite-1",
      start: "2026-05-04T17:31:00.000Z",
      end: "2026-05-04T18:00:00.000Z",
      durationMinutes: 29,
      category: "onsite",
      rawType: "on_site",
    });
    const groups = groupBlocksForDay([drive, onsite]);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.start).toBe(drive.start); // earliest
    expect(g.end).toBe(onsite.end); // latest
    expect(g.durationMinutes).toBe(45 + 29); // SUM, not span
    expect(g.members).toHaveLength(2);
    expect(g.isMixedCategory).toBe(true);
    expect(g.memberCategoryMinutes).toEqual({
      onsite: 29,
      drive: 45,
      general: 0,
    });
  });

  it("predominant category wins (here: drive, since 45m > 29m on-site)", () => {
    const drive = rawBlock({
      id: "drive-1",
      durationMinutes: 45,
      category: "drive",
      rawType: "travel_to_job",
    });
    const onsite = rawBlock({
      id: "onsite-1",
      start: "2026-05-04T17:31:00.000Z",
      end: "2026-05-04T18:00:00.000Z",
      durationMinutes: 29,
      category: "onsite",
      rawType: "on_site",
    });
    const groups = groupBlocksForDay([drive, onsite]);
    expect(groups[0].category).toBe("drive");
  });

  it("ties between equal-minute categories prefer onsite > drive > general", () => {
    const drive = rawBlock({
      id: "d",
      durationMinutes: 30,
      category: "drive",
      rawType: "travel_to_job",
      start: "2026-05-04T16:00:00.000Z",
      end: "2026-05-04T16:30:00.000Z",
    });
    const onsite = rawBlock({
      id: "o",
      durationMinutes: 30,
      category: "onsite",
      rawType: "on_site",
      start: "2026-05-04T16:30:00.000Z",
      end: "2026-05-04T17:00:00.000Z",
    });
    const groups = groupBlocksForDay([drive, onsite]);
    expect(groups[0].category).toBe("onsite");
  });

  it("does NOT combine entries from different jobs", () => {
    const a = rawBlock({ id: "a", jobId: "job-A", visitId: "v-A" });
    const b = rawBlock({
      id: "b",
      jobId: "job-B",
      visitId: "v-B",
      start: "2026-05-04T18:00:00.000Z",
      end: "2026-05-04T19:00:00.000Z",
      durationMinutes: 60,
    });
    const groups = groupBlocksForDay([a, b]);
    expect(groups).toHaveLength(2);
  });

  it("does NOT combine entries from different visits even on the same job", () => {
    const v1 = rawBlock({
      id: "v1-drive",
      jobId: "job-1",
      visitId: "visit-1",
    });
    const v2 = rawBlock({
      id: "v2-drive",
      jobId: "job-1",
      visitId: "visit-2",
      start: "2026-05-04T19:00:00.000Z",
      end: "2026-05-04T20:00:00.000Z",
      durationMinutes: 60,
    });
    const groups = groupBlocksForDay([v1, v2]);
    expect(groups).toHaveLength(2);
  });

  it("combines same-job entries when visitId is missing on both", () => {
    const drive = rawBlock({
      id: "d",
      jobId: "job-1",
      visitId: null,
    });
    const onsite = rawBlock({
      id: "o",
      jobId: "job-1",
      visitId: null,
      start: "2026-05-04T17:31:00.000Z",
      end: "2026-05-04T18:00:00.000Z",
      durationMinutes: 29,
      category: "onsite",
      rawType: "on_site",
    });
    const groups = groupBlocksForDay([drive, onsite]);
    expect(groups).toHaveLength(1);
    expect(groups[0].durationMinutes).toBe(45 + 29);
  });

  it("KEEPS general / no-job entries separate (no shared site context)", () => {
    const adminA = rawBlock({
      id: "a",
      jobId: null,
      visitId: null,
      category: "general",
      rawType: "admin",
    });
    const adminB = rawBlock({
      id: "b",
      jobId: null,
      visitId: null,
      category: "general",
      rawType: "break",
      start: "2026-05-04T18:00:00.000Z",
      end: "2026-05-04T18:15:00.000Z",
      durationMinutes: 15,
    });
    const groups = groupBlocksForDay([adminA, adminB]);
    expect(groups).toHaveLength(2);
  });

  it("a jobless entry survives as a renderable group (the 'General' clocked-in path)", () => {
    // Brief: "Any time where a user is clocked in but not assigned to
    // a job, linked to a visit, driving/en-route — must be treated as
    // General. Do not drop clocked-in-but-unassigned time."
    //
    // The adapter doesn't know the literal "General" label (that's a
    // renderer concern), but it MUST emit a group for the jobless
    // entry so the renderer has something to display. This test pins
    // the data path: a single jobless entry → exactly one group, with
    // the right billable + duration data + ID for the renderer to
    // resolve the "General" / "Unbillable" labels.
    const generalNonBillable = rawBlock({
      id: "g1",
      jobId: null,
      visitId: null,
      jobNumber: null,
      jobSummary: null,
      locationName: null,
      category: "general",
      rawType: "admin",
      billable: false,
      durationMinutes: 30,
    });
    const groups = groupBlocksForDay([generalNonBillable]);
    expect(groups).toHaveLength(1);
    expect(groups[0].jobId).toBeNull();
    expect(groups[0].billable).toBe(false);
    expect(groups[0].durationMinutes).toBe(30);
  });

  it("singleton group reuses the lone block's id (no synthesised prefix)", () => {
    const lone = rawBlock({ id: "lone-1" });
    const groups = groupBlocksForDay([lone]);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("lone-1");
  });

  it("multi-member group synthesises a stable id from member ids", () => {
    const a = rawBlock({ id: "a" });
    const b = rawBlock({
      id: "b",
      start: "2026-05-04T17:31:00.000Z",
      end: "2026-05-04T18:00:00.000Z",
      durationMinutes: 29,
      category: "onsite",
      rawType: "on_site",
    });
    const groups = groupBlocksForDay([a, b]);
    expect(groups[0].id).toBe("group-a+b");
  });

  it("group span (start/end) tracks the earliest start AND latest end across members", () => {
    const middle = rawBlock({
      id: "m",
      start: "2026-05-04T17:00:00.000Z",
      end: "2026-05-04T17:30:00.000Z",
      durationMinutes: 30,
    });
    const early = rawBlock({
      id: "e",
      start: "2026-05-04T16:00:00.000Z",
      end: "2026-05-04T16:30:00.000Z",
      durationMinutes: 30,
    });
    const late = rawBlock({
      id: "l",
      start: "2026-05-04T18:00:00.000Z",
      end: "2026-05-04T19:00:00.000Z",
      durationMinutes: 60,
    });
    const groups = groupBlocksForDay([middle, early, late]);
    expect(groups).toHaveLength(1);
    expect(groups[0].start).toBe(early.start);
    expect(groups[0].end).toBe(late.end);
    // SUM of durations, NOT (latest - earliest) span (which would be 3h).
    expect(groups[0].durationMinutes).toBe(30 + 30 + 60);
  });

  it("group billable = OR over members (any billable member → group billable)", () => {
    const billable = rawBlock({ id: "b1", billable: true });
    const nonBillable = rawBlock({
      id: "n1",
      billable: false,
      start: "2026-05-04T17:31:00.000Z",
      end: "2026-05-04T18:00:00.000Z",
      durationMinutes: 29,
      category: "onsite",
      rawType: "on_site",
    });
    expect(groupBlocksForDay([billable, nonBillable])[0].billable).toBe(true);
  });
});

describe("buildWeekTimelineViewModel — groups co-exist with raw blocks", () => {
  it("preserves raw `blocks` even after grouping (entry-level data unchanged)", () => {
    const vm = buildWeekTimelineViewModel({
      weekStart: WEEK_START,
      userId: TECH,
      entries: [
        // Same visit, drive + on-site
        entry({
          id: "drive",
          type: "travel_to_job",
          jobId: "job-1",
          visitId: "visit-1",
          startAt: "2026-05-04T16:46:00.000Z",
          endAt: "2026-05-04T17:31:00.000Z",
          durationMinutes: 45,
        }),
        entry({
          id: "onsite",
          type: "on_site",
          jobId: "job-1",
          visitId: "visit-1",
          startAt: "2026-05-04T17:31:00.000Z",
          endAt: "2026-05-04T18:00:00.000Z",
          durationMinutes: 29,
        }),
      ],
    });
    // Raw entries are NOT mutated — both blocks survive on `day.blocks`.
    expect(vm.days[0].blocks).toHaveLength(2);
    expect(vm.days[0].blocks.map((b) => b.id).sort()).toEqual([
      "drive",
      "onsite",
    ]);
    // Grouping produces ONE visible card.
    expect(vm.days[0].groups).toHaveLength(1);
    expect(vm.days[0].groups[0].durationMinutes).toBe(45 + 29);
  });

  it("week + day category totals come from RAW blocks, not groups (drive vs on-site preserved)", () => {
    const vm = buildWeekTimelineViewModel({
      weekStart: WEEK_START,
      userId: TECH,
      entries: [
        entry({
          id: "drive",
          type: "travel_to_job",
          jobId: "job-1",
          visitId: "visit-1",
          durationMinutes: 45,
        }),
        entry({
          id: "onsite",
          type: "on_site",
          jobId: "job-1",
          visitId: "visit-1",
          startAt: "2026-05-04T17:31:00.000Z",
          endAt: "2026-05-04T18:00:00.000Z",
          durationMinutes: 29,
        }),
      ],
    });
    // Per-day: drive 45m, on-site 29m, general 0m — header pills must
    // still see this exact split even though the visible card is one
    // grouped 1h14m chip on the timeline.
    expect(vm.days[0].byCategory).toEqual({
      drive: 45,
      onsite: 29,
      general: 0,
    });
    expect(vm.weekTotals.byCategory).toEqual({
      drive: 45,
      onsite: 29,
      general: 0,
    });
  });
});

describe("buildWeekTimelineViewModel — totals", () => {
  it("sums per-day totalMinutes correctly", () => {
    const vm = buildWeekTimelineViewModel({
      weekStart: WEEK_START,
      userId: TECH,
      entries: [
        entry({ date: "2026-05-04", durationMinutes: 60 }),
        entry({ date: "2026-05-04", durationMinutes: 90 }),
        entry({ date: "2026-05-05", durationMinutes: 240 }),
      ],
    });
    expect(vm.days[0].totalMinutes).toBe(150);
    expect(vm.days[1].totalMinutes).toBe(240);
    expect(vm.days[2].totalMinutes).toBe(0);
  });

  it("sums weekly totalMinutes across all days", () => {
    const vm = buildWeekTimelineViewModel({
      weekStart: WEEK_START,
      userId: TECH,
      entries: [
        entry({ date: "2026-05-04", durationMinutes: 60 }),
        entry({ date: "2026-05-06", durationMinutes: 120 }),
        entry({ date: "2026-05-09", durationMinutes: 30 }),
      ],
    });
    expect(vm.weekTotals.totalMinutes).toBe(210);
  });

  it("emits per-category breakdown per day AND week", () => {
    const vm = buildWeekTimelineViewModel({
      weekStart: WEEK_START,
      userId: TECH,
      entries: [
        entry({ date: "2026-05-04", type: "travel_to_job", durationMinutes: 30 }),
        entry({ date: "2026-05-04", type: "on_site", durationMinutes: 180 }),
        entry({ date: "2026-05-04", type: "admin", durationMinutes: 15 }),
        entry({ date: "2026-05-05", type: "on_site", durationMinutes: 240 }),
      ],
    });
    expect(vm.days[0].byCategory).toEqual({
      drive: 30,
      onsite: 180,
      general: 15,
    });
    expect(vm.weekTotals.byCategory).toEqual({
      drive: 30,
      onsite: 420,
      general: 15,
    });
  });

  it("recomputes durationMinutes locally if server null/zero (defensive)", () => {
    const vm = buildWeekTimelineViewModel({
      weekStart: WEEK_START,
      userId: TECH,
      entries: [
        entry({
          startAt: "2026-05-04T08:00:00.000Z",
          endAt: "2026-05-04T10:30:00.000Z",
          durationMinutes: null as any,
        }),
      ],
    });
    expect(vm.days[0].blocks[0].durationMinutes).toBe(150);
    expect(vm.days[0].totalMinutes).toBe(150);
  });
});

describe("buildWeekTimelineViewModel — overlap detection", () => {
  it("detects overlapping blocks within a single day", () => {
    const vm = buildWeekTimelineViewModel({
      weekStart: WEEK_START,
      userId: TECH,
      entries: [
        entry({
          id: "a",
          startAt: "2026-05-04T08:00:00.000Z",
          endAt: "2026-05-04T10:00:00.000Z",
          durationMinutes: 120,
        }),
        entry({
          id: "b",
          startAt: "2026-05-04T09:00:00.000Z",
          endAt: "2026-05-04T11:00:00.000Z",
          durationMinutes: 120,
        }),
      ],
    });
    expect(vm.days[0].overlaps).toEqual([["a", "b"]]);
  });

  it("does NOT flag back-to-back blocks (end of A = start of B)", () => {
    const vm = buildWeekTimelineViewModel({
      weekStart: WEEK_START,
      userId: TECH,
      entries: [
        entry({
          id: "a",
          startAt: "2026-05-04T08:00:00.000Z",
          endAt: "2026-05-04T10:00:00.000Z",
          durationMinutes: 120,
        }),
        entry({
          id: "b",
          startAt: "2026-05-04T10:00:00.000Z",
          endAt: "2026-05-04T11:00:00.000Z",
          durationMinutes: 60,
        }),
      ],
    });
    expect(vm.days[0].overlaps).toEqual([]);
  });

  it("returns empty overlap list when no overlaps", () => {
    const vm = buildWeekTimelineViewModel({
      weekStart: WEEK_START,
      userId: TECH,
      entries: [entry()],
    });
    expect(vm.days[0].overlaps).toEqual([]);
  });
});

// Local block-builder helper for the geometry tests below — saves
// repeating 14 fields per case.
function block(over: Partial<TimeBlock> = {}): TimeBlock {
  return {
    id: over.id ?? "x",
    date: over.date ?? "2026-05-04",
    start: over.start ?? new Date(2026, 4, 4, 9, 0, 0).toISOString(),
    end: over.end ?? new Date(2026, 4, 4, 10, 0, 0).toISOString(),
    durationMinutes: over.durationMinutes ?? 60,
    category: over.category ?? "onsite",
    rawType: over.rawType ?? "on_site",
    jobId: over.jobId ?? null,
    visitId: over.visitId ?? null,
    jobNumber: over.jobNumber ?? null,
    jobSummary: over.jobSummary ?? null,
    locationName: over.locationName ?? null,
    notes: over.notes ?? null,
    billable: over.billable ?? true,
  };
}

describe("computeStripRange — dynamic + clamp", () => {
  it("returns the 7AM–9PM default when no blocks (was 7–19; brief: 7–21)", () => {
    expect(computeStripRange([])).toEqual({ startHour: 7, endHour: 21 });
  });

  it("floors earliest start to the hour and ceils latest end", () => {
    const r = computeStripRange([
      block({
        start: new Date(2026, 4, 4, 8, 25, 0).toISOString(),
        end: new Date(2026, 4, 4, 14, 50, 0).toISOString(),
      }),
    ]);
    // floor(8:25) = 8; ceil(14:50) = 15
    expect(r.startHour).toBe(8);
    expect(r.endHour).toBe(15);
  });

  it("does NOT pad with the default range when a tight cluster of blocks fits in fewer hours", () => {
    // Was: previous version started/ended at the 7–19 default and only
    // EXTENDED outside it. New: range tracks the data exactly within
    // the clamp, so a tight 9AM–1PM shift gives a 9–13 strip, not 7–19.
    const r = computeStripRange([
      block({
        start: new Date(2026, 4, 4, 9, 0, 0).toISOString(),
        end: new Date(2026, 4, 4, 13, 0, 0).toISOString(),
      }),
    ]);
    expect(r.startHour).toBe(9);
    expect(r.endHour).toBe(13);
  });

  it("clamps the start at 5AM regardless of how early a block runs", () => {
    const r = computeStripRange([
      block({
        // 3AM start — would otherwise pull strip to startHour=3
        start: new Date(2026, 4, 4, 3, 0, 0).toISOString(),
        end: new Date(2026, 4, 4, 6, 0, 0).toISOString(),
      }),
    ]);
    expect(r.startHour).toBe(STRIP_CLAMP_START_HOUR);
    expect(r.startHour).toBe(5);
  });

  it("clamps the end at 10PM regardless of how late a block runs", () => {
    const r = computeStripRange([
      block({
        start: new Date(2026, 4, 4, 20, 0, 0).toISOString(),
        // 11:30PM end — would otherwise extend to endHour=24
        end: new Date(2026, 4, 4, 23, 30, 0).toISOString(),
      }),
    ]);
    expect(r.endHour).toBe(STRIP_CLAMP_END_HOUR);
    expect(r.endHour).toBe(22);
  });

  it("falls back to the default range when a degenerate input would produce endHour <= startHour", () => {
    // Hypothetical pathological input — defensive coverage.
    const r = computeStripRange([
      block({
        start: new Date(2026, 4, 4, 23, 0, 0).toISOString(),
        end: new Date(2026, 4, 4, 23, 5, 0).toISOString(),
      }),
    ]);
    // After clamp: startHour clamps to 5 (no — startHour from 23 is
    // 23 → clamps DOWN to 22? no, Math.max(5, 23) = 23 → clamps UP to
    // 22? — review: Math.max(STRIP_CLAMP_START_HOUR=5, earliest=23)
    // = 23. Math.min(STRIP_CLAMP_END_HOUR=22, latest=24) = 22.
    // So startHour=23, endHour=22 → degenerate → fallback.
    expect(r.startHour).toBe(7);
    expect(r.endHour).toBe(21);
  });
});

describe("computeWeekStripRange — shared range across all 7 days", () => {
  // Build a 7-day skeleton inline so the test exercises the real
  // adapter shape (same `DayTimeline[]` the component consumes).
  function emptyDays(): DayTimeline[] {
    return Array.from({ length: 7 }, (_, i) => ({
      date: `2026-05-0${4 + i}`.replace("0011", "11"),
      dayIndex: i as DayTimeline["dayIndex"],
      blocks: [],
      totalMinutes: 0,
      byCategory: { onsite: 0, drive: 0, general: 0 },
      earliestStart: null,
      latestEnd: null,
      overlaps: [],
    }));
  }

  it("returns the default (7–21) when no days carry blocks", () => {
    expect(computeWeekStripRange(emptyDays())).toEqual({ startHour: 7, endHour: 21 });
  });

  it("flattens every day's blocks into ONE shared range (every row aligns)", () => {
    // Mon: 7AM–11AM. Wed: 2PM–6PM. The shared range must cover both
    // — startHour=7, endHour=18 — so all 7 rows render aligned grid.
    const days = emptyDays();
    days[0].blocks.push(
      block({
        date: days[0].date,
        start: new Date(2026, 4, 4, 7, 0, 0).toISOString(),
        end: new Date(2026, 4, 4, 11, 0, 0).toISOString(),
      }),
    );
    days[2].blocks.push(
      block({
        date: days[2].date,
        start: new Date(2026, 4, 6, 14, 0, 0).toISOString(),
        end: new Date(2026, 4, 6, 18, 0, 0).toISOString(),
      }),
    );
    const r = computeWeekStripRange(days);
    expect(r).toEqual({ startHour: 7, endHour: 18 });
  });

  it("clamps the shared range so a single outlier outside [5, 22] doesn't blow up the whole week", () => {
    const days = emptyDays();
    days[0].blocks.push(
      block({
        date: days[0].date,
        start: new Date(2026, 4, 4, 4, 0, 0).toISOString(), // 4AM — pre-clamp
        end: new Date(2026, 4, 4, 23, 0, 0).toISOString(), // 11PM — post-clamp
      }),
    );
    const r = computeWeekStripRange(days);
    expect(r.startHour).toBe(5); // clamped
    expect(r.endHour).toBe(22); // clamped
  });
});

describe("computeBlockPercent — flexible-width strip math", () => {
  it("a 9–10AM block on a 7AM–7PM (12h) strip is at left=16.67% width=8.33%", () => {
    const r = computeBlockPercent(
      block({
        start: new Date(2026, 4, 4, 9, 0, 0).toISOString(),
        end: new Date(2026, 4, 4, 10, 0, 0).toISOString(),
      }),
      { startHour: 7, endHour: 19 },
    );
    // (9-7)*60 = 120 mins from start; total = 12*60 = 720 mins.
    //   leftPct = 120/720 * 100 = 16.667
    //   widthPct = 60/720 * 100 = 8.333
    expect(r.leftPct).toBeCloseTo(16.667, 2);
    expect(r.widthPct).toBeCloseTo(8.333, 2);
  });

  it("the FIRST block on a tight strip starts at left=0%", () => {
    const r = computeBlockPercent(
      block({
        start: new Date(2026, 4, 4, 9, 0, 0).toISOString(),
        end: new Date(2026, 4, 4, 10, 0, 0).toISOString(),
      }),
      { startHour: 9, endHour: 17 }, // strip starts at 9AM exactly
    );
    expect(r.leftPct).toBe(0);
    expect(r.widthPct).toBeCloseTo(12.5, 2); // 60 mins / (8h*60) * 100
  });

  it("a block that fully spans the strip is at left=0%, width=100%", () => {
    const r = computeBlockPercent(
      block({
        start: new Date(2026, 4, 4, 7, 0, 0).toISOString(),
        end: new Date(2026, 4, 4, 19, 0, 0).toISOString(),
        durationMinutes: 12 * 60,
      }),
      { startHour: 7, endHour: 19 },
    );
    expect(r.leftPct).toBe(0);
    expect(r.widthPct).toBeCloseTo(100, 2);
  });

  it("clamps left+width so a block extending past the strip end never overflows", () => {
    // Strip is 7-19 but the block runs 18:00 to 22:00 — width should
    // clamp so left + width ≤ 100.
    const r = computeBlockPercent(
      block({
        start: new Date(2026, 4, 4, 18, 0, 0).toISOString(),
        end: new Date(2026, 4, 4, 22, 0, 0).toISOString(),
      }),
      { startHour: 7, endHour: 19 },
    );
    expect(r.leftPct + r.widthPct).toBeLessThanOrEqual(100);
  });

  it("returns zeroes for a degenerate strip range (defensive)", () => {
    const r = computeBlockPercent(block(), { startHour: 9, endHour: 9 });
    expect(r).toEqual({ leftPct: 0, widthPct: 0 });
  });
});

describe("computeBlockGeometry — pixel variant (still exported)", () => {
  it("positions a 9-10AM block correctly with 7AM strip start, 60px/hr", () => {
    const block = {
      id: "x",
      date: "2026-05-04",
      start: new Date(2026, 4, 4, 9, 0, 0).toISOString(),
      end: new Date(2026, 4, 4, 10, 0, 0).toISOString(),
      durationMinutes: 60,
      category: "onsite" as const,
      rawType: "on_site",
      jobId: null,
      visitId: null,
      jobNumber: null,
      jobSummary: null,
      locationName: null,
      notes: null,
      billable: true,
    };
    const geo = computeBlockGeometry(block, {
      startHour: 7,
      endHour: 19,
      pxPerHour: 60,
    });
    expect(geo.left).toBe(120);
    expect(geo.width).toBe(60);
  });

  it("matches dispatch's 104px/hour when given that pxPerHour", () => {
    // Lock the dispatch-style sizing: 1 hour at 104px gives 104px width.
    const block = {
      id: "x",
      date: "2026-05-04",
      start: new Date(2026, 4, 4, 8, 0, 0).toISOString(),
      end: new Date(2026, 4, 4, 9, 0, 0).toISOString(),
      durationMinutes: 60,
      category: "onsite" as const,
      rawType: "on_site",
      jobId: null,
      visitId: null,
      jobNumber: null,
      jobSummary: null,
      locationName: null,
      notes: null,
      billable: true,
    };
    const geo = computeBlockGeometry(block, {
      startHour: 7,
      endHour: 21,
      pxPerHour: 104,
    });
    expect(geo.left).toBe(104); // (8 - 7) * 104
    expect(geo.width).toBe(104); // 1h * 104
  });

  it("enforces a 2px minimum width for tiny blocks", () => {
    const start = new Date(2026, 4, 4, 9, 0, 0);
    const end = new Date(2026, 4, 4, 9, 0, 30);
    const block = {
      id: "tiny",
      date: "2026-05-04",
      start: start.toISOString(),
      end: end.toISOString(),
      durationMinutes: 0,
      category: "onsite" as const,
      rawType: "on_site",
      jobId: null,
      visitId: null,
      jobNumber: null,
      jobSummary: null,
      locationName: null,
      notes: null,
      billable: true,
    };
    const geo = computeBlockGeometry(block, {
      startHour: 7,
      endHour: 19,
      pxPerHour: 60,
    });
    expect(geo.width).toBeGreaterThanOrEqual(2);
  });
});

describe("formatMinutes", () => {
  it.each([
    [0, "0h 0m"],
    [60, "1h 0m"],
    [90, "1h 30m"],
    [475, "7h 55m"],
  ])("formats %d minutes as %s", (m, label) => {
    expect(formatMinutes(m)).toBe(label);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Layer 1 — read-only contract (no mutations, no modals, no schema)
// ═══════════════════════════════════════════════════════════════════════════

function readFile(rel: string): string {
  return readFileSync(join(__dirname, "..", rel), "utf-8");
}

const adapterSrc = readFile(
  "client/src/components/timesheets/timeline/timeBlockAdapter.ts",
);
const timelineSrc = readFile(
  "client/src/components/timesheets/timeline/WeekTimeline.tsx",
);
const payrollSrc = readFile("client/src/pages/PayrollPage.tsx");
const appSrc = readFile("client/src/App.tsx");

describe("Iteration 1 — read-only contract", () => {
  it("WeekTimeline component does NOT issue any mutation calls", () => {
    expect(timelineSrc).not.toMatch(/useMutation\b/);
    expect(timelineSrc).not.toMatch(/apiRequest\(/);
    expect(timelineSrc).not.toMatch(
      /method:\s*["'](?:POST|PATCH|PUT|DELETE)["']/,
    );
  });

  it("WeekTimeline component does NOT mount any modal / dialog", () => {
    expect(timelineSrc).not.toMatch(/<Dialog\b/);
    expect(timelineSrc).not.toMatch(/<AlertDialog\b/);
    expect(timelineSrc).not.toMatch(/<Sheet\b/);
    expect(timelineSrc).not.toMatch(/<Popover\b/);
  });

  it("PayrollPage's week mode uses the existing /api/admin/timesheets/week endpoint (no new endpoint)", () => {
    expect(payrollSrc).toMatch(/\/api\/admin\/timesheets\/week\?/);
    expect(payrollSrc).not.toMatch(/\/api\/time-blocks\b/);
  });

  it("adapter exports the canonical `TimeBlock` UI shape + view-model builder", () => {
    expect(adapterSrc).toMatch(/export\s+interface\s+TimeBlock\b/);
    expect(adapterSrc).toMatch(/export\s+function\s+buildWeekTimelineViewModel\b/);
  });

  it("adapter reuses the canonical categoryMap (no duplicate bucketing)", () => {
    expect(adapterSrc).toMatch(/from\s+["']\.\.\/categoryMap["']/);
    expect(adapterSrc).not.toMatch(
      /if\s*\(\s*\w+\s*===\s*['"]travel_to_job['"]/,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Layer 2 — dispatch-style architecture guards
// ═══════════════════════════════════════════════════════════════════════════

describe("Architecture — dispatch-style integration into PayrollPage", () => {
  it("PayrollPage imports WeekTimeline + adapter (week-mode mounted in-page)", () => {
    expect(payrollSrc).toMatch(
      /import\s*\{\s*WeekTimeline\s*\}\s*from\s*["']@\/components\/timesheets\/timeline\/WeekTimeline["']/,
    );
    expect(payrollSrc).toMatch(
      /import\s*\{[\s\S]*buildWeekTimelineViewModel[\s\S]*\}\s*from\s*["']@\/components\/timesheets\/timeline\/timeBlockAdapter["']/,
    );
  });

  it("PayrollPage mounts <WeekTimeline> with the canonical onDayClick / onBlockClick deep-links", () => {
    expect(payrollSrc).toMatch(/<WeekTimeline[\s\S]+?onDayClick=/);
    expect(payrollSrc).toMatch(
      /setLocation\(\s*[`'"]\/timesheets\?view=day&tech=/,
    );
  });

  it("PayrollPage week-mode renders ONLY the Unbillable pill (v6: dropped On-site + Drive)", () => {
    // v6 contract: cards in Week View are grouped by job/visit, so
    // splitting drive vs on-site at the header is no longer the
    // primary signal. Only "Unbillable" survives, and only when its
    // total is > 0 (don't render an empty zero-pill).
    expect(payrollSrc).toMatch(/data-testid="week-category-strip"/);
    // The strip must be guarded on `byCategory.general > 0` — no
    // unconditional render.
    expect(payrollSrc).toMatch(
      /weekTimelineVm\.weekTotals\.byCategory\.general\s*>\s*0/,
    );
    // Only the `general` pill is constructed inside the strip — no
    // `["onsite", "drive", "general"]` map any more.
    expect(payrollSrc).not.toMatch(/\["onsite",\s*"drive",\s*"general"\]/);
    // The lone surviving category constant — `general` — appears in
    // the strip's IIFE.
    expect(payrollSrc).toMatch(
      /data-testid="week-category-strip"[\s\S]+?const cat:\s*EntryCategory\s*=\s*"general"/,
    );
    // The literal "Unbillable" label survives.
    expect(payrollSrc).toMatch(
      /data-testid="week-category-strip"[\s\S]+?>Unbillable</,
    );
    // No "On-site" or "Drive" labels inside the strip block.
    expect(payrollSrc).not.toMatch(
      /data-testid="week-category-strip"[\s\S]+?>On-site</,
    );
    expect(payrollSrc).not.toMatch(
      /data-testid="week-category-strip"[\s\S]+?>Drive</,
    );
  });

  it("standalone /timesheets/timeline route was REMOVED from App.tsx", () => {
    expect(appSrc).not.toMatch(/\/timesheets\/timeline/);
    expect(appSrc).not.toMatch(/TimesheetWeekTimeline/);
  });

  it("standalone TimesheetWeekTimeline.tsx page file was DELETED", () => {
    const standalonePath = join(
      __dirname,
      "..",
      "client/src/pages/timesheets/TimesheetWeekTimeline.tsx",
    );
    expect(existsSync(standalonePath)).toBe(false);
  });

  it("WeekTimeline does NOT render its own card-inside-card header (Card / CardContent imports gone)", () => {
    // The brief explicitly: "Avoid card-inside-card styling". The new
    // WeekTimeline is a single flat surface — the wrapping <Card> lives
    // in PayrollPage, NOT inside this component. That means no shadcn
    // <Card>/<CardContent>/<CardHeader>/<CardTitle> import or usage.
    expect(timelineSrc).not.toMatch(
      /from\s+["']@\/components\/ui\/card["']/,
    );
    expect(timelineSrc).not.toMatch(/<Card\b/);
    expect(timelineSrc).not.toMatch(/<CardContent\b/);
    expect(timelineSrc).not.toMatch(/<CardHeader\b/);
  });

  it("WeekTimeline declares an explicit ROW_HEIGHT_PX constant (dispatch-style)", () => {
    // v5: bumped from 64 → 76 to fit the new 3-line card. The exact
    // value is pinned by the dedicated v5 row-height test below; this
    // test only guards the "constant exists" architectural shape.
    expect(timelineSrc).toMatch(/ROW_HEIGHT_PX\s*=\s*\d+/);
  });

  it("WeekTimeline NO LONGER uses a fixed-pixel hour column (now flex-1)", () => {
    // v3: dropped HOUR_WIDTH_PX = 104 in favour of flex-1 hour cells.
    // The strip stretches to fill available width — no horizontal
    // scroll on the new layout.
    expect(timelineSrc).not.toMatch(/HOUR_WIDTH_PX\s*=\s*104/);
    // flex-1 columns split the strip width equally.
    expect(timelineSrc).toMatch(/flex-1/);
  });

  it("WeekTimeline uses dashed gridlines + alternating cell fill (matches DispatchLaneRow)", () => {
    expect(timelineSrc).toMatch(/border-dashed/);
    expect(timelineSrc).toMatch(/idx\s*%\s*2\s*===\s*0/);
  });

  it("WeekTimeline blocks show ONLY duration on line 2 (no 'Drive · 45m' composite)", () => {
    // v3: brief — "Each block should show: Line 1: job/location short
    // name. Line 2: total duration only. Keep category only as color."
    // The composite `${CATEGORY_LABEL[...]} · ${duration}` from v2 must
    // be gone from the visible-label code paths.
    expect(timelineSrc).not.toMatch(
      /\$\{CATEGORY_LABEL\[block\.category\]\}\s*·/,
    );
    // The duration string still renders (line 2). The CATEGORY_LABEL
    // map can survive only inside the tooltip composition.
    expect(timelineSrc).toMatch(/durationStr/);
  });

  it("WeekTimeline blocks position with PERCENT (no fixed-pixel left/width)", () => {
    // v3: percent-based geometry so the strip flexes with viewport.
    expect(timelineSrc).toMatch(/computeBlockPercent\b/);
    expect(timelineSrc).toMatch(/leftPct/);
    expect(timelineSrc).toMatch(/widthPct/);
    expect(timelineSrc).not.toMatch(/computeBlockGeometry\b/);
  });

  it("WeekTimeline enforces a minimum block width via CSS min-width", () => {
    // v5: minimum bumped from 40 → 56 to fit the new 3-line content.
    // Percent-based widths can resolve to sub-clickable values on
    // narrow viewports; CSS min-width is the floor.
    expect(timelineSrc).toMatch(/BLOCK_MIN_WIDTH_PX\s*=\s*56/);
    expect(timelineSrc).toMatch(/minWidth:\s*`\$\{BLOCK_MIN_WIDTH_PX\}px`/);
  });

  it("WeekTimeline reads its range from computeWeekStripRange (dynamic, clamped)", () => {
    // v3: replaced the per-day `computeStripRange` call with
    // computeWeekStripRange so all 7 rows align to the same shared
    // window — and that window is clamped at the adapter level.
    expect(timelineSrc).toMatch(/computeWeekStripRange\b/);
    // No more inline DEFAULT_START_HOUR = 7 / DEFAULT_END_HOUR = 21
    // constants — the adapter owns those defaults now.
    expect(timelineSrc).not.toMatch(/DEFAULT_START_HOUR/);
    expect(timelineSrc).not.toMatch(/DEFAULT_END_HOUR/);
  });

  // ── v4: grouped cards + DAY/TOTAL column split ──

  it("WeekTimeline renders grouped cards (TimeBlockGroup) — never raw TimeBlocks", () => {
    // v4 contract: visible cards come from `day.groups`, not `day.blocks`.
    // The adapter combines drive + on-site for the same job/visit into
    // ONE card; rendering raw blocks would re-break that.
    expect(timelineSrc).toMatch(/day\.groups\.map/);
    expect(timelineSrc).not.toMatch(/day\.blocks\.map/);
    // Component imports the group type, not the raw-block shape.
    expect(timelineSrc).toMatch(
      /import\s*\{[\s\S]+TimeBlockGroup[\s\S]+\}\s*from\s*["']\.\/timeBlockAdapter["']/,
    );
  });

  it("WeekTimeline ships separate DAY and TOTAL fixed columns", () => {
    // Brief: "Change the week timeline grid to have separate columns:
    // DAY, TOTAL, timeline strip. Do not put total inside the day cell."
    expect(timelineSrc).toMatch(/DAY_COL_WIDTH_PX\s*=\s*\d+/);
    expect(timelineSrc).toMatch(/TOTAL_COL_WIDTH_PX\s*=\s*\d+/);
    // Header spacer width = sum of both, so hour-cell boundaries align.
    expect(timelineSrc).toMatch(
      /LEFT_COLS_WIDTH_PX\s*=\s*DAY_COL_WIDTH_PX\s*\+\s*TOTAL_COL_WIDTH_PX/,
    );
    // Both columns emit their own data-testid for visual / e2e targeting.
    // The source uses a template literal: `data-testid={\`day-label-${...}\`}`.
    expect(timelineSrc).toMatch(/data-testid=\{`day-label-/);
    expect(timelineSrc).toMatch(/data-testid=\{`day-total-/);
  });

  it("DAY column renders day-of-week + date (separate lines, no total)", () => {
    // The brief shows: "Mon" then "May 4" then warning chip — duration
    // lives in the TOTAL column.
    expect(timelineSrc).toMatch(/DAY_NAME_FORMAT/);
    expect(timelineSrc).toMatch(/DAY_DATE_FORMAT/);
  });

  it("Group chip exposes data-mixed + data-member-count on the rendered card", () => {
    // E2E hooks for verifying that drive+on-site collapsed into one
    // card with member-count > 1 and data-mixed="true".
    expect(timelineSrc).toMatch(/data-mixed=/);
    expect(timelineSrc).toMatch(/data-member-count=/);
  });

  it("Group tooltip composes a per-category breakdown for mixed groups", () => {
    // Mixed groups: tooltip must show "Drive 45m + On-site 29m" instead
    // of a single category label — recoverability for the data the
    // visible card collapses.
    expect(timelineSrc).toMatch(/isMixedCategory/);
    expect(timelineSrc).toMatch(/memberCategoryMinutes/);
  });

  // ── v5: readability refinements ──

  it("TOTAL column is widened (≥96px) and uses whitespace-nowrap so values like '1h 14m' don't wrap", () => {
    // Brief: "Increase TOTAL column width enough to display values like
    // '1h 14m' on one line". 96px is the minimum that fits the longest
    // realistic week-day total ("12h 45m") in the chosen text-base font.
    expect(timelineSrc).toMatch(/TOTAL_COL_WIDTH_PX\s*=\s*96/);
    // Inside the total cell, the label span must declare nowrap so a
    // future viewport / font-scale change can't sneak a wrap back in.
    expect(timelineSrc).toMatch(
      /day-total[\s\S]+?whitespace-nowrap/,
    );
    // Bigger / bolder text — text-base is one Tailwind step up from
    // text-sm; bold weight stays.
    expect(timelineSrc).toMatch(
      /day-total[\s\S]+?text-base[\s\S]+?font-bold/,
    );
  });

  it("'Under 8h' warning branch is REMOVED (noisy on legitimate partial days)", () => {
    // The warning surface should now only carry data-integrity
    // (overlap) and operational signals (over 10h). 'Under 8h' was
    // tripping on PTO / weekends / half-days and added no value.
    // We pin the STRUCTURAL removal (no `warning === "short"` branch,
    // no `text-amber-600 if "short"` style), not the literal string —
    // an explanatory comment may still mention "Under 8h".
    expect(timelineSrc).not.toMatch(/warning\s*===\s*"short"/);
    expect(timelineSrc).not.toMatch(/return\s+"short"/);
    // Long + Overlap survive.
    expect(timelineSrc).toMatch(/"Over 10h"/);
    expect(timelineSrc).toMatch(/"Overlap"/);
    expect(timelineSrc).toMatch(/warning\s*===\s*"long"/);
    expect(timelineSrc).toMatch(/warning\s*===\s*"overlap"/);
  });

  it("Group card has 3-line content layout (location / jobNum + summary / duration)", () => {
    // Brief: "Line 1: client name or location name. Line 2: job number
    // + job summary. Line 3 or right-aligned: total duration." Each
    // line carries a `data-line` attribute for e2e + visual hooks.
    expect(timelineSrc).toMatch(/data-line="primary"/);
    expect(timelineSrc).toMatch(/data-line="job"/);
    expect(timelineSrc).toMatch(/data-line="duration"/);
    // Helper that composes "#NNNN — summary".
    expect(timelineSrc).toMatch(/function\s+jobLabelLine\b/);
  });

  it("Group card duration sits in its OWN column (right-aligned, never sharing truncate budget)", () => {
    // The duration span is shrink-0 + tabular-nums + whitespace-nowrap
    // so it stays fully visible regardless of how cramped lines 1/2
    // become.
    expect(timelineSrc).toMatch(
      /data-line="duration"/,
    );
    expect(timelineSrc).toMatch(
      /shrink-0[\s\S]+?tabular-nums[\s\S]+?whitespace-nowrap[\s\S]+?data-line="duration"/,
    );
  });

  it("Row height sized so 2-line content fits without clipping (v9 = 76px)", () => {
    // v9: line 1 is now `text-base` (was `text-sm` in v8), so the
    // row gained 4px to keep the same comfortable headroom inside
    // `py-2` padding.
    expect(timelineSrc).toMatch(/ROW_HEIGHT_PX\s*=\s*76/);
  });

  // ── v6: neutral cards, content anchored left, no category icon ──

  it("Group card NO LONGER imports category icons (Briefcase / Car / MoreHorizontal)", () => {
    // v6: cards represent grouped job/visit segments — drive/on-site
    // is no longer the primary signal. The category icons that
    // accompanied the primary line in v3-v5 are gone; only
    // AlertTriangle survives for the warning chip on the day cell.
    expect(timelineSrc).not.toMatch(/\bBriefcase\b/);
    expect(timelineSrc).not.toMatch(/\bCar\b/);
    expect(timelineSrc).not.toMatch(/\bMoreHorizontal\b/);
    expect(timelineSrc).not.toMatch(/\bCATEGORY_ICON\b/);
  });

  // ── v7: pastel-tinted cards, 2-line layout, General label ──

  it("Group card uses pastel-tinted styling for jobful groups, neutral gray for jobless", () => {
    // v7: hash-based pastel palette → same job (or visitId) keeps the
    // same color all week. Jobless groups (general / unbillable
    // filler) → neutral gray.
    //
    // v10 reshape: PASTEL_PALETTE entries are now `{ outer, inner }`
    // pairs (PalettePair type). The outer tints the full block span
    // subtly; the inner styles the visible content card. Both share
    // a hue per entry. The dispatcher renamed `cardClassFor` →
    // `paletteFor` (returns the pair) and `NEUTRAL_CARD_CLASS` →
    // `NEUTRAL_PALETTE` (a PalettePair).
    expect(timelineSrc).toMatch(/\bPASTEL_PALETTE\b/);
    expect(timelineSrc).toMatch(/\bpaletteIndexFor\b/);
    expect(timelineSrc).toMatch(/\bpaletteFor\b/);
    expect(timelineSrc).toMatch(/\binterface\s+PalettePair\b/);
    // Per-category bar colors are still gone — pastel tint is keyed
    // on jobId/visitId, NOT drive/on-site category.
    expect(timelineSrc).not.toMatch(/\bCATEGORY_BAR_CLASS\b/);
    // Neutral palette reserved for jobless groups.
    expect(timelineSrc).toMatch(
      /NEUTRAL_PALETTE\s*:\s*PalettePair/,
    );
    // The dispatch route in paletteFor: `if (!group.jobId) return
    // NEUTRAL_PALETTE;`
    expect(timelineSrc).toMatch(
      /if\s*\(\s*!group\.jobId\s*\)\s*return\s+NEUTRAL_PALETTE/,
    );
  });

  it("Pastel palette index is stable per jobId (deterministic hash, source-level guard)", () => {
    // The hash function is module-local (not exported), so we can't
    // call it from the test. Pin determinism via source contract:
    //   • djb2-style: seeded at 5381, fed char codes via charCodeAt.
    //   • Returned mod-bounded to PASTEL_PALETTE.length.
    expect(timelineSrc).toMatch(/h\s*=\s*5381/);
    expect(timelineSrc).toMatch(/charCodeAt/);
    expect(timelineSrc).toMatch(
      /Math\.abs\(h\)\s*%\s*PASTEL_PALETTE\.length/,
    );
    // No randomness inside the function body itself (a comment may
    // mention `Math.random` to explain why we avoided it; pin the
    // function shape only).
    expect(timelineSrc).toMatch(
      /function\s+paletteIndexFor\([\s\S]+?return\s+Math\.abs\(h\)\s*%\s*PASTEL_PALETTE\.length/,
    );
  });

  it("Group chip uses 2-tier 'label + bar' structure (outer span + inner card)", () => {
    // v10: the visual model splits into two layers.
    //   • Outer button = full-block-span time bar (subtle hue tint).
    //   • Inner div = the visible "card" with white-ish bg, left
    //     accent stripe, shadow, content. Anchored LEFT, capped at
    //     ~300px wide.
    //
    // The inner div carries `data-card-role="inner"` so e2e tests
    // can target it specifically.
    expect(timelineSrc).toMatch(/data-card-role="inner"/);
    // The inner card carries the content cluster including the
    // primary/job/duration spans.
    expect(timelineSrc).toMatch(
      /data-card-role="inner"[\s\S]+?data-line="primary"/,
    );
    // Inner card has the visible border + left accent stripe (used
    // to live on the outer card in v9; moved to inner in v10).
    expect(timelineSrc).toMatch(
      /data-card-role="inner"[\s\S]{0,500}border border-l-4/,
    );
    // flex-1 left column inside the inner card.
    expect(timelineSrc).toMatch(/flex flex-1 min-w-0 flex-col/);
    // Duration on the right is shrink-0 + self-center + nowrap.
    expect(timelineSrc).toMatch(
      /shrink-0 self-center font-mono[\s\S]+?tabular-nums[\s\S]+?whitespace-nowrap[\s\S]+?data-line="duration"/,
    );
    // Source order: primary → job → duration.
    expect(timelineSrc).toMatch(
      /data-line="primary"[\s\S]+?data-line="job"[\s\S]+?data-line="duration"/,
    );
  });

  it("Group card typography: text-base font-semibold (line 1) + text-base font-bold (duration) + text-xs (line 2)", () => {
    // v9: bumped line 1 + duration from text-sm → text-base for
    // legibility. Job line stays text-xs (a deliberately quieter
    // tier so the eye lands on the location/duration first).
    expect(timelineSrc).toMatch(
      /text-base font-semibold[\s\S]+?data-line="primary"/,
    );
    expect(timelineSrc).toMatch(
      /text-base font-bold[\s\S]+?tabular-nums[\s\S]+?data-line="duration"/,
    );
    expect(timelineSrc).toMatch(/text-xs[\s\S]+?data-line="job"/);
  });

  it("Jobless groups render label 'General' (semantic rule from the brief)", () => {
    // The brief: "Any time where a user is clocked in but not assigned
    // to a job, linked to a visit, driving/en-route — must be treated
    // as General. Render it as a General block. Label it 'General'."
    expect(timelineSrc).toMatch(
      /if\s*\(\s*!group\.jobId\s*\)\s*return\s+"General"/,
    );
  });

  it("Jobless + non-billable groups show 'Unbillable' on line 2", () => {
    // Brief example: "General / Unbillable" for general non-billable
    // filler. The jobLabelLine helper must return "Unbillable" for
    // that case.
    expect(timelineSrc).toMatch(
      /if\s*\(\s*!group\.jobId\s*\)\s*\{[\s\S]+?return\s+group\.billable\s*\?\s*null\s*:\s*"Unbillable"/,
    );
  });

  // ── v8: full-span card, padding floor, no clipping ──

  it("Group card padding meets the brief minimum (px-3 py-2)", () => {
    // Brief: "Minimum card padding: px-3 py-2." Pin the exact tokens
    // on the card body so a future tweak can't sneak below the floor.
    expect(timelineSrc).toMatch(/px-3 py-2/);
    // Old v7 padding shorthand `px-2.5 py-1.5` is gone.
    expect(timelineSrc).not.toMatch(/px-2\.5 py-1\.5/);
  });

  it("Group card body has NO `overflow-hidden` (text clips per-line via truncate, not whole-card)", () => {
    // v7 had `overflow-hidden` on the outer button which clipped the
    // job line whenever vertical space ran out. v8 removes it: each
    // text span has its own `truncate` so clipping happens cleanly at
    // the END of each line, leaving line 2 fully visible.
    //
    // The `truncate` utility itself implies `overflow-hidden` on the
    // span — that's expected. We pin "no overflow-hidden on the
    // outer card" by checking the className string between the
    // button-open and the `cardClassFor` call.
    expect(timelineSrc).not.toMatch(
      /flex items-center gap-3[\s\S]{0,200}overflow-hidden/,
    );
  });

  it("Duration span never overlaps the job line (right-column shrink-0 + flex-1 left)", () => {
    // The structural guarantee: left column is `flex-1 min-w-0` so
    // it shrinks to whatever the duration leaves. Duration is
    // `shrink-0` so it never compresses. min-w-0 on the left lets
    // the truncate utility actually engage (without it, flex
    // children default to `min-width: auto` and won't shrink below
    // their intrinsic content width).
    expect(timelineSrc).toMatch(/flex flex-1 min-w-0 flex-col/);
    expect(timelineSrc).toMatch(
      /shrink-0[\s\S]+?data-line="duration"/,
    );
  });

  // ── v9: contrast bump, content cluster, hover state ──

  it("Inner card has border + left accent stripe; outer span has neither", () => {
    // v10: visible card surface = inner div. It carries the border,
    // the left accent stripe, the shadow, and the rounded corners.
    // The outer span is only a tinted bar — no border, no shadow.
    //
    // Inner card class string contains `border border-l-4` (one-pixel
    // border + 4px left accent) AND `shadow-sm`.
    expect(timelineSrc).toMatch(
      /data-card-role="inner"[\s\S]{0,500}border border-l-4[\s\S]{0,200}shadow-sm/,
    );
    // The v9 outer-card pattern `border-2 border-l-4` is gone — the
    // outer span no longer has a border at all.
    expect(timelineSrc).not.toMatch(/\bborder-2 border-l-4\b/);
  });

  it("Pastel palette is split into {outer, inner} pairs (v10)", () => {
    // v10: each palette entry is a PalettePair `{ outer, inner }`.
    //   • outer = subtle full-block-span hue tint (e.g. `bg-amber-50/50`)
    //   • inner = white-ish card with full-saturation accent stripe
    //     (e.g. `bg-white border-amber-300 border-l-amber-500
    //      hover:bg-amber-50`)
    expect(timelineSrc).toMatch(/outer:\s*"bg-amber-50\/50"/);
    expect(timelineSrc).toMatch(
      /inner:\s*"bg-white border-amber-300 border-l-amber-500 hover:bg-amber-50"/,
    );
    // Multiple hue families exist.
    expect(timelineSrc).toMatch(/outer:\s*"bg-emerald-50\/50"/);
    expect(timelineSrc).toMatch(/outer:\s*"bg-sky-50\/50"/);
    expect(timelineSrc).toMatch(/outer:\s*"bg-violet-50\/50"/);
    // Neutral pair for jobless groups follows the same shape.
    expect(timelineSrc).toMatch(/outer:\s*"bg-slate-100\/40"/);
    expect(timelineSrc).toMatch(
      /inner:\s*"bg-white border-slate-300 border-l-slate-500 hover:bg-slate-50"/,
    );
  });

  it("Every palette entry carries a subtle hover bg shift on the inner card", () => {
    // v10: hover state lives on the inner card (not the full block).
    // The shift is one tier of saturation up from the resting white
    // — `hover:bg-{color}-50` against a `bg-white` resting fill.
    expect(timelineSrc).toMatch(/hover:bg-amber-50/);
    expect(timelineSrc).toMatch(/hover:bg-emerald-50/);
    expect(timelineSrc).toMatch(/hover:bg-sky-50/);
    expect(timelineSrc).toMatch(/hover:bg-violet-50/);
    // Neutral inner card too.
    expect(timelineSrc).toMatch(/hover:bg-slate-50/);
    // Shadow lift on hover via the group-hover utility (the outer
    // span owns the hover origin so the inner card doesn't have to
    // be hovered directly).
    expect(timelineSrc).toMatch(/group-hover\/wt-block:shadow-md/);
  });

  it("Inner card cluster is constrained at ~300px wide, anchored left", () => {
    // v10 brief: "Inner card max width ~300px. Anchor it LEFT inside
    // the span so the duration sits close to the label, not far
    // right across a wide visit's bar."
    expect(timelineSrc).toMatch(/max-w-\[300px\]/);
    // The v9 cluster width (340px) is gone.
    expect(timelineSrc).not.toMatch(/className="[^"]*max-w-\[340px\]/);
  });

  it("Inner card uses transition-all so bg + shadow animate together on hover", () => {
    // v10: brief — "slight elevation or shadow increase, slight
    // background shift" — both should animate. The transition lives
    // on the INNER card now.
    expect(timelineSrc).toMatch(/transition-all/);
    // No `transition-shadow` inside a Tailwind class string. (An
    // explanatory comment may still mention older utilities.)
    expect(timelineSrc).not.toMatch(/className="[^"]*transition-shadow/);
    expect(timelineSrc).not.toMatch(/"transition-shadow [^"]+",/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Layer 3 — DayView untouched (regression guard)
// ═══════════════════════════════════════════════════════════════════════════

describe("Iteration 1 — DayView preserved as canonical edit surface", () => {
  // Loose guards — the brief is "DayView preserved exactly". Don't pin
  // DayView's internal leaf-component composition (the in-progress
  // DayView refactor swaps those over time). Pin only the contract
  // that matters for the timeline iteration: DayView still exists,
  // PayrollPage still imports it, and `viewMode === "day"` still
  // mounts it.

  it("DayView.tsx still exists and is loadable from the canonical path", () => {
    const dayViewPath = join(
      __dirname,
      "..",
      "client/src/components/timesheets/DayView.tsx",
    );
    expect(existsSync(dayViewPath)).toBe(true);
    const dayViewSrc = readFile("client/src/components/timesheets/DayView.tsx");
    // Component is still exported.
    expect(dayViewSrc).toMatch(/export\s+(?:default\s+)?function\s+DayView\b|export\s*\{\s*DayView\s*\}/);
  });

  it("PayrollPage.tsx still imports DayView (no accidental swap)", () => {
    expect(payrollSrc).toMatch(
      /import\s*\{\s*DayView[^}]*\}\s*from\s*["']@\/components\/timesheets\/DayView["']/,
    );
  });

  it("PayrollPage's view=day branch still mounts <DayView> (canonical edit surface)", () => {
    expect(payrollSrc).toMatch(/viewMode\s*===\s*["']day["']/);
    expect(payrollSrc).toMatch(/<DayView\b/);
  });
});
