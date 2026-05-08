/**
 * Dispatch time-off overlay — canonical labels + return-day
 * formatting + shared rendering primitive (2026-05-07 RALPH).
 *
 * Two layers under test:
 *
 *   1. **Pure helpers** (`client/src/lib/timeOffFormatting.ts`):
 *      `formatTimeOffReturnLabel`, `formatTimeOffLabel`,
 *      `getTimeOffVariant`, `formatTimeOffAriaLabel`. Tested as
 *      regular unit tests (no DOM, no React).
 *
 *   2. **Shared `<TimeOffOverlay>` primitive + its three
 *      consumers** (DispatchLaneRow, WeekDispatchGrid,
 *      MonthDispatchGrid). Source-pin tests because the visual
 *      contract lives in the JSX shape (variant prop, palette
 *      classes, test ids, prop threading).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import {
  formatReasonForDisplay,
  formatTimeOffAriaLabel,
  formatTimeOffLabel,
  formatTimeOffReturnLabel,
  getTimeOffReturnDate,
  getTimeOffVariant,
} from "../client/src/lib/timeOffFormatting";

const ROOT = resolve(__dirname, "..");
const path = (p: string) => resolve(ROOT, p);

const HELPER_PATH = path("client/src/lib/timeOffFormatting.ts");
const PRIMITIVE_PATH = path("client/src/components/dispatch/TimeOffOverlay.tsx");
const LANE_PATH = path("client/src/components/dispatch/DispatchLaneRow.tsx");
const WEEK_PATH = path("client/src/components/dispatch/WeekDispatchGrid.tsx");
const MONTH_PATH = path("client/src/components/dispatch/MonthDispatchGrid.tsx");
const PAGE_PATH = path("client/src/pages/DispatchPreview.tsx");

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

// ─── 1. getTimeOffVariant — reason → palette key ───────────────────

describe("getTimeOffVariant — reason → palette key", () => {
  it("maps the four canonical reasons to typed variants", () => {
    expect(getTimeOffVariant("vacation")).toBe("vacation");
    expect(getTimeOffVariant("sick")).toBe("sick");
    expect(getTimeOffVariant("training")).toBe("training");
    expect(getTimeOffVariant("personal")).toBe("personal");
  });

  it("collapses unavailable / other / unknown / null into default", () => {
    expect(getTimeOffVariant("unavailable")).toBe("default");
    expect(getTimeOffVariant("other")).toBe("default");
    expect(getTimeOffVariant("snow_day")).toBe("default");
    expect(getTimeOffVariant("")).toBe("default");
    expect(getTimeOffVariant(null)).toBe("default");
    expect(getTimeOffVariant(undefined)).toBe("default");
  });

  it("is case-insensitive on the input reason", () => {
    expect(getTimeOffVariant("VACATION")).toBe("vacation");
    expect(getTimeOffVariant("Sick")).toBe("sick");
  });
});

// ─── 2. formatReasonForDisplay — capitalize first letter ───────────

describe("formatReasonForDisplay", () => {
  it("capitalizes the first letter for display", () => {
    expect(formatReasonForDisplay("vacation")).toBe("Vacation");
    expect(formatReasonForDisplay("sick")).toBe("Sick");
  });

  it("returns empty string for null / undefined / empty", () => {
    expect(formatReasonForDisplay(null)).toBe("");
    expect(formatReasonForDisplay(undefined)).toBe("");
    expect(formatReasonForDisplay("")).toBe("");
  });
});

// ─── 3. getTimeOffReturnDate — last off day + 1 ────────────────────

describe("getTimeOffReturnDate", () => {
  it("returns null for partial-day entries", () => {
    expect(
      getTimeOffReturnDate("2026-05-08T17:00:00.000Z", false),
    ).toBeNull();
  });

  it("returns the day AFTER endsAt's local calendar day", () => {
    // Off period ends Friday 23:59 → tech returns Saturday.
    const result = getTimeOffReturnDate("2026-05-08T23:59:00.000-04:00", true);
    expect(result).not.toBeNull();
    if (result) {
      // Local day of result should be one day after the endsAt
      // local day. We just check the math, not absolute timezone.
      const end = new Date("2026-05-08T23:59:00.000-04:00");
      const expectedDay = end.getDate() + 1;
      // Account for month rollover when expectedDay > days in month;
      // we just compare via elapsed-days math against today.
      expect(result.getDate()).toBe(
        new Date(end.getFullYear(), end.getMonth(), expectedDay).getDate(),
      );
    }
  });

  it("returns null for an unparseable endsAt", () => {
    expect(getTimeOffReturnDate("not a date", true)).toBeNull();
  });
});

// ─── 4. formatTimeOffReturnLabel — phrasing rules ──────────────────

describe("formatTimeOffReturnLabel", () => {
  // Anchor "now" so the test isn't time-of-day dependent.
  const may7 = new Date(2026, 4, 7, 12, 0, 0); // May 7, 2026 12:00 local
  const may8End = new Date(2026, 4, 8, 23, 59, 0).toISOString();
  const may7End = new Date(2026, 4, 7, 23, 59, 0).toISOString();
  const may12End = new Date(2026, 4, 12, 23, 59, 0).toISOString();

  it("returns null for partial-day entries (no separate return day)", () => {
    expect(formatTimeOffReturnLabel(may8End, false, may7)).toBeNull();
  });

  it("returns null when the return day is today (already back)", () => {
    // Off ends May 7 → returning May 8. If now is May 8, label is null.
    const may8Noon = new Date(2026, 4, 8, 12, 0, 0);
    expect(formatTimeOffReturnLabel(may7End, true, may8Noon)).toBeNull();
  });

  it("returns null when the return day is in the past", () => {
    const may10 = new Date(2026, 4, 10, 12, 0, 0);
    expect(formatTimeOffReturnLabel(may7End, true, may10)).toBeNull();
  });

  it("returns 'Returning tomorrow' when the return day is exactly +1", () => {
    // Off ends May 7 → return May 8 → today May 7 → "Returning tomorrow".
    expect(formatTimeOffReturnLabel(may7End, true, may7)).toBe(
      "Returning tomorrow",
    );
  });

  it("returns an abbreviated month-day for other future returns", () => {
    // Off ends May 12 → return May 13 → today May 7.
    const result = formatTimeOffReturnLabel(may12End, true, may7);
    expect(result).toMatch(/^Returning [A-Z][a-z]+ \d+$/);
  });
});

// ─── 5. formatTimeOffLabel — composite label rules ─────────────────

describe("formatTimeOffLabel", () => {
  it("composes Time off · Reason · Returning … with all parts", () => {
    expect(
      formatTimeOffLabel({
        reason: "vacation",
        returningLabel: "Returning May 12",
      }),
    ).toBe("Time off · Vacation · Returning May 12");
  });

  it("drops the Reason segment when missing", () => {
    expect(
      formatTimeOffLabel({
        reason: null,
        returningLabel: "Returning May 12",
      }),
    ).toBe("Time off · Returning May 12");
  });

  it("drops the Returning segment when missing", () => {
    expect(
      formatTimeOffLabel({ reason: "sick", returningLabel: null }),
    ).toBe("Time off · Sick");
  });

  it("degrades to bare 'Time off' when both are missing", () => {
    expect(formatTimeOffLabel({})).toBe("Time off");
  });
});

// ─── 6. formatTimeOffAriaLabel — screen-reader sentence ────────────

describe("formatTimeOffAriaLabel", () => {
  it("includes the technician name + reason + returning label", () => {
    const result = formatTimeOffAriaLabel({
      technicianName: "Juliana Smith",
      reason: "vacation",
      returningLabel: "Returning May 12",
    });
    expect(result).toContain("Juliana Smith unavailable");
    expect(result).toContain("vacation");
    expect(result).toContain("returning may 12");
  });

  it("falls back to 'Technician unavailable' when no name", () => {
    expect(
      formatTimeOffAriaLabel({ reason: "sick" }),
    ).toContain("Technician unavailable");
  });

  it("omits the 'due to …' clause when reason is missing", () => {
    const result = formatTimeOffAriaLabel({
      technicianName: "Mike",
      returningLabel: "Returning tomorrow",
    });
    expect(result).not.toContain("due to");
    expect(result).toContain("returning tomorrow");
  });
});

// ─── 7. TimeOffOverlay primitive — source contract ─────────────────

describe("TimeOffOverlay — canonical primitive", () => {
  it("file exists at the canonical path", () => {
    expect(existsSync(PRIMITIVE_PATH)).toBe(true);
  });

  const code = read(PRIMITIVE_PATH);

  it("exposes a variant prop with lane-band + chip values", () => {
    expect(code).toMatch(/variant:\s*"lane-band"\s*\|\s*"chip"/);
  });

  it("imports the canonical formatters from timeOffFormatting", () => {
    expect(code).toMatch(
      /from\s+"@\/lib\/timeOffFormatting"/,
    );
    expect(code).toMatch(/formatTimeOffLabel/);
    expect(code).toMatch(/formatTimeOffReturnLabel/);
    expect(code).toMatch(/getTimeOffVariant/);
    expect(code).toMatch(/formatTimeOffAriaLabel/);
  });

  it("declares per-variant palette classes for both lane-band and chip", () => {
    expect(code).toMatch(/VARIANT_CLASSES:\s*Record<TimeOffVariant/);
    expect(code).toMatch(/CHIP_VARIANT_CLASSES:\s*Record<TimeOffVariant/);
  });

  it("the lane-band variant is pointer-events-none + striped background", () => {
    expect(code).toMatch(/pointer-events-none\s+absolute\s+top-0/);
    expect(code).toMatch(/repeating-linear-gradient/);
  });

  it("forwards the resolved label to title (truncated tooltip) + role=img + aria-label", () => {
    expect(code).toMatch(/title=\{fullLabel\}/);
    expect(code).toMatch(/role="img"/);
    expect(code).toMatch(/aria-label=\{ariaLabel\}/);
  });

  it("emits a data-time-off-variant attribute (palette key)", () => {
    expect(code).toMatch(/data-time-off-variant=\{paletteKey\}/);
  });

  it("the chip variant uses the canonical inline-flex rounded-full structure", () => {
    expect(code).toMatch(
      /inline-flex items-center rounded-full border px-1\.5 py-px text-\[10px\]/,
    );
  });

  it("supports a hideReturning escape hatch (used for partial-day overlays)", () => {
    expect(code).toMatch(/hideReturning\?:\s*boolean/);
  });
});

// ─── 8. DispatchLaneRow consumes the primitive ─────────────────────

describe("DispatchLaneRow — uses TimeOffOverlay (no inline JSX)", () => {
  const code = read(LANE_PATH);

  it("imports TimeOffOverlay from the canonical path", () => {
    expect(code).toMatch(
      /import\s*\{\s*TimeOffOverlay\s*\}\s*from\s*"\.\/TimeOffOverlay"/,
    );
  });

  it("the inline custom shading JSX is gone (replaced by the primitive)", () => {
    // Pin the absence — no per-segment <div> with the old amber
    // band classes.
    expect(code).not.toMatch(
      /pointer-events-none absolute top-0 bg-amber-100\/60 border-y border-amber-300\/60/,
    );
    // The ad-hoc inline label is gone too.
    expect(code).not.toMatch(/seg\.allDay\s*\?\s*`Off · /);
  });

  it("renders <TimeOffOverlay variant=\"lane-band\"> per segment with the canonical props", () => {
    expect(code).toMatch(
      /<TimeOffOverlay[\s\S]*?variant="lane-band"[\s\S]*?reason=\{seg\.reason\}[\s\S]*?endsAtISO=\{seg\.endsAtISO\}[\s\S]*?allDay=\{seg\.allDay\}[\s\S]*?technicianName=\{tech\.name\}/,
    );
  });

  it("the per-segment carrier carries endsAtISO so the primitive can compute the return label", () => {
    expect(code).toMatch(/endsAtISO:\s*string/);
    // The original endsAt (NOT the clipped value) is forwarded so
    // multi-day off windows still render "Returning <date>".
    expect(code).toMatch(/endsAtISO:\s*t\.endsAt/);
  });
});

// ─── 9. WeekDispatchGrid — per-tech labeled chips ──────────────────

describe("WeekDispatchGrid — per-tech labeled chip via the primitive", () => {
  const code = read(WEEK_PATH);

  it("imports the primitive", () => {
    expect(code).toMatch(
      /import\s*\{\s*TimeOffOverlay\s*\}\s*from\s*"\.\/TimeOffOverlay"/,
    );
  });

  it("accepts a rich timeOffEntriesByDay map (with technicianName + reason)", () => {
    expect(code).toMatch(/timeOffEntriesByDay\?:\s*Map<\s*string,\s*Array</);
    expect(code).toMatch(/technicianName:\s*string/);
  });

  it("renders the canonical chip when exactly 1 tech is off", () => {
    expect(code).toMatch(/offCount === 1[\s\S]*?<TimeOffOverlay/);
    expect(code).toMatch(/variant="chip"/);
  });

  it("falls back to a compact 'N off' summary when 2+ techs are off", () => {
    expect(code).toMatch(/offCount > 1[\s\S]{0,400}\{techsOffCount ?? offCount\} off|offCount > 1[\s\S]{0,400}\{offCount\} off/);
  });

  it("the per-day chip carries the canonical week-day-off-chip test id", () => {
    expect(code).toMatch(/data-testid=\{?`?week-day-off-chip-/);
  });
});

// ─── 10. MonthDispatchGrid — per-tech labeled chips ────────────────

describe("MonthDispatchGrid — per-tech labeled chip via the primitive", () => {
  const code = read(MONTH_PATH);

  it("imports the primitive", () => {
    expect(code).toMatch(
      /import\s*\{\s*TimeOffOverlay\s*\}\s*from\s*"\.\/TimeOffOverlay"/,
    );
  });

  it("accepts a rich timeOffEntriesByDay map", () => {
    expect(code).toMatch(/timeOffEntriesByDay\?:\s*Map<\s*string,\s*Array</);
  });

  it("MonthDayCell accepts timeOffEntries + threads them into the primitive when exactly 1 tech is off", () => {
    expect(code).toMatch(/timeOffEntries\?:\s*Array</);
    expect(code).toMatch(
      /\(techsOffCount\s*\?\?\s*0\)\s*===\s*1\s*&&\s*timeOffEntries\?\.\[0\]/,
    );
  });

  it("falls back to compact 'N off' summary chip when 2+ techs are off", () => {
    expect(code).toMatch(
      /\(techsOffCount\s*\?\?\s*0\)\s*>\s*1[\s\S]{0,400}\{techsOffCount\}\s*off/,
    );
  });

  it("each chip carries the canonical month-day-off-chip test id", () => {
    expect(code).toMatch(/data-testid=\{?`?month-day-off-chip-/);
  });
});

// ─── 11. DispatchPreview — derives + threads the rich map ──────────

describe("DispatchPreview — wires timeOffEntriesByDay (with tech names)", () => {
  const code = read(PAGE_PATH);

  it("derives timeOffEntriesByDay with technicianName resolved from the technicians roster", () => {
    expect(code).toMatch(/const timeOffEntriesByDay = useMemo/);
    expect(code).toMatch(/techNameById\.get\(t\.technicianUserId\)/);
  });

  it("threads timeOffEntriesByDay into BOTH WeekDispatchGrid + MonthDispatchGrid", () => {
    const matches =
      code.match(/timeOffEntriesByDay=\{timeOffEntriesByDay\}/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("preserves the existing techsOnTimeOffByDay summary for the day-count fallback", () => {
    expect(code).toMatch(/techsOnTimeOffByDay=\{techsOnTimeOffByDay\}/);
  });
});

// ─── 12. File existence sanity ─────────────────────────────────────

describe("Time-off rendering — touched files exist", () => {
  for (const p of [
    HELPER_PATH,
    PRIMITIVE_PATH,
    LANE_PATH,
    WEEK_PATH,
    MONTH_PATH,
    PAGE_PATH,
  ]) {
    it(`exists: ${p.replace(ROOT, "")}`, () => {
      expect(existsSync(p)).toBe(true);
    });
  }
});
