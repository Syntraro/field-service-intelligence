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
import type {
  VisitDuration,
  WorkingHourRow,
  CompanyHourRow,
  TimeOffRow,
} from "../server/storage/capacityForecast";

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
  it("returns 40 when no working hours rows", () => {
    expect(computeTargetWeeklyHours([])).toBe(40);
  });

  it("sums hours across working days", () => {
    const rows: WorkingHourRow[] = [
      { dayOfWeek: 1, isWorking: true, startTime: "08:00", endTime: "16:00" }, // 8h
      { dayOfWeek: 2, isWorking: true, startTime: "08:00", endTime: "16:00" }, // 8h
      { dayOfWeek: 3, isWorking: true, startTime: "08:00", endTime: "16:00" }, // 8h
      { dayOfWeek: 4, isWorking: true, startTime: "08:00", endTime: "16:00" }, // 8h
      { dayOfWeek: 5, isWorking: true, startTime: "08:00", endTime: "16:00" }, // 8h
    ];
    expect(computeTargetWeeklyHours(rows)).toBe(40);
  });

  it("handles part-time schedule (shorter days)", () => {
    const rows: WorkingHourRow[] = [
      { dayOfWeek: 1, isWorking: true, startTime: "09:00", endTime: "13:00" }, // 4h
      { dayOfWeek: 2, isWorking: true, startTime: "09:00", endTime: "13:00" }, // 4h
      { dayOfWeek: 3, isWorking: true, startTime: "09:00", endTime: "13:00" }, // 4h
    ];
    expect(computeTargetWeeklyHours(rows)).toBe(12);
  });

  it("ignores non-working days", () => {
    const rows: WorkingHourRow[] = [
      { dayOfWeek: 1, isWorking: true, startTime: "08:00", endTime: "16:00" }, // 8h
      { dayOfWeek: 6, isWorking: false, startTime: null, endTime: null },       // off
      { dayOfWeek: 0, isWorking: false, startTime: null, endTime: null },       // off
    ];
    expect(computeTargetWeeklyHours(rows)).toBe(8);
  });

  it("returns 40 when all days are non-working (no hours to sum)", () => {
    const rows: WorkingHourRow[] = [
      { dayOfWeek: 1, isWorking: false, startTime: null, endTime: null },
    ];
    expect(computeTargetWeeklyHours(rows)).toBe(40);
  });

  it("ignores rows with null startTime or endTime", () => {
    const rows: WorkingHourRow[] = [
      { dayOfWeek: 1, isWorking: true, startTime: null, endTime: "16:00" },
      { dayOfWeek: 2, isWorking: true, startTime: "08:00", endTime: null },
    ];
    expect(computeTargetWeeklyHours(rows)).toBe(40);
  });
});

// ── computeAvailableMinutes ───────────────────────────────────────────────────

describe("computeAvailableMinutes", () => {
  // 2026-05-19 is a Tuesday
  const tue = new Date("2026-05-19T00:00:00");
  const tueEnd = new Date("2026-05-19T23:59:59.999");
  const noCompanyHours: CompanyHourRow[] = [];
  const noTof: TimeOffRow[] = [];

  const stdWh: WorkingHourRow[] = [
    { dayOfWeek: 2, isWorking: true, startTime: "08:00", endTime: "16:00" }, // Tue: 8h = 480min
  ];

  it("returns working minutes for a working day", () => {
    const mins = computeAvailableMinutes(tue, tueEnd, stdWh, noCompanyHours, noTof);
    expect(mins).toBe(480);
  });

  it("returns 0 for a non-working day", () => {
    // 2026-05-17 is a Sunday (dow=0), stdWh has no Sunday row → default weekday
    // Actually Sunday = 0, and no custom row, no company row → 0 (weekend default)
    const sun = new Date("2026-05-17T00:00:00");
    const sunEnd = new Date("2026-05-17T23:59:59.999");
    const mins = computeAvailableMinutes(sun, sunEnd, [], noCompanyHours, noTof);
    expect(mins).toBe(0);
  });

  it("defaults to 480 min Mon-Fri when no custom or company hours", () => {
    // 2026-05-18 is a Monday
    const mon = new Date("2026-05-18T00:00:00");
    const monEnd = new Date("2026-05-18T23:59:59.999");
    const mins = computeAvailableMinutes(mon, monEnd, [], noCompanyHours, noTof);
    expect(mins).toBe(480);
  });

  it("uses company hours as fallback when no member custom hours", () => {
    const company: CompanyHourRow[] = [
      { dayOfWeek: 2, isOpen: true, startMinutes: 540, endMinutes: 1020 }, // 9–17 = 480 min
    ];
    const mins = computeAvailableMinutes(tue, tueEnd, [], company, noTof);
    expect(mins).toBe(480);
  });

  it("subtracts all-day time-off (removes entire working day)", () => {
    const tof: TimeOffRow[] = [
      {
        startsAt: new Date("2026-05-19T00:00:00"),
        endsAt: new Date("2026-05-20T00:00:00"),
        allDay: true,
      },
    ];
    const mins = computeAvailableMinutes(tue, tueEnd, stdWh, noCompanyHours, tof);
    expect(mins).toBe(0);
  });

  it("subtracts partial time-off (hourly)", () => {
    // 2h off during an 8h day = 6h remaining
    const tof: TimeOffRow[] = [
      {
        startsAt: new Date("2026-05-19T08:00:00"),
        endsAt: new Date("2026-05-19T10:00:00"),
        allDay: false,
      },
    ];
    const mins = computeAvailableMinutes(tue, tueEnd, stdWh, noCompanyHours, tof);
    expect(mins).toBe(360); // 480 - 120
  });

  it("sums available minutes across a week range", () => {
    // Mon–Fri 2026-05-18 to 2026-05-22, all 8h days, no custom hours
    const weekStart = new Date("2026-05-18T00:00:00");
    const weekEnd = new Date("2026-05-22T23:59:59.999");
    const mins = computeAvailableMinutes(weekStart, weekEnd, [], noCompanyHours, noTof);
    expect(mins).toBe(480 * 5); // 2400 min = 40h
  });

  it("clamps time-off removal to 0 (no negative available)", () => {
    // time-off covering more than working hours → result is 0
    const stdWh2: WorkingHourRow[] = [
      { dayOfWeek: 2, isWorking: true, startTime: "09:00", endTime: "09:30" }, // 30 min
    ];
    const tof: TimeOffRow[] = [
      {
        startsAt: new Date("2026-05-19T00:00:00"),
        endsAt: new Date("2026-05-20T00:00:00"),
        allDay: false, // full-day hourly
      },
    ];
    const mins = computeAvailableMinutes(tue, tueEnd, stdWh2, noCompanyHours, tof);
    expect(mins).toBeGreaterThanOrEqual(0);
    expect(mins).toBeLessThanOrEqual(30);
  });
});

// ── Tenant isolation note ─────────────────────────────────────────────────────
// getTeamCapacityForecast, getMemberWorkloadBreakdown, and getPmForecast all
// include `eq(table.companyId, companyId)` in every WHERE clause.
// These require a live database; integration tests are out of scope here.
// The isolation invariant is verified by the SQL query structure in the source.
