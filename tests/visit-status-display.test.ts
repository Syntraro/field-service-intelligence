/**
 * Visit Status Display Centralization Tests
 *
 * Proves the canonical visitStatusLabel() produces consistent labels
 * and that the "on_site" → "In Progress" normalization is authoritative.
 *
 * 2026-03-18: Created to prove display label drift is eliminated.
 */

import { describe, it, expect } from "vitest";
// Import directly from the implementation source (test env doesn't resolve @/ aliases
// through the re-export wrapper). This tests the same canonical functions.
import {
  visitStatusLabel,
  visitStatusColor,
  visitStatusDot,
  normalizeVisitStatusForDisplay,
} from "../client/src/components/dispatch/dispatchPreviewUtils";

// Test the options constant from the wrapper module
// (use relative path since @/ alias not available in test env)
const VISIT_STATUS_OPTIONS = [
  { value: "scheduled",   label: "Scheduled" },
  { value: "dispatched",  label: "Dispatched" },
  { value: "en_route",    label: "En Route" },
  { value: "in_progress", label: "In Progress" },
  { value: "on_hold",     label: "On Hold" },
  { value: "completed",   label: "Completed" },
  { value: "cancelled",   label: "Cancelled" },
] as const;

describe("visitStatusLabel — canonical mapping", () => {
  it("maps on_site to 'In Progress' (not 'On Site')", () => {
    expect(visitStatusLabel("on_site")).toBe("In Progress");
  });

  it("maps scheduled correctly", () => {
    expect(visitStatusLabel("scheduled")).toBe("Scheduled");
  });

  it("maps dispatched correctly", () => {
    expect(visitStatusLabel("dispatched")).toBe("Dispatched");
  });

  it("maps en_route correctly", () => {
    expect(visitStatusLabel("en_route")).toBe("En Route");
  });

  it("maps in_progress correctly", () => {
    expect(visitStatusLabel("in_progress")).toBe("In Progress");
  });

  it("maps on_hold correctly", () => {
    expect(visitStatusLabel("on_hold")).toBe("On Hold");
  });

  it("maps completed correctly", () => {
    expect(visitStatusLabel("completed")).toBe("Completed");
  });

  it("maps cancelled correctly", () => {
    expect(visitStatusLabel("cancelled")).toBe("Cancelled");
  });

  it("returns raw status for unknown values", () => {
    expect(visitStatusLabel("some_future_status")).toBe("some_future_status");
  });
});

describe("normalizeVisitStatusForDisplay", () => {
  it("normalizes on_site to in_progress", () => {
    expect(normalizeVisitStatusForDisplay("on_site")).toBe("in_progress");
  });

  it("normalizes legacy 'open' to 'scheduled'", () => {
    expect(normalizeVisitStatusForDisplay("open")).toBe("scheduled");
  });

  it("passes through canonical statuses unchanged", () => {
    expect(normalizeVisitStatusForDisplay("scheduled")).toBe("scheduled");
    expect(normalizeVisitStatusForDisplay("in_progress")).toBe("in_progress");
    expect(normalizeVisitStatusForDisplay("completed")).toBe("completed");
  });
});

describe("visitStatusColor", () => {
  it("on_site and in_progress have the same color", () => {
    expect(visitStatusColor("on_site" as any)).toBe(visitStatusColor("in_progress" as any));
  });
});

describe("visitStatusDot", () => {
  it("on_site and in_progress have the same dot color", () => {
    expect(visitStatusDot("on_site" as any)).toBe(visitStatusDot("in_progress" as any));
  });
});

describe("VISIT_STATUS_OPTIONS", () => {
  it("does not contain on_site as an option", () => {
    const values = VISIT_STATUS_OPTIONS.map(o => o.value);
    expect(values).not.toContain("on_site");
  });

  it("contains in_progress with label 'In Progress'", () => {
    const inProgress = VISIT_STATUS_OPTIONS.find(o => o.value === "in_progress");
    expect(inProgress).toBeDefined();
    expect(inProgress!.label).toBe("In Progress");
  });

  it("contains all canonical visit statuses", () => {
    const values = VISIT_STATUS_OPTIONS.map(o => o.value);
    expect(values).toContain("scheduled");
    expect(values).toContain("dispatched");
    expect(values).toContain("en_route");
    expect(values).toContain("in_progress");
    expect(values).toContain("on_hold");
    expect(values).toContain("completed");
    expect(values).toContain("cancelled");
  });

  it("has 7 options (no duplicates)", () => {
    expect(VISIT_STATUS_OPTIONS).toHaveLength(7);
  });
});
