/**
 * safeDateTime utility tests — validates the defensive datetime normalization
 * used by the tech Today page timeline for sort-key and day-key derivation.
 *
 * 2026-04-10: Created as part of timeline datetime hardening.
 */
import { describe, it, expect } from "vitest";
import { toEpochMsSafe, toLocalDateKey } from "../client/src/tech-app/utils/safeDateTime";

describe("toEpochMsSafe", () => {
  it("returns epoch ms for valid ISO string", () => {
    const ms = toEpochMsSafe("2026-04-10T14:00:00.000Z");
    expect(ms).toBe(new Date("2026-04-10T14:00:00.000Z").getTime());
  });

  it("returns epoch ms for valid Date object", () => {
    const d = new Date("2026-04-10T09:26:00.000Z");
    expect(toEpochMsSafe(d)).toBe(d.getTime());
  });

  it("returns null for null", () => {
    expect(toEpochMsSafe(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(toEpochMsSafe(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(toEpochMsSafe("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(toEpochMsSafe("   ")).toBeNull();
  });

  it("returns null for malformed datetime", () => {
    expect(toEpochMsSafe("not-a-date")).toBeNull();
  });

  it("returns null for partial datetime", () => {
    expect(toEpochMsSafe("2026-13-45")).toBeNull();
  });

  it("never returns NaN", () => {
    const values = [null, undefined, "", "garbage", "2026-99-99", "NaN"];
    for (const v of values) {
      const result = toEpochMsSafe(v);
      if (result !== null) {
        expect(Number.isNaN(result)).toBe(false);
      }
    }
  });
});

describe("toLocalDateKey", () => {
  it("returns YYYY-MM-DD for valid ISO string", () => {
    // This test uses a known UTC time; the local date depends on the test runner's timezone.
    // Use a midday UTC time so it's the same date in all reasonable timezones.
    const key = toLocalDateKey("2026-04-10T12:00:00.000Z");
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(key).toBe("2026-04-10");
  });

  it("returns YYYY-MM-DD for valid Date object", () => {
    const d = new Date(2026, 3, 10, 12, 0, 0); // April 10, 2026, noon local
    expect(toLocalDateKey(d)).toBe("2026-04-10");
  });

  it("returns null for null", () => {
    expect(toLocalDateKey(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(toLocalDateKey(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(toLocalDateKey("")).toBeNull();
  });

  it("returns null for malformed datetime", () => {
    expect(toLocalDateKey("not-a-date")).toBeNull();
  });
});

describe("sort consistency", () => {
  it("9:26 AM sorts before 12:15 PM using epoch ms", () => {
    const a = toEpochMsSafe("2026-04-10T09:26:00-04:00")!;
    const b = toEpochMsSafe("2026-04-10T12:15:00-04:00")!;
    expect(a).toBeLessThan(b);
  });

  it("2:00 PM sorts before 3:45 PM using epoch ms", () => {
    const a = toEpochMsSafe("2026-04-10T14:00:00-04:00")!;
    const b = toEpochMsSafe("2026-04-10T15:45:00-04:00")!;
    expect(a).toBeLessThan(b);
  });

  it("mixed visits and tasks sort correctly when both use epoch ms", () => {
    const items = [
      { label: "3:45 PM visit", ms: toEpochMsSafe("2026-04-10T15:45:00-04:00")! },
      { label: "9:26 AM task", ms: toEpochMsSafe("2026-04-10T09:26:00-04:00")! },
      { label: "12:15 PM visit", ms: toEpochMsSafe("2026-04-10T12:15:00-04:00")! },
      { label: "2:00 PM task", ms: toEpochMsSafe("2026-04-10T14:00:00-04:00")! },
      { label: "11:00 AM visit", ms: toEpochMsSafe("2026-04-10T11:00:00-04:00")! },
    ];
    items.sort((a, b) => a.ms - b.ms);
    expect(items.map(i => i.label)).toEqual([
      "9:26 AM task",
      "11:00 AM visit",
      "12:15 PM visit",
      "2:00 PM task",
      "3:45 PM visit",
    ]);
  });
});
