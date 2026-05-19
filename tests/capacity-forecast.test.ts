/**
 * Unit tests for pure computation helpers in server/storage/capacityForecast.ts.
 *
 * All tests operate on in-memory data; no database access.
 * Tenant isolation (companyId scoping) is enforced by the SQL WHERE clauses in
 * the async exported functions — those require DB integration tests and are
 * noted as skipped below.
 */

import { describe, it, expect } from "vitest";
import {
  categorizeEntry,
  visitMinutes,
  accumulateVisitMinutes,
  computeAvailableMinutes,
  computeTargetWeeklyHours,
} from "../server/storage/capacityForecast";
import type { VisitDuration } from "../server/storage/capacityForecast";
import type { ResolvedShift } from "../server/services/availabilityEngine";

function mkShift(
  userId: string,
  type: "normal" | "on_call" | "unavailable",
  start: Date,
  end: Date,
): ResolvedShift {
  return {
    id: "test-id",
    baseShiftId: "test-base-id",
    technicianUserId: userId,
    templateId: null,
    shiftType: type,
    startsAt: start,
    endsAt: end,
    allDay: false,
    isOvernight: false,
    occurrenceDate: null,
  };
}

// ── categorizeEntry ───────────────────────────────────────────────────────────

describe("categorizeEntry", () => {
  it("classifies travel_to_job as drive regardless of billable flag", () => {
    expect(categorizeEntry("travel_to_job", false)).toBe("drive");
    expect(categorizeEntry("travel_to_job", true)).toBe("drive");
  });

  it("classifies travel_between_jobs as drive", () => {
    expect(categorizeEntry("travel_between_jobs", false)).toBe("drive");
  });

  it("classifies on_site as billable when billable=true", () => {
    expect(categorizeEntry("on_site", true)).toBe("billable");
  });

  it("classifies on_site as general when billable=false", () => {
    expect(categorizeEntry("on_site", false)).toBe("general");
  });

  it("classifies task_work as billable when billable=true", () => {
    expect(categorizeEntry("task_work", true)).toBe("billable");
  });

  it("classifies task_work as general when billable=false", () => {
    expect(categorizeEntry("task_work", false)).toBe("general");
  });

  it("classifies admin as general regardless of billable flag", () => {
    expect(categorizeEntry("admin", true)).toBe("general");
    expect(categorizeEntry("admin", false)).toBe("general");
  });

  it("classifies unknown type as general", () => {
    expect(categorizeEntry("break", false)).toBe("general");
    expect(categorizeEntry("other", true)).toBe("general");
  });
});

// ── visitMinutes ──────────────────────────────────────────────────────────────

describe("visitMinutes", () => {
  const base: VisitDuration = {
    scheduledStart: null,
    scheduledEnd: null,
    estimatedDurationMinutes: null,
    isAllDay: false,
    assignedTechnicianIds: null,
  };

  it("all-day visit uses estimatedDurationMinutes", () => {
    const v: VisitDuration = { ...base, isAllDay: true, estimatedDurationMinutes: 120 };
    expect(visitMinutes(v)).toBe(120);
  });

  it("all-day visit with null estimatedDurationMinutes returns 0", () => {
    const v: VisitDuration = { ...base, isAllDay: true, estimatedDurationMinutes: null };
    expect(visitMinutes(v)).toBe(0);
  });

  it("uses scheduledEnd - scheduledStart when both present", () => {
    const start = new Date("2026-05-17T08:00:00Z");
    const end = new Date("2026-05-17T10:30:00Z");
    const v: VisitDuration = { ...base, scheduledStart: start, scheduledEnd: end };
    expect(visitMinutes(v)).toBe(150);
  });

  it("falls back to estimatedDurationMinutes when scheduledEnd is missing", () => {
    const start = new Date("2026-05-17T09:00:00Z");
    const v: VisitDuration = { ...base, scheduledStart: start, estimatedDurationMinutes: 90 };
    expect(visitMinutes(v)).toBe(90);
  });

  it("falls back to 60 when scheduledEnd is missing and no estimatedDurationMinutes", () => {
    const start = new Date("2026-05-17T09:00:00Z");
    const v: VisitDuration = { ...base, scheduledStart: start };
    expect(visitMinutes(v)).toBe(60);
  });

  it("returns 0 when no scheduledStart", () => {
    const v: VisitDuration = { ...base, estimatedDurationMinutes: 60 };
    expect(visitMinutes(v)).toBe(0);
  });

  it("returns 0 for negative time range (end before start)", () => {
    const start = new Date("2026-05-17T10:00:00Z");
    const end = new Date("2026-05-17T09:00:00Z");
    const v: VisitDuration = { ...base, scheduledStart: start, scheduledEnd: end };
    expect(visitMinutes(v)).toBe(0);
  });
});

// ── accumulateVisitMinutes ────────────────────────────────────────────────────

describe("accumulateVisitMinutes", () => {
  const start = new Date("2026-05-17T08:00:00Z");
  const end = new Date("2026-05-17T10:00:00Z"); // 120 min

  it("credits each assigned tech the full visit duration independently", () => {
    const visit: VisitDuration = {
      scheduledStart: start,
      scheduledEnd: end,
      estimatedDurationMinutes: null,
      isAllDay: false,
      assignedTechnicianIds: ["alice", "bob"],
    };
    const result = accumulateVisitMinutes([visit], ["alice", "bob"]);
    expect(result.get("alice")).toBe(120);
    expect(result.get("bob")).toBe(120);
  });

  it("ignores techs not in the memberIds set", () => {
    const visit: VisitDuration = {
      scheduledStart: start,
      scheduledEnd: end,
      estimatedDurationMinutes: null,
      isAllDay: false,
      assignedTechnicianIds: ["carol"],
    };
    const result = accumulateVisitMinutes([visit], ["alice"]);
    expect(result.get("carol")).toBeUndefined();
    expect(result.size).toBe(0);
  });

  it("sums multiple visits for the same tech", () => {
    const v1: VisitDuration = {
      scheduledStart: start,
      scheduledEnd: end,
      estimatedDurationMinutes: null,
      isAllDay: false,
      assignedTechnicianIds: ["alice"],
    };
    const v2: VisitDuration = {
      scheduledStart: new Date("2026-05-17T13:00:00Z"),
      scheduledEnd: new Date("2026-05-17T14:30:00Z"), // 90 min
      estimatedDurationMinutes: null,
      isAllDay: false,
      assignedTechnicianIds: ["alice"],
    };
    const result = accumulateVisitMinutes([v1, v2], ["alice"]);
    expect(result.get("alice")).toBe(210);
  });

  it("returns empty map for visits with null assignedTechnicianIds", () => {
    const visit: VisitDuration = {
      scheduledStart: start,
      scheduledEnd: end,
      estimatedDurationMinutes: null,
      isAllDay: false,
      assignedTechnicianIds: null,
    };
    const result = accumulateVisitMinutes([visit], ["alice"]);
    expect(result.size).toBe(0);
  });

  it("skips visits with zero duration", () => {
    const visit: VisitDuration = {
      scheduledStart: null,
      scheduledEnd: null,
      estimatedDurationMinutes: null,
      isAllDay: false,
      assignedTechnicianIds: ["alice"],
    };
    const result = accumulateVisitMinutes([visit], ["alice"]);
    expect(result.get("alice")).toBeUndefined();
  });
});

// ── computeTargetWeeklyHours ──────────────────────────────────────────────────

describe("computeTargetWeeklyHours", () => {
  it("returns 0 when no shifts", () => {
    expect(computeTargetWeeklyHours([])).toBe(0);
  });

  it("sums hours across normal shifts Mon–Fri (8h each = 40h)", () => {
    const shifts = [
      mkShift("u1", "normal", new Date("2026-05-18T08:00:00Z"), new Date("2026-05-18T16:00:00Z")),
      mkShift("u1", "normal", new Date("2026-05-19T08:00:00Z"), new Date("2026-05-19T16:00:00Z")),
      mkShift("u1", "normal", new Date("2026-05-20T08:00:00Z"), new Date("2026-05-20T16:00:00Z")),
      mkShift("u1", "normal", new Date("2026-05-21T08:00:00Z"), new Date("2026-05-21T16:00:00Z")),
      mkShift("u1", "normal", new Date("2026-05-22T08:00:00Z"), new Date("2026-05-22T16:00:00Z")),
    ];
    expect(computeTargetWeeklyHours(shifts)).toBe(40);
  });

  it("handles part-time (3×4h = 12h)", () => {
    const shifts = [
      mkShift("u1", "normal", new Date("2026-05-18T09:00:00Z"), new Date("2026-05-18T13:00:00Z")),
      mkShift("u1", "normal", new Date("2026-05-19T09:00:00Z"), new Date("2026-05-19T13:00:00Z")),
      mkShift("u1", "normal", new Date("2026-05-20T09:00:00Z"), new Date("2026-05-20T13:00:00Z")),
    ];
    expect(computeTargetWeeklyHours(shifts)).toBe(12);
  });

  it("ignores on_call and unavailable shifts", () => {
    const shifts = [
      mkShift("u1", "normal", new Date("2026-05-18T08:00:00Z"), new Date("2026-05-18T16:00:00Z")),
      mkShift("u1", "on_call", new Date("2026-05-18T16:00:00Z"), new Date("2026-05-19T08:00:00Z")),
      mkShift("u1", "unavailable", new Date("2026-05-19T00:00:00Z"), new Date("2026-05-20T00:00:00Z")),
    ];
    expect(computeTargetWeeklyHours(shifts)).toBe(8);
  });

  it("returns 0 when all shifts are unavailable (no normal shifts)", () => {
    const shifts = [
      mkShift("u1", "unavailable", new Date("2026-05-18T00:00:00Z"), new Date("2026-05-19T00:00:00Z")),
    ];
    expect(computeTargetWeeklyHours(shifts)).toBe(0);
  });
});

// ── computeAvailableMinutes ───────────────────────────────────────────────────

describe("computeAvailableMinutes", () => {
  const tueMon = new Date("2026-05-19T08:00:00Z");  // shift start
  const tueEod = new Date("2026-05-19T16:00:00Z");  // shift end (8h = 480 min)
  const rangeStart = new Date("2026-05-19T00:00:00Z");
  const rangeEnd   = new Date("2026-05-19T23:59:59.999Z");

  it("returns shift duration for a normal shift fitting within the range", () => {
    const shifts = [mkShift("u1", "normal", tueMon, tueEod)];
    expect(computeAvailableMinutes(rangeStart, rangeEnd, shifts)).toBe(480);
  });

  it("returns 0 when no shifts", () => {
    expect(computeAvailableMinutes(rangeStart, rangeEnd, [])).toBe(0);
  });

  it("returns 0 when shift is entirely outside the range", () => {
    const shifts = [
      mkShift("u1", "normal", new Date("2026-05-20T08:00:00Z"), new Date("2026-05-20T16:00:00Z")),
    ];
    expect(computeAvailableMinutes(rangeStart, rangeEnd, shifts)).toBe(0);
  });

  it("clips a shift that extends past the range end", () => {
    // Shift 08:00–20:00, range ends at 16:00 → 8h = 480 min
    const shifts = [
      mkShift("u1", "normal", tueMon, new Date("2026-05-19T20:00:00Z")),
    ];
    const mins = computeAvailableMinutes(rangeStart, new Date("2026-05-19T16:00:00Z"), shifts);
    expect(mins).toBe(480);
  });

  it("subtracts time-off (unavailable shift) overlap", () => {
    // Normal 08:00–16:00, unavailable 10:00–12:00 → 360 min remaining
    const shifts = [
      mkShift("u1", "normal", tueMon, tueEod),
      mkShift("u1", "unavailable", new Date("2026-05-19T10:00:00Z"), new Date("2026-05-19T12:00:00Z")),
    ];
    expect(computeAvailableMinutes(rangeStart, rangeEnd, shifts)).toBe(360);
  });

  it("subtracts full-day unavailable shift", () => {
    // Full-day unavailable covers the entire normal shift
    const shifts = [
      mkShift("u1", "normal", tueMon, tueEod),
      mkShift("u1", "unavailable", new Date("2026-05-19T00:00:00Z"), new Date("2026-05-20T00:00:00Z")),
    ];
    expect(computeAvailableMinutes(rangeStart, rangeEnd, shifts)).toBe(0);
  });

  it("clamps result to 0 (no negative available minutes)", () => {
    // unavailable spans more than the normal shift → result ≥ 0
    const shifts = [
      mkShift("u1", "normal", new Date("2026-05-19T09:00:00Z"), new Date("2026-05-19T09:30:00Z")),
      mkShift("u1", "unavailable", new Date("2026-05-19T00:00:00Z"), new Date("2026-05-20T00:00:00Z")),
    ];
    const mins = computeAvailableMinutes(rangeStart, rangeEnd, shifts);
    expect(mins).toBeGreaterThanOrEqual(0);
  });

  it("sums multiple normal shifts", () => {
    // Two 4h shifts in one day = 480 min
    const shifts = [
      mkShift("u1", "normal", new Date("2026-05-19T08:00:00Z"), new Date("2026-05-19T12:00:00Z")),
      mkShift("u1", "normal", new Date("2026-05-19T13:00:00Z"), new Date("2026-05-19T17:00:00Z")),
    ];
    expect(computeAvailableMinutes(rangeStart, rangeEnd, shifts)).toBe(480);
  });
});

// ── Tenant isolation note ─────────────────────────────────────────────────────
// getTeamCapacityForecast, getMemberWorkloadBreakdown, and getPmForecast all
// include `eq(table.companyId, companyId)` in every WHERE clause.
// These require a live database; integration tests are out of scope here.
// The isolation invariant is verified by the SQL query structure in the source.
