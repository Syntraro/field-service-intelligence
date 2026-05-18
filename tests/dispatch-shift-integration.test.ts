/**
 * Dispatch shift integration tests — Phase 2 Technician Shift Management.
 *
 * Pure unit tests for shiftUtils.ts functions + source-pin guards for
 * dispatch integration contracts. No React mounts, no HTTP calls.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const p = (rel: string) => resolve(ROOT, rel);
const read = (rel: string) => readFileSync(p(rel), "utf-8");

// ── Import shiftUtils directly for functional tests ──────────────────────────

import {
  partitionShifts,
  buildShiftsByTech,
  findOverlappingShifts,
  hasNormalShiftCovering,
  isTechShiftedOnDate,
} from "../client/src/components/dispatch/shiftUtils";
import type { DispatchShiftEntry } from "../client/src/components/dispatch/dispatchPreviewTypes";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeShift(overrides: Partial<DispatchShiftEntry> & { id: string; technicianUserId: string; shiftType: DispatchShiftEntry["shiftType"] }): DispatchShiftEntry {
  return {
    baseShiftId: overrides.baseShiftId ?? overrides.id,
    startsAt: "2026-05-19T08:00:00Z",
    endsAt: "2026-05-19T16:00:00Z",
    allDay: false,
    isOvernight: false,
    occurrenceDate: null,
    ...overrides,
  };
}

// ── partitionShifts ──────────────────────────────────────────────────────────

describe("partitionShifts", () => {
  it("separates normal / on_call / unavailable into typed buckets", () => {
    const shifts: DispatchShiftEntry[] = [
      makeShift({ id: "s1", technicianUserId: "t1", shiftType: "normal" }),
      makeShift({ id: "s2", technicianUserId: "t1", shiftType: "on_call" }),
      makeShift({ id: "s3", technicianUserId: "t2", shiftType: "unavailable" }),
      makeShift({ id: "s4", technicianUserId: "t2", shiftType: "normal" }),
    ];

    const { normal, onCall, unavailable } = partitionShifts(shifts);

    expect(normal.map(s => s.id)).toEqual(["s1", "s4"]);
    expect(onCall.map(s => s.id)).toEqual(["s2"]);
    expect(unavailable.map(s => s.id)).toEqual(["s3"]);
  });

  it("returns empty arrays for empty input", () => {
    const result = partitionShifts([]);
    expect(result.normal).toHaveLength(0);
    expect(result.onCall).toHaveLength(0);
    expect(result.unavailable).toHaveLength(0);
  });

  it("on-call shifts are partitioned correctly into onCall bucket only", () => {
    const onCallShift = makeShift({ id: "oc1", technicianUserId: "t1", shiftType: "on_call" });
    const { normal, onCall, unavailable } = partitionShifts([onCallShift]);
    expect(onCall).toHaveLength(1);
    expect(normal).toHaveLength(0);
    expect(unavailable).toHaveLength(0);
    expect(onCall[0].id).toBe("oc1");
  });
});

// ── buildShiftsByTech ────────────────────────────────────────────────────────

describe("buildShiftsByTech", () => {
  it("groups shifts by technicianUserId", () => {
    const shifts = [
      makeShift({ id: "s1", technicianUserId: "t1", shiftType: "normal" }),
      makeShift({ id: "s2", technicianUserId: "t1", shiftType: "normal" }),
      makeShift({ id: "s3", technicianUserId: "t2", shiftType: "normal" }),
    ];
    const m = buildShiftsByTech(shifts);
    expect(m.get("t1")).toHaveLength(2);
    expect(m.get("t2")).toHaveLength(1);
    expect(m.has("t3")).toBe(false);
  });

  it("returns empty Map for empty input", () => {
    expect(buildShiftsByTech([]).size).toBe(0);
  });
});

// ── findOverlappingShifts ────────────────────────────────────────────────────

describe("findOverlappingShifts", () => {
  const unavailShifts: DispatchShiftEntry[] = [
    makeShift({
      id: "u1",
      technicianUserId: "t1",
      shiftType: "unavailable",
      startsAt: "2026-05-19T10:00:00Z",
      endsAt: "2026-05-19T14:00:00Z",
    }),
    makeShift({
      id: "u2",
      technicianUserId: "t2",
      shiftType: "unavailable",
      startsAt: "2026-05-19T12:00:00Z",
      endsAt: "2026-05-19T15:00:00Z",
    }),
  ];

  it("detects overlap when job straddles the block start", () => {
    const m = buildShiftsByTech(unavailShifts);
    const hits = findOverlappingShifts(m, ["t1"], "2026-05-19T09:00:00Z", "2026-05-19T11:00:00Z");
    expect(hits.map(s => s.id)).toContain("u1");
  });

  it("detects overlap when job is contained within block", () => {
    const m = buildShiftsByTech(unavailShifts);
    const hits = findOverlappingShifts(m, ["t1"], "2026-05-19T11:00:00Z", "2026-05-19T13:00:00Z");
    expect(hits.map(s => s.id)).toContain("u1");
  });

  it("returns empty when job does not overlap the block (before)", () => {
    const m = buildShiftsByTech(unavailShifts);
    const hits = findOverlappingShifts(m, ["t1"], "2026-05-19T07:00:00Z", "2026-05-19T10:00:00Z");
    expect(hits).toHaveLength(0);
  });

  it("returns empty when job does not overlap the block (after)", () => {
    const m = buildShiftsByTech(unavailShifts);
    const hits = findOverlappingShifts(m, ["t1"], "2026-05-19T14:00:00Z", "2026-05-19T16:00:00Z");
    expect(hits).toHaveLength(0);
  });

  it("returns empty for unknown tech", () => {
    const m = buildShiftsByTech(unavailShifts);
    const hits = findOverlappingShifts(m, ["t-unknown"], "2026-05-19T10:00:00Z", "2026-05-19T14:00:00Z");
    expect(hits).toHaveLength(0);
  });

  it("returns empty for empty techIds list", () => {
    const m = buildShiftsByTech(unavailShifts);
    expect(findOverlappingShifts(m, [], "2026-05-19T10:00:00Z", "2026-05-19T14:00:00Z")).toHaveLength(0);
  });

  it("returns empty for invalid date strings", () => {
    const m = buildShiftsByTech(unavailShifts);
    expect(findOverlappingShifts(m, ["t1"], "not-a-date", "also-not")).toHaveLength(0);
  });

  it("can match multiple techs in one call", () => {
    const m = buildShiftsByTech(unavailShifts);
    const hits = findOverlappingShifts(m, ["t1", "t2"], "2026-05-19T11:00:00Z", "2026-05-19T13:00:00Z");
    expect(hits.map(s => s.id)).toContain("u1");
    expect(hits.map(s => s.id)).toContain("u2");
  });
});

// ── hasNormalShiftCovering ───────────────────────────────────────────────────

describe("hasNormalShiftCovering", () => {
  const normalShifts = [
    makeShift({
      id: "n1",
      technicianUserId: "t1",
      shiftType: "normal",
      startsAt: "2026-05-19T08:00:00Z",
      endsAt: "2026-05-19T16:00:00Z",
    }),
  ];

  it("returns true when shift covers the visit window", () => {
    const m = buildShiftsByTech(normalShifts);
    expect(hasNormalShiftCovering(m, "t1", "2026-05-19T09:00:00Z", "2026-05-19T10:00:00Z")).toBe(true);
  });

  it("returns false when tech has no shifts", () => {
    const m = buildShiftsByTech(normalShifts);
    expect(hasNormalShiftCovering(m, "t-other", "2026-05-19T09:00:00Z", "2026-05-19T10:00:00Z")).toBe(false);
  });

  it("returns false when visit falls outside shift hours", () => {
    const m = buildShiftsByTech(normalShifts);
    expect(hasNormalShiftCovering(m, "t1", "2026-05-19T17:00:00Z", "2026-05-19T18:00:00Z")).toBe(false);
  });
});

// ── isTechShiftedOnDate ──────────────────────────────────────────────────────

describe("isTechShiftedOnDate", () => {
  it("returns true for recurring shift with matching occurrenceDate", () => {
    const shift = makeShift({
      id: "r1",
      technicianUserId: "t1",
      shiftType: "normal",
      occurrenceDate: "2026-05-19",
    });
    const m = buildShiftsByTech([shift]);
    expect(isTechShiftedOnDate(m, "t1", "2026-05-19")).toBe(true);
  });

  it("returns false for recurring shift with different occurrenceDate", () => {
    const shift = makeShift({
      id: "r1",
      technicianUserId: "t1",
      shiftType: "normal",
      occurrenceDate: "2026-05-20",
    });
    const m = buildShiftsByTech([shift]);
    expect(isTechShiftedOnDate(m, "t1", "2026-05-19")).toBe(false);
  });

  it("returns true for one-off shift by UTC startsAt date", () => {
    const shift = makeShift({
      id: "o1",
      technicianUserId: "t1",
      shiftType: "normal",
      startsAt: "2026-05-19T08:00:00Z",
      occurrenceDate: null,
    });
    const m = buildShiftsByTech([shift]);
    expect(isTechShiftedOnDate(m, "t1", "2026-05-19")).toBe(true);
  });

  it("returns false when tech has no shifts", () => {
    const m = buildShiftsByTech([]);
    expect(isTechShiftedOnDate(m, "t1", "2026-05-19")).toBe(false);
  });
});

// ── Source-pin: dispatch loads defensively when feature disabled ──────────────

describe("dispatchDataCore shift query gating", () => {
  it("shift query has enabled: enabled && shiftFeatureEnabled === true guard", () => {
    const src = read("client/src/components/dispatch/dispatchDataCore.ts");
    expect(src).toContain("enabled: enabled && shiftFeatureEnabled === true");
  });

  it("shift query failure returns empty arrays via ?? []", () => {
    const src = read("client/src/components/dispatch/dispatchDataCore.ts");
    // The normalization uses shiftsQuery.data?.shifts ?? []
    expect(src).toContain("shiftsQuery.data?.shifts ?? []");
  });

  it("DispatchRangeData includes shifts / onCallShifts / unavailableShifts", () => {
    const src = read("client/src/components/dispatch/dispatchDataCore.ts");
    expect(src).toContain("shifts: DispatchShiftEntry[]");
    expect(src).toContain("onCallShifts: DispatchShiftEntry[]");
    expect(src).toContain("unavailableShifts: DispatchShiftEntry[]");
  });

  it("shift loading does NOT block the overall isLoading flag", () => {
    const src = read("client/src/components/dispatch/dispatchDataCore.ts");
    // The isLoading expression must include the core queries but NOT shiftsQuery.
    // The comment above the return explains the intentional exclusion.
    expect(src).toContain("scheduledQuery.isLoading");
    expect(src).toContain("unscheduledQuery.isLoading");
    // shiftsQuery.isLoading must NOT appear in the isLoading expression
    expect(src).not.toMatch(/isLoading:[^;]*shiftsQuery\.isLoading/s);
  });
});

// ── Source-pin: warnings are advisory only ───────────────────────────────────

describe("advisory-only shift warnings", () => {
  it("availabilityEngine always returns isValid: true", () => {
    const src = read("server/services/availabilityEngine.ts");
    // There must be no "isValid = false" assignment in the file
    expect(src).not.toContain("isValid = false");
  });

  it("unavailable shift conflicts use blocking confirm dialog (not advisory toast)", () => {
    const src = read("client/src/pages/DispatchPreview.tsx");
    // Advisory toast removed — unavailable conflicts now block via setTimeOffConfirm.
    expect(src).not.toContain("Heads up: Unavailable block");
    // findOverlappingShifts drives the single unified check in both day and week views.
    // Use regex to handle multiline call formatting.
    expect(src).toMatch(/findOverlappingShifts\(\s*unavailableShiftsByTech/);
    // The blocking dialog is wired — action includes overrideTimeOffConflict: true.
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(stripped).toMatch(/setTimeOffConfirm\(\{[\s\S]{0,600}overrideTimeOffConflict:\s*true/);
  });
});

// ── Source-pin: sidebar receives shift props ──────────────────────────────────

describe("DispatchTechnicianSidebar shift props wired in DispatchPreview", () => {
  it("passes techsOnCall to sidebar", () => {
    const src = read("client/src/pages/DispatchPreview.tsx");
    expect(src).toContain("techsOnCall={techsOnCall}");
  });

  it("passes normalShifts gated by shiftFeatureEnabled", () => {
    const src = read("client/src/pages/DispatchPreview.tsx");
    expect(src).toContain("normalShifts={shiftFeatureEnabled ? normalShifts : undefined}");
  });

  it("passes selectedDateStr to sidebar", () => {
    const src = read("client/src/pages/DispatchPreview.tsx");
    expect(src).toContain('selectedDateStr={format(selectedDate, "yyyy-MM-dd")}');
  });
});

// ── Source-pin: OnCallIndicator and ShiftOverlay connected in sidebar ─────────

describe("OnCallIndicator and ShiftOverlay integrated in DispatchTechnicianSidebar", () => {
  it("sidebar imports OnCallIndicator and ShiftOverlay", () => {
    const src = read("client/src/components/dispatch/DispatchTechnicianSidebar.tsx");
    expect(src).toContain("OnCallIndicator");
    expect(src).toContain("ShiftOverlay");
  });

  it("OnCallIndicator show prop is wired from techsOnCall set", () => {
    const src = read("client/src/components/dispatch/DispatchTechnicianSidebar.tsx");
    expect(src).toContain("techsOnCall?.has(t.id)");
  });

  it("ShiftOverlay receives normalShifts and selectedDateStr", () => {
    const src = read("client/src/components/dispatch/DispatchTechnicianSidebar.tsx");
    expect(src).toContain("normalShifts");
    expect(src).toContain("selectedDateStr");
  });
});
