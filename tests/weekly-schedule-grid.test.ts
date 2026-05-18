/**
 * Weekly Schedule Grid — Phase 1 logic tests (2026-05-17)
 *
 * Covers the pure utility functions backing the WeeklyScheduleGrid component.
 * No React / DOM dependencies — these run under Vitest without jsdom.
 *
 * Invariants under test:
 *   1. initWeeklyHours produces exactly seven rows (dayOfWeek 0–6).
 *   2. toggleDayWorking: false → true sets isWorking=true.
 *   3. toggleDayWorking: true → false sets isWorking=false.
 *   4. Toggling ON with no existing times injects WORKING_DAY_DEFAULTS.
 *   5. Toggling ON preserves existing startTime/endTime when already set.
 *   6. Toggling OFF preserves existing startTime/endTime (no data loss).
 *   7. Other days are not mutated when one day is toggled.
 */

import { describe, it, expect } from "vitest";
import {
  initWeeklyHours,
  toggleDayWorking,
  WORKING_DAY_DEFAULTS,
  type WeeklyHoursRow,
} from "../client/src/lib/weeklyScheduleUtils";

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function makeRow(dayOfWeek: number, overrides?: Partial<WeeklyHoursRow>): WeeklyHoursRow {
  return {
    dayOfWeek,
    startTime: null,
    endTime: null,
    isWorking: false,
    ...overrides,
  };
}

function makeFullWeek(overrides?: Partial<WeeklyHoursRow>): WeeklyHoursRow[] {
  return ALL_DAYS.map((d) => makeRow(d, overrides));
}

// ─── initWeeklyHours ────────────────────────────────────────────────────────

describe("initWeeklyHours", () => {
  it("returns exactly seven rows when given a full saved list", () => {
    const saved = ALL_DAYS.map((d) => makeRow(d));
    const result = initWeeklyHours(saved, ALL_DAYS);
    expect(result).toHaveLength(7);
  });

  it("covers dayOfWeek 0 through 6", () => {
    const saved = ALL_DAYS.map((d) => makeRow(d));
    const result = initWeeklyHours(saved, ALL_DAYS);
    expect(result.map((r) => r.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("fills missing days with isWorking=false and null times", () => {
    // Only Monday saved
    const saved = [makeRow(1, { isWorking: true, startTime: "08:00", endTime: "17:00" })];
    const result = initWeeklyHours(saved, ALL_DAYS);
    expect(result).toHaveLength(7);
    const sun = result.find((r) => r.dayOfWeek === 0)!;
    expect(sun.isWorking).toBe(false);
    expect(sun.startTime).toBeNull();
    expect(sun.endTime).toBeNull();
  });

  it("preserves saved data for present days", () => {
    const saved = [makeRow(3, { isWorking: true, startTime: "09:00", endTime: "18:00" })];
    const result = initWeeklyHours(saved, ALL_DAYS);
    const wed = result.find((r) => r.dayOfWeek === 3)!;
    expect(wed.isWorking).toBe(true);
    expect(wed.startTime).toBe("09:00");
    expect(wed.endTime).toBe("18:00");
  });
});

// ─── toggleDayWorking ───────────────────────────────────────────────────────

describe("toggleDayWorking", () => {
  it("toggles isWorking from false to true", () => {
    const hours = makeFullWeek();
    const result = toggleDayWorking(hours, 1, true);
    expect(result.find((h) => h.dayOfWeek === 1)?.isWorking).toBe(true);
  });

  it("toggles isWorking from true to false", () => {
    const hours = makeFullWeek().map((h) =>
      h.dayOfWeek === 1
        ? { ...h, isWorking: true, startTime: "08:00", endTime: "17:00" }
        : h,
    );
    const result = toggleDayWorking(hours, 1, false);
    expect(result.find((h) => h.dayOfWeek === 1)?.isWorking).toBe(false);
  });

  it("injects WORKING_DAY_DEFAULTS when toggling on a day with no existing times", () => {
    const hours = makeFullWeek(); // all have startTime=null, endTime=null
    const result = toggleDayWorking(hours, 2, true);
    const day = result.find((h) => h.dayOfWeek === 2)!;
    expect(day.startTime).toBe(WORKING_DAY_DEFAULTS.startTime);
    expect(day.endTime).toBe(WORKING_DAY_DEFAULTS.endTime);
  });

  it("preserves existing startTime/endTime when toggling ON a day that already has times", () => {
    const hours = makeFullWeek().map((h) =>
      h.dayOfWeek === 4
        ? { ...h, isWorking: false, startTime: "10:00", endTime: "16:00" }
        : h,
    );
    const result = toggleDayWorking(hours, 4, true);
    const day = result.find((h) => h.dayOfWeek === 4)!;
    expect(day.isWorking).toBe(true);
    expect(day.startTime).toBe("10:00");
    expect(day.endTime).toBe("16:00");
  });

  it("preserves existing startTime/endTime when toggling OFF (no data loss)", () => {
    const hours = makeFullWeek().map((h) =>
      h.dayOfWeek === 5
        ? { ...h, isWorking: true, startTime: "07:30", endTime: "15:30" }
        : h,
    );
    const result = toggleDayWorking(hours, 5, false);
    const day = result.find((h) => h.dayOfWeek === 5)!;
    expect(day.isWorking).toBe(false);
    expect(day.startTime).toBe("07:30");
    expect(day.endTime).toBe("15:30");
  });

  it("does not mutate other days when toggling one day", () => {
    const hours = makeFullWeek();
    const result = toggleDayWorking(hours, 3, true);
    const others = result.filter((h) => h.dayOfWeek !== 3);
    const originalOthers = hours.filter((h) => h.dayOfWeek !== 3);
    expect(others).toEqual(originalOthers);
  });

  it("returns a new array reference (immutable update)", () => {
    const hours = makeFullWeek();
    const result = toggleDayWorking(hours, 0, true);
    expect(result).not.toBe(hours);
  });
});
