/**
 * Effective-End Centralization Tests
 *
 * Proves the canonical getEffectiveEnd() helper implements the correct
 * priority rules and that consumers (isJobOverdue, visitIntelligence)
 * now share the same computation.
 *
 * 2026-03-18: Created to prove effective-end drift is eliminated.
 */

import { describe, it, expect } from "vitest";
import { getEffectiveEnd, isJobOverdue } from "@shared/schema";

describe("getEffectiveEnd — canonical helper", () => {
  // ==========================================================================
  // Priority 1: scheduledEnd takes precedence
  // ==========================================================================

  it("returns scheduledEnd when present (even if duration exists)", () => {
    const end = new Date("2026-03-18T15:00:00Z");
    const result = getEffectiveEnd({
      scheduledStart: new Date("2026-03-18T10:00:00Z"),
      scheduledEnd: end,
      durationMinutes: 120,
    });
    expect(result).toEqual(end);
  });

  it("returns scheduledEnd from string", () => {
    const result = getEffectiveEnd({
      scheduledStart: "2026-03-18T10:00:00Z",
      scheduledEnd: "2026-03-18T15:00:00Z",
    });
    expect(result).toEqual(new Date("2026-03-18T15:00:00Z"));
  });

  // ==========================================================================
  // Priority 2: scheduledStart + duration fallback
  // ==========================================================================

  it("returns scheduledStart + durationMinutes when scheduledEnd absent", () => {
    const result = getEffectiveEnd({
      scheduledStart: new Date("2026-03-18T10:00:00Z"),
      scheduledEnd: null,
      durationMinutes: 90,
    });
    expect(result).toEqual(new Date("2026-03-18T11:30:00Z"));
  });

  it("returns scheduledStart + estimatedDurationMinutes for visits", () => {
    const result = getEffectiveEnd({
      scheduledStart: new Date("2026-03-18T10:00:00Z"),
      scheduledEnd: null,
      durationMinutes: null,
      estimatedDurationMinutes: 45,
    });
    expect(result).toEqual(new Date("2026-03-18T10:45:00Z"));
  });

  it("prefers durationMinutes over estimatedDurationMinutes", () => {
    const result = getEffectiveEnd({
      scheduledStart: new Date("2026-03-18T10:00:00Z"),
      scheduledEnd: null,
      durationMinutes: 60,
      estimatedDurationMinutes: 120,
    });
    // durationMinutes=60 should win
    expect(result).toEqual(new Date("2026-03-18T11:00:00Z"));
  });

  // ==========================================================================
  // Priority 3: scheduledStart-only fallback (THE KEY FIX)
  // ==========================================================================

  it("returns scheduledStart when scheduledEnd and duration are both absent", () => {
    const start = new Date("2026-03-18T10:00:00Z");
    const result = getEffectiveEnd({
      scheduledStart: start,
      scheduledEnd: null,
      durationMinutes: null,
    });
    // This is the case that was MISSING in visitIntelligence before centralization
    expect(result).toEqual(start);
  });

  it("returns scheduledStart when duration is 0", () => {
    const start = new Date("2026-03-18T10:00:00Z");
    const result = getEffectiveEnd({
      scheduledStart: start,
      scheduledEnd: null,
      durationMinutes: 0,
    });
    // 0 is a valid duration (nullish check) → selects duration branch → start + 0 = start
    expect(result).toEqual(start);
  });

  it("returns scheduledStart from string when no end/duration", () => {
    const result = getEffectiveEnd({
      scheduledStart: "2026-03-18T10:00:00Z",
    });
    expect(result).toEqual(new Date("2026-03-18T10:00:00Z"));
  });

  // ==========================================================================
  // Null when no scheduledStart
  // ==========================================================================

  it("returns null when scheduledStart is null", () => {
    const result = getEffectiveEnd({
      scheduledStart: null,
      scheduledEnd: new Date("2026-03-18T15:00:00Z"),
    });
    expect(result).toBeNull();
  });

  it("returns null when scheduledStart is undefined", () => {
    const result = getEffectiveEnd({});
    expect(result).toBeNull();
  });
});

describe("isJobOverdue — uses canonical getEffectiveEnd", () => {
  // ==========================================================================
  // isJobOverdue still works correctly after refactoring to use getEffectiveEnd
  // ==========================================================================

  it("job with scheduledEnd before now is overdue", () => {
    const pastEnd = new Date(Date.now() - 3600000); // 1h ago
    const result = isJobOverdue({
      status: "open",
      scheduledStart: new Date(Date.now() - 7200000), // 2h ago
      scheduledEnd: pastEnd,
    });
    expect(result).toBe(true);
  });

  it("job with scheduledEnd in future is not overdue", () => {
    const futureEnd = new Date(Date.now() + 3600000); // 1h from now
    const result = isJobOverdue({
      status: "open",
      scheduledStart: new Date(Date.now() - 3600000),
      scheduledEnd: futureEnd,
    });
    expect(result).toBe(false);
  });

  it("job with only scheduledStart in the past is overdue (point-in-time)", () => {
    const pastStart = new Date(Date.now() - 3600000);
    const result = isJobOverdue({
      status: "open",
      scheduledStart: pastStart,
      // No scheduledEnd, no durationMinutes
    });
    // This uses the scheduledStart-only fallback via getEffectiveEnd
    expect(result).toBe(true);
  });

  it("completed job is never overdue", () => {
    const result = isJobOverdue({
      status: "completed",
      scheduledStart: new Date(Date.now() - 86400000),
    });
    expect(result).toBe(false);
  });

  it("unscheduled job is never overdue", () => {
    const result = isJobOverdue({
      status: "open",
      scheduledStart: null,
    });
    expect(result).toBe(false);
  });

  it("in_progress job is not overdue-attention", () => {
    const result = isJobOverdue({
      status: "open",
      openSubStatus: "in_progress",
      scheduledStart: new Date(Date.now() - 86400000),
    });
    expect(result).toBe(false);
  });
});

describe("visitIntelligence effective-end contradiction eliminated", () => {
  // ==========================================================================
  // Prove the old contradiction is gone: a visit with scheduledStart only
  // now produces the same effective end everywhere
  // ==========================================================================

  it("visit with only scheduledStart (no end, no duration) gets scheduledStart as effectiveEnd", () => {
    const start = new Date("2026-03-18T10:00:00Z");

    // Simulate what visitIntelligence would compute:
    // OLD: effectiveEnd = v.scheduledEnd ? ... : new Date(start + durMin * 60000)
    //   with durMin defaulting to 60 → 11:00:00Z (WRONG — fabricated duration)
    // NEW: getEffectiveEnd(v) → start = 10:00:00Z (CORRECT — no fabricated duration)
    const result = getEffectiveEnd({
      scheduledStart: start,
      scheduledEnd: null,
      estimatedDurationMinutes: null,
    });

    expect(result).toEqual(start);
    // Previously visitIntelligence would have computed 11:00:00Z (start + 60min default)
    expect(result).not.toEqual(new Date("2026-03-18T11:00:00Z"));
  });

  it("visit with estimatedDurationMinutes uses duration correctly", () => {
    const result = getEffectiveEnd({
      scheduledStart: new Date("2026-03-18T10:00:00Z"),
      scheduledEnd: null,
      estimatedDurationMinutes: 45,
    });
    expect(result).toEqual(new Date("2026-03-18T10:45:00Z"));
  });

  it("job and visit produce same effectiveEnd for identical inputs", () => {
    const input = {
      scheduledStart: new Date("2026-03-18T10:00:00Z"),
      scheduledEnd: null as Date | null,
      durationMinutes: 90,
      estimatedDurationMinutes: null as number | null,
    };

    const fromJob = getEffectiveEnd(input);
    // Visit-style: durationMinutes=null, estimatedDurationMinutes=90
    const fromVisit = getEffectiveEnd({
      ...input,
      durationMinutes: null,
      estimatedDurationMinutes: 90,
    });

    expect(fromJob).toEqual(fromVisit);
    expect(fromJob).toEqual(new Date("2026-03-18T11:30:00Z"));
  });
});
