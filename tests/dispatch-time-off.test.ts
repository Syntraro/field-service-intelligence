/**
 * Dispatch Board — technician time-off rendering + assignment
 * warning + server-side conflict detection (2026-05-07 RALPH).
 *
 * Pins the surface of the new feature across five files:
 *   • Server reschedule route  — accepts `overrideTimeOffConflict`
 *     in the body schema; preflight check returns 409 with code
 *     `TIME_OFF_CONFLICT` when the resolved (tech, range) overlaps
 *     a non-archived time-off row, unless the override flag is set.
 *   • Dispatch data hook       — fetches `/api/technician-time-off`
 *     for the visible range and exposes `timeOff` on the result.
 *   • Day-view lane            — paints amber `time_off` shading
 *     between the hour grid + visit blocks; shading is
 *     pointer-events-none so the lane stays a valid drop target.
 *   • Tech sidebar             — paints an amber "Off" pill next
 *     to a tech name when they have any time-off in the range.
 *   • Page-level wiring        — derives `techsOnTimeOff`,
 *     `timeOffByTech`, and `techsOnTimeOffByDay`; threads them
 *     into the day, week, and month renderers; preflight `check
 *     TimeOffOverlap()` is called from the rescheduleVisit drag
 *     handler before mutating; an AlertDialog mirrors the existing
 *     off-shift confirmation pattern; the mutation override flag
 *     is forwarded to the server.
 *
 * Source-pin tests because the visible behaviour lives in the
 * source shape (Tailwind classes, prop wiring, regex over the
 * mutation body construction). Booting a JSDOM render of the
 * dispatch board with @dnd-kit is excessive for what the brief
 * asks us to lock down.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const path = (p: string) => resolve(ROOT, p);

const SCHED_ROUTE_PATH = path("server/routes/scheduling.ts");
const DATA_CORE_PATH = path("client/src/components/dispatch/dispatchDataCore.ts");
const LANE_PATH = path("client/src/components/dispatch/DispatchLaneRow.tsx");
const SIDEBAR_PATH = path("client/src/components/dispatch/DispatchTechnicianSidebar.tsx");
const TIMELINE_PATH = path("client/src/components/dispatch/DispatchTimeline.tsx");
const WEEK_PATH = path("client/src/components/dispatch/WeekDispatchGrid.tsx");
const MONTH_PATH = path("client/src/components/dispatch/MonthDispatchGrid.tsx");
const PAGE_PATH = path("client/src/pages/DispatchPreview.tsx");
const MUT_PATH = path("client/src/components/dispatch/useDispatchPreviewMutations.ts");

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

// ─── 1. Server: reschedule schema + preflight conflict ─────────────

describe("Server reschedule — accepts overrideTimeOffConflict + returns 409", () => {
  const code = read(SCHED_ROUTE_PATH);
  const codeNoComments = stripComments(code);

  it("rescheduleVisitSchema includes overrideTimeOffConflict (boolean optional)", () => {
    expect(codeNoComments).toMatch(
      /overrideTimeOffConflict:\s*z\.boolean\(\)\.optional\(\)/,
    );
  });

  it("imports the time-off repository", () => {
    expect(codeNoComments).toMatch(
      /import\s*\{\s*technicianTimeOffRepository\s*\}\s*from\s*"\.\.\/storage\/technicianTimeOff"/,
    );
  });

  it("preflight check is gated by overrideTimeOffConflict !== true", () => {
    expect(codeNoComments).toMatch(
      /if \(data\.overrideTimeOffConflict !== true\)/,
    );
  });

  it("preflight calls listOverlapping for the effective range", () => {
    expect(codeNoComments).toMatch(
      /technicianTimeOffRepository\.listOverlapping\(\s*companyId/,
    );
  });

  it("returns 409 with code TIME_OFF_CONFLICT + conflicts payload on overlap", () => {
    expect(codeNoComments).toMatch(
      /res\.status\(409\)\.json\([\s\S]{0,200}code:\s*"TIME_OFF_CONFLICT"/,
    );
    expect(codeNoComments).toMatch(/conflicts:\s*conflicts\.map/);
  });

  it("preflight is wrapped in try/catch (defensive — missing migration must not crash reschedule)", () => {
    // Pin the warn-and-continue fallback so a broken time-off table
    // can't block the canonical reschedule path.
    expect(codeNoComments).toMatch(
      /\[reschedule\] time-off preflight failed; proceeding without conflict check/,
    );
  });
});

// ─── 2. Dispatch data hook — fetches + exposes timeOff ─────────────

describe("Dispatch data — useDispatchRangeData fetches time-off", () => {
  const code = read(DATA_CORE_PATH);
  const codeNoComments = stripComments(code);

  it("declares a DispatchTimeOffEntry interface + exports it", () => {
    expect(code).toMatch(/export interface DispatchTimeOffEntry/);
  });

  it("includes timeOff on DispatchRangeData", () => {
    expect(code).toMatch(/timeOff:\s*DispatchTimeOffEntry\[\]/);
  });

  it("queries /api/technician-time-off keyed on the same start/end as /api/calendar", () => {
    expect(codeNoComments).toMatch(
      /queryKey:\s*\["\/api\/technician-time-off",\s*startISO,\s*endISO\]/,
    );
    expect(codeNoComments).toMatch(/\/api\/technician-time-off\?start=/);
  });

  it("the time-off query has retry: 1 so a missing migration surfaces fast", () => {
    expect(codeNoComments).toMatch(
      /queryKey:\s*\["\/api\/technician-time-off"[\s\S]{0,400}retry:\s*1/,
    );
  });

  it("time-off failure does NOT enter the overall isLoading aggregation", () => {
    // Pin: only scheduledQuery + unscheduledQuery + techLoading
    // contribute. timeOff is additive — its failure must not surface
    // as a dispatch-wide spinner.
    expect(codeNoComments).toMatch(
      /isLoading:[\s\S]{0,120}scheduledQuery\.isLoading\s*\|\|\s*unscheduledQuery\.isLoading\s*\|\|\s*techLoading/,
    );
    expect(codeNoComments).not.toMatch(
      /timeOffQuery\.isLoading[\s\S]{0,40}\|\|/,
    );
  });
});

// ─── 3. Day-view lane shading ──────────────────────────────────────

describe("Day view — DispatchLaneRow paints time-off shading", () => {
  const code = read(LANE_PATH);
  const codeNoComments = stripComments(code);

  it("accepts timeOff + dayDateISO props", () => {
    expect(code).toMatch(/timeOff\?:\s*DispatchLaneTimeOff\[\]/);
    expect(code).toMatch(/dayDateISO\?:\s*string/);
  });

  it("emits a stable test id per time-off shading block via the primitive's testId prop", () => {
    // Post-refactor (2026-05-07): rendering moved to the shared
    // <TimeOffOverlay> primitive; the test id is forwarded via
    // its `testId` prop, not a literal `data-testid` attribute.
    expect(code).toMatch(/testId=\{?`dispatch-lane-time-off-/);
  });

  it("renders the canonical TimeOffOverlay primitive (variant=lane-band) per segment", () => {
    expect(code).toMatch(
      /<TimeOffOverlay[\s\S]*?variant="lane-band"[\s\S]*?reason=\{seg\.reason\}/,
    );
  });

  it("the per-segment carrier forwards the original endsAt so the primitive can compute Returning <date>", () => {
    expect(code).toMatch(/endsAtISO:\s*t\.endsAt/);
  });

  it("computes per-segment left/width from getVisitPosition's pxPerMin formula", () => {
    expect(code).toMatch(/HOUR_WIDTH_PX\s*\/\s*60/);
  });
});

// ─── 4. Sidebar Off pill ───────────────────────────────────────────

describe("Tech sidebar — Off pill when tech has any time off today", () => {
  const code = read(SIDEBAR_PATH);
  const codeNoComments = stripComments(code);

  it("accepts an optional techsOnTimeOff Set prop", () => {
    expect(code).toMatch(/techsOnTimeOff\?:\s*Set<string>/);
  });

  it("renders the Off pill for any tech ID present in the set", () => {
    expect(codeNoComments).toMatch(/techsOnTimeOff\?\.has\(t\.id\)/);
    expect(code).toMatch(/data-testid=\{?`?tech-time-off-pill-/);
  });

  it("uses the canonical amber-100 palette for the pill", () => {
    expect(code).toMatch(
      /bg-amber-100\s+text-amber-700\s+border-amber-300/,
    );
  });
});

// ─── 5. DispatchTimeline forwards time-off to lanes ────────────────

describe("DispatchTimeline — forwards timeOffByTech + dayDateISO to lanes", () => {
  const code = read(TIMELINE_PATH);

  it("accepts timeOffByTech + dayDateISO props", () => {
    expect(code).toMatch(/timeOffByTech\?:\s*Map<string/);
    expect(code).toMatch(/dayDateISO\?:\s*string/);
  });

  it("threads timeOff (per-tech lookup) + dayDateISO into each DispatchLaneRow", () => {
    // Both working AND off-shift lane render sites should get the
    // props — the off-shift sidebar group might still have time-off
    // entries to paint.
    const matches =
      code.match(/timeOff=\{timeOffByTech\?\.get\(t\.id\)\}/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── 6. Week + month minimal indicators ────────────────────────────

describe("Week view — per-day off chip in the day-column header", () => {
  const code = read(WEEK_PATH);

  it("accepts techsOnTimeOffByDay (Map<dayKey, Set<techId>>)", () => {
    expect(code).toMatch(/techsOnTimeOffByDay\?:\s*Map<string,\s*Set<string>>/);
  });

  it("renders the chip with the canonical week-day-off-chip test id", () => {
    expect(code).toMatch(/data-testid=\{?`?week-day-off-chip-/);
  });

  it("renders 1-tech-off as the canonical primitive AND ≥ 2 as a summary chip", () => {
    // Post-refactor (2026-05-07): the rendering split is now
    // `offCount === 1` → <TimeOffOverlay variant="chip">; and
    // `offCount > 1` → compact "N off" summary span. The previous
    // single-branch `offCount > 0` is gone.
    expect(code).toMatch(/offCount === 1/);
    expect(code).toMatch(/offCount > 1/);
  });
});

describe("Month view — per-day off chip in the day-cell header", () => {
  const code = read(MONTH_PATH);

  it("accepts techsOnTimeOffByDay (Map<dayKey, Set<techId>>)", () => {
    expect(code).toMatch(/techsOnTimeOffByDay\?:\s*Map<string,\s*Set<string>>/);
  });

  it("MonthDayCell accepts techsOffCount", () => {
    expect(code).toMatch(/techsOffCount\?:\s*number/);
  });

  it("renders the chip with the canonical month-day-off-chip test id", () => {
    expect(code).toMatch(/data-testid=\{?`?month-day-off-chip-/);
  });
});

// ─── 7. Page-level wiring + drag confirm ───────────────────────────

describe("DispatchPreview — wires time-off + drag confirm + mutation override", () => {
  const code = read(PAGE_PATH);
  const codeNoComments = stripComments(code);

  it("derives timeOffEntries, timeOffByTech, techsOnTimeOff, techsOnTimeOffByDay", () => {
    expect(codeNoComments).toMatch(/const timeOffEntries\s*=/);
    expect(codeNoComments).toMatch(/const timeOffByTech\s*=\s*useMemo/);
    expect(codeNoComments).toMatch(/const techsOnTimeOff\s*=\s*useMemo/);
    expect(codeNoComments).toMatch(/const techsOnTimeOffByDay\s*=\s*useMemo/);
  });

  it("threads techsOnTimeOff into the day-view sidebar", () => {
    expect(code).toMatch(/techsOnTimeOff=\{techsOnTimeOff\}/);
  });

  it("threads timeOffByTech + dayDateISO into the day-view timeline", () => {
    expect(code).toMatch(/timeOffByTech=\{timeOffByTech\}/);
    expect(code).toMatch(/dayDateISO=\{selectedDate\.toISOString\(\)\}/);
  });

  it("threads techsOnTimeOffByDay into both WeekDispatchGrid + MonthDispatchGrid", () => {
    const matches =
      code.match(/techsOnTimeOffByDay=\{techsOnTimeOffByDay\}/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("declares a checkTimeOffOverlap useCallback with the canonical signature", () => {
    expect(codeNoComments).toMatch(
      /const checkTimeOffOverlap = useCallback\(\s*\(techIds: string\[\], startISO: string, endISO: string\)/,
    );
  });

  it("checkTimeOffOverlap uses the canonical (a.start < b.end && a.end > b.start) predicate", () => {
    expect(codeNoComments).toMatch(/entryStart\s*<\s*endMs\s*&&\s*entryEnd\s*>\s*startMs/);
  });

  it("declares timeOffConfirm state mirroring the off-shift dialog pattern", () => {
    expect(codeNoComments).toMatch(/const \[timeOffConfirm,\s*setTimeOffConfirm\]\s*=\s*useState/);
  });

  it("the drag-end handler defers the rescheduleVisit when overlap is detected and stages the confirm dialog", () => {
    // Pin the call: setTimeOffConfirm(...) inside the rescheduleVisit
    // drag branch, with an action that re-issues the mutation with
    // overrideTimeOffConflict: true.
    expect(codeNoComments).toMatch(
      /setTimeOffConfirm\(\{[\s\S]{0,400}overrideTimeOffConflict:\s*true/,
    );
  });

  it("renders an AlertDialog with the canonical dispatch-time-off-confirm test id", () => {
    expect(code).toMatch(/data-testid="dispatch-time-off-confirm"/);
    expect(code).toMatch(/data-testid="dispatch-time-off-confirm-cancel"/);
    expect(code).toMatch(/data-testid="dispatch-time-off-confirm-accept"/);
  });

  it("the dialog's accept button invokes the deferred action", () => {
    expect(codeNoComments).toMatch(
      /onClick=\{\(\)\s*=>\s*\{\s*timeOffConfirm\?\.action\(\);\s*setTimeOffConfirm\(null\);\s*\}\}/,
    );
  });
});

// ─── 8. Mutation hook forwards override flag ───────────────────────

describe("useDispatchPreviewMutations — overrideTimeOffConflict forwarded to API", () => {
  const code = read(MUT_PATH);
  const codeNoComments = stripComments(code);

  it("RescheduleParams accepts overrideTimeOffConflict (optional boolean)", () => {
    expect(code).toMatch(/overrideTimeOffConflict\?:\s*boolean/);
  });

  it("the destructure in rescheduleVisit pulls the flag out", () => {
    expect(codeNoComments).toMatch(/overrideTimeOffConflict\s*\}\s*=\s*params/);
  });

  it("the request body includes overrideTimeOffConflict only when true", () => {
    expect(codeNoComments).toMatch(
      /if \(overrideTimeOffConflict === true\)\s*\{\s*body\.overrideTimeOffConflict = true/,
    );
  });
});

// ─── 9. File existence sanity ──────────────────────────────────────

describe("Dispatch time-off — touched files exist", () => {
  for (const p of [
    SCHED_ROUTE_PATH,
    DATA_CORE_PATH,
    LANE_PATH,
    SIDEBAR_PATH,
    TIMELINE_PATH,
    WEEK_PATH,
    MONTH_PATH,
    PAGE_PATH,
    MUT_PATH,
  ]) {
    it(`exists: ${p.replace(ROOT, "")}`, () => {
      expect(existsSync(p)).toBe(true);
    });
  }
});
