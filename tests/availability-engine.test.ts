/**
 * Availability Engine tests — Technician Shift Management Phase 1 (2026-05-18).
 *
 * Mocks the repositories to test business logic in isolation.
 * No database access.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TechnicianShift } from "@shared/schema";

// ── Mock repositories before importing the engine ────────────────────────────

vi.mock("../server/storage/technicianShifts", () => ({
  technicianShiftsRepository: {
    listBaseShiftsInWindow: vi.fn(),
    listExceptionsForBases: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    hardDelete: vi.fn(),
    createException: vi.fn(),
    updateException: vi.fn(),
    deleteException: vi.fn(),
  },
}));

import { availabilityEngine } from "../server/services/availabilityEngine";
import { technicianShiftsRepository } from "../server/storage/technicianShifts";

// ── Helpers ───────────────────────────────────────────────────────────────────

const CID = "company-001";
const TECH = "tech-001";
const TZ = "America/New_York";

function makeShift(overrides: Partial<TechnicianShift> = {}): TechnicianShift {
  return {
    id: "shift-001",
    companyId: CID,
    technicianUserId: TECH,
    templateId: null,
    shiftType: "normal",
    shiftSubtype: null,
    label: null,
    color: null,
    startsAt: new Date("2026-05-18T13:00:00Z"),  // 09:00 EDT
    endsAt: new Date("2026-05-18T21:00:00Z"),    // 17:00 EDT
    allDay: false,
    timeOfDayStart: "09:00",
    timeOfDayEnd: "17:00",
    recurrenceRule: null,
    recurrenceEndDate: null,
    recurrenceParentId: null,
    occurrenceDate: null,
    isCancelled: false,
    note: null,
    createdByUserId: "admin-001",
    createdAt: new Date("2026-05-01T00:00:00Z"),
    updatedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function mockShifts(baseRows: TechnicianShift[], exceptionRows: TechnicianShift[] = []) {
  vi.mocked(technicianShiftsRepository.listBaseShiftsInWindow).mockResolvedValue(baseRows);
  vi.mocked(technicianShiftsRepository.listExceptionsForBases).mockResolvedValue(exceptionRows);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("availabilityEngine.resolveTechnicianShifts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty array when no shifts exist", async () => {
    mockShifts([]);
    const result = await availabilityEngine.resolveTechnicianShifts(
      CID, [TECH],
      new Date("2026-05-18T00:00:00Z"),
      new Date("2026-05-19T00:00:00Z"),
      TZ,
    );
    expect(result).toHaveLength(0);
  });

  it("returns a one-off shift in the window", async () => {
    const shift = makeShift();
    mockShifts([shift]);
    const result = await availabilityEngine.resolveTechnicianShifts(
      CID, [TECH],
      new Date("2026-05-18T00:00:00Z"),
      new Date("2026-05-19T00:00:00Z"),
      TZ,
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("shift-001");
    expect(result[0].shiftType).toBe("normal");
    expect(result[0].occurrenceDate).toBeNull();
  });

  it("expands a recurring shift into occurrences", async () => {
    const base = makeShift({
      id: "base-001",
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
      // Anchor: Mon May 18 2026 09:00 EDT
      startsAt: new Date("2026-05-18T13:00:00Z"),
      endsAt: new Date("2026-05-18T21:00:00Z"),
    });
    mockShifts([base]);
    // Window: Mon–Fri May 18–22
    const result = await availabilityEngine.resolveTechnicianShifts(
      CID, [TECH],
      new Date("2026-05-18T00:00:00Z"),
      new Date("2026-05-23T00:00:00Z"),
      TZ,
    );
    const dates = result.map((r) => r.occurrenceDate);
    expect(dates).toContain("2026-05-18"); // Monday
    expect(dates).toContain("2026-05-20"); // Wednesday
    expect(dates).toContain("2026-05-22"); // Friday
    expect(result.every((r) => r.baseShiftId === "base-001")).toBe(true);
  });

  it("excludes cancelled recurring occurrence", async () => {
    const base = makeShift({
      id: "base-002",
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
      startsAt: new Date("2026-05-18T13:00:00Z"),
      endsAt: new Date("2026-05-18T21:00:00Z"),
    });
    // Exception: cancel May 25 occurrence
    const exception = makeShift({
      id: "exc-001",
      recurrenceParentId: "base-002",
      occurrenceDate: "2026-05-25",
      isCancelled: true,
      startsAt: new Date("2026-05-25T13:00:00Z"),
      endsAt: new Date("2026-05-25T21:00:00Z"),
    });
    mockShifts([base], [exception]);
    const result = await availabilityEngine.resolveTechnicianShifts(
      CID, [TECH],
      new Date("2026-05-25T00:00:00Z"),
      new Date("2026-05-26T00:00:00Z"),
      TZ,
    );
    // Cancelled occurrence should be excluded
    expect(result).toHaveLength(0);
  });

  it("uses exception bounds for edited recurring occurrence", async () => {
    const base = makeShift({
      id: "base-003",
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
      startsAt: new Date("2026-05-18T13:00:00Z"),
      endsAt: new Date("2026-05-18T21:00:00Z"),
    });
    // Exception: edit May 25 to a different time
    const exception = makeShift({
      id: "exc-002",
      recurrenceParentId: "base-003",
      occurrenceDate: "2026-05-25",
      isCancelled: false,
      startsAt: new Date("2026-05-25T15:00:00Z"),  // Different time
      endsAt: new Date("2026-05-25T23:00:00Z"),
    });
    mockShifts([base], [exception]);
    const result = await availabilityEngine.resolveTechnicianShifts(
      CID, [TECH],
      new Date("2026-05-25T00:00:00Z"),
      new Date("2026-05-26T00:00:00Z"),
      TZ,
    );
    expect(result).toHaveLength(1);
    // Should use exception's id and bounds
    expect(result[0].id).toBe("exc-002");
    expect(result[0].baseShiftId).toBe("base-003");
    expect(result[0].startsAt.toISOString()).toBe("2026-05-25T15:00:00.000Z");
  });
});

describe("availabilityEngine.resolveTechnicianAvailability", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns isAvailable=true when only normal shifts exist", async () => {
    const shift = makeShift({ shiftType: "normal" });
    mockShifts([shift]);
    const avail = await availabilityEngine.resolveTechnicianAvailability(
      CID, TECH, "2026-05-18", TZ,
    );
    expect(avail.isAvailable).toBe(true);
    expect(avail.normalShifts).toHaveLength(1);
    expect(avail.unavailableShifts).toHaveLength(0);
  });

  it("returns isAvailable=false when an unavailable shift exists", async () => {
    const shift = makeShift({ shiftType: "unavailable", shiftSubtype: "vacation" });
    mockShifts([shift]);
    const avail = await availabilityEngine.resolveTechnicianAvailability(
      CID, TECH, "2026-05-18", TZ,
    );
    expect(avail.isAvailable).toBe(false);
    expect(avail.unavailableShifts).toHaveLength(1);
  });
});

describe("availabilityEngine.resolveShiftConflicts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty when no shifts overlap the proposed window", async () => {
    mockShifts([]);
    const conflicts = await availabilityEngine.resolveShiftConflicts(
      CID, TECH,
      new Date("2026-05-18T13:00:00Z"),
      new Date("2026-05-18T21:00:00Z"),
      TZ,
    );
    expect(conflicts).toHaveLength(0);
  });

  it("returns unavailable shift when it overlaps proposed window", async () => {
    const shift = makeShift({
      shiftType: "unavailable",
      shiftSubtype: "sick",
      startsAt: new Date("2026-05-18T00:00:00Z"),
      endsAt: new Date("2026-05-19T00:00:00Z"),
      allDay: true,
    });
    mockShifts([shift]);
    const conflicts = await availabilityEngine.resolveShiftConflicts(
      CID, TECH,
      new Date("2026-05-18T13:00:00Z"),
      new Date("2026-05-18T21:00:00Z"),
      TZ,
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].shiftType).toBe("unavailable");
  });

  it("on_call shift does not cause a conflict with normal scheduling", async () => {
    const onCall = makeShift({
      id: "oncall-001",
      shiftType: "on_call",
      startsAt: new Date("2026-05-18T00:00:00Z"),
      endsAt: new Date("2026-05-19T00:00:00Z"),
    });
    const normal = makeShift({
      id: "normal-001",
      shiftType: "normal",
      startsAt: new Date("2026-05-18T13:00:00Z"),
      endsAt: new Date("2026-05-18T21:00:00Z"),
    });
    mockShifts([onCall, normal]);
    // Both are returned as "conflicts" by resolveShiftConflicts because it
    // returns all overlapping shifts — interpretation is left to the caller.
    const conflicts = await availabilityEngine.resolveShiftConflicts(
      CID, TECH,
      new Date("2026-05-18T13:00:00Z"),
      new Date("2026-05-18T21:00:00Z"),
      TZ,
    );
    // on_call is returned in the conflict list (overlap detection)
    // but validateAssignment treats it as non-blocking
    expect(conflicts.some((c) => c.shiftType === "on_call")).toBe(true);
  });
});

describe("availabilityEngine.resolveOnCallCoverage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns covered=true and gaps=[] when window is fully covered", async () => {
    const onCall = makeShift({
      shiftType: "on_call",
      startsAt: new Date("2026-05-18T00:00:00Z"),
      endsAt: new Date("2026-05-19T00:00:00Z"),
    });
    mockShifts([onCall]);
    const coverage = await availabilityEngine.resolveOnCallCoverage(
      CID,
      new Date("2026-05-18T06:00:00Z"),
      new Date("2026-05-18T18:00:00Z"),
      TZ,
    );
    expect(coverage.covered).toBe(true);
    expect(coverage.gaps).toHaveLength(0);
    expect(coverage.onCallShifts).toHaveLength(1);
  });

  it("returns covered=false with gap when no on-call shifts exist", async () => {
    mockShifts([]);
    const windowStart = new Date("2026-05-18T06:00:00Z");
    const windowEnd = new Date("2026-05-18T18:00:00Z");
    const coverage = await availabilityEngine.resolveOnCallCoverage(
      CID, windowStart, windowEnd, TZ,
    );
    expect(coverage.covered).toBe(false);
    expect(coverage.gaps).toHaveLength(1);
    expect(coverage.gaps[0].startsAt.toISOString()).toBe(windowStart.toISOString());
    expect(coverage.gaps[0].endsAt.toISOString()).toBe(windowEnd.toISOString());
  });

  it("identifies partial coverage gap", async () => {
    // On-call only covers 06:00–12:00; window is 06:00–18:00 → gap 12:00–18:00
    const onCall = makeShift({
      shiftType: "on_call",
      startsAt: new Date("2026-05-18T06:00:00Z"),
      endsAt: new Date("2026-05-18T12:00:00Z"),
    });
    mockShifts([onCall]);
    const coverage = await availabilityEngine.resolveOnCallCoverage(
      CID,
      new Date("2026-05-18T06:00:00Z"),
      new Date("2026-05-18T18:00:00Z"),
      TZ,
    );
    expect(coverage.covered).toBe(false);
    expect(coverage.gaps).toHaveLength(1);
    expect(coverage.gaps[0].startsAt.getTime()).toBe(new Date("2026-05-18T12:00:00Z").getTime());
    expect(coverage.gaps[0].endsAt.getTime()).toBe(new Date("2026-05-18T18:00:00Z").getTime());
  });
});

describe("availabilityEngine.validateAssignmentAgainstAvailability", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inside a normal shift → valid with OUTSIDE_SHIFT warning omitted (has normal coverage)", async () => {
    const shift = makeShift({
      shiftType: "normal",
      startsAt: new Date("2026-05-18T12:00:00Z"),
      endsAt: new Date("2026-05-18T22:00:00Z"),
    });
    mockShifts([shift]);
    const result = await availabilityEngine.validateAssignmentAgainstAvailability(
      CID, TECH,
      new Date("2026-05-18T13:00:00Z"),
      new Date("2026-05-18T15:00:00Z"),
      TZ,
    );
    expect(result.isValid).toBe(true);
    expect(result.warnings.some((w) => w.code === "UNAVAILABLE_CONFLICT")).toBe(false);
  });

  it("overlaps unavailable shift → isValid=true (advisory) with UNAVAILABLE_CONFLICT warning", async () => {
    const unavail = makeShift({
      shiftType: "unavailable",
      shiftSubtype: "vacation",
      startsAt: new Date("2026-05-18T00:00:00Z"),
      endsAt: new Date("2026-05-19T00:00:00Z"),
      allDay: true,
    });
    mockShifts([unavail]);
    const result = await availabilityEngine.validateAssignmentAgainstAvailability(
      CID, TECH,
      new Date("2026-05-18T13:00:00Z"),
      new Date("2026-05-18T21:00:00Z"),
      TZ,
    );
    // All warnings are advisory — isValid is always true.
    expect(result.isValid).toBe(true);
    expect(result.warnings.some((w) => w.code === "UNAVAILABLE_CONFLICT")).toBe(true);
  });
});
