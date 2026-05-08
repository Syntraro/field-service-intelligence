/**
 * Today's Schedule — workload-driven technician ordering
 * (2026-05-07 RALPH).
 *
 * The schedule card sorts visible technicians by a 4-tier rule:
 *   1. Booked-visit count desc (open slots NOT counted).
 *   2. Total booked duration desc.
 *   3. Earliest booked start time asc.
 *   4. Display name asc (stable tie-breaker).
 *
 * The sort is DISPLAY-ORDER ONLY — `bookedPercent`, capacity blocks,
 * and slot availability all read from the upstream `techs` /
 * `activeTechs` slice and are unaffected.
 *
 * Source-pin tests because the sort lives inline in the
 * `visibleTechs` `useMemo` derivation in `FinancialDashboard.tsx`.
 * Pinning the source shape keeps the contract observable without
 * having to mount JSDOM + the capacity query mock.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const path = (p: string) => resolve(ROOT, p);

const PAGE_PATH = path("client/src/pages/FinancialDashboard.tsx");
const GRID_PATH = path("client/src/dashboard/DashboardWidgetGrid.tsx");

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

// ─── 1. Workload sort lives inside visibleTechs derivation ─────────

describe("Today's Schedule — workload-driven tech sort", () => {
  const code = read(PAGE_PATH);
  const codeNoComments = stripComments(code);

  it("the visibleTechs useMemo runs a `.sort(...)` after mapping", () => {
    // The mapped array (per-tech filtering + clamping) is now
    // followed by a sort step — pin both the function name and
    // the slice() that ensures we don't mutate the input array.
    expect(codeNoComments).toMatch(
      /const visibleTechs = useMemo\([\s\S]*?mapped\.slice\(\)\.sort\(/,
    );
  });

  it("primary key: booked-visit count desc (open slots excluded)", () => {
    expect(codeNoComments).toMatch(
      /const aBooked\s*=\s*a\.scheduleBlocks\.filter\(\(x\)\s*=>\s*x\.kind\s*===\s*"booked"\)/,
    );
    expect(codeNoComments).toMatch(
      /const bBooked\s*=\s*b\.scheduleBlocks\.filter\(\(x\)\s*=>\s*x\.kind\s*===\s*"booked"\)/,
    );
    expect(codeNoComments).toMatch(
      /aBooked\.length\s*!==\s*bBooked\.length[\s\S]{0,80}return\s+bBooked\.length\s*-\s*aBooked\.length/,
    );
  });

  it("secondary key: total booked duration (minutes) desc", () => {
    expect(codeNoComments).toMatch(
      /aBooked\.reduce\(\s*\(s,\s*x\)\s*=>\s*s\s*\+\s*\(x\.durationMinutes\s*\?\?\s*0\)/,
    );
    expect(codeNoComments).toMatch(/return\s+bDur\s*-\s*aDur/);
  });

  it("tertiary key: earliest booked start time asc (Number.POSITIVE_INFINITY when no bookings)", () => {
    expect(codeNoComments).toMatch(
      /aBooked\.length\s*>\s*0[\s\S]{0,140}Math\.min\([\s\S]{0,80}Date\.parse\(x\.startISO\)/,
    );
    expect(codeNoComments).toMatch(/Number\.POSITIVE_INFINITY/);
    expect(codeNoComments).toMatch(/return\s+aStart\s*-\s*bStart/);
  });

  it("quaternary key: name asc as a stable tie-breaker", () => {
    expect(codeNoComments).toMatch(
      /return\s+\(a\.name\s*\?\?\s*""\)\.localeCompare\(b\.name\s*\?\?\s*""\)/,
    );
  });
});

// ─── 2. Sort respects the existing scope filter ────────────────────

describe("Today's Schedule — sort respects filters", () => {
  const code = read(PAGE_PATH);
  const codeNoComments = stripComments(code);

  it("activeTechs (the scope-filtered slice) is the input to the sort, not the raw techs", () => {
    // `mapped` is built by mapping `activeTechs`. `activeTechs` is
    // the team-scope-filtered list — so the sort runs ONLY over
    // techs the user has chosen to see.
    expect(codeNoComments).toMatch(
      /const mapped\s*=\s*activeTechs\.map\(/,
    );
  });

  it("activeTechs derivation gates on the existing scope-filter rules", () => {
    // Pin the upstream filter so a future refactor can't quietly
    // bypass scope when computing the sort source.
    expect(codeNoComments).toMatch(/const activeTechs/);
    expect(codeNoComments).toMatch(/scopeIds\.includes\(t\.technicianId\)/);
  });
});

// ─── 3. Open slots do NOT contribute to "busy" ─────────────────────

describe("Today's Schedule — open slots do not count toward workload", () => {
  const code = read(PAGE_PATH);
  const codeNoComments = stripComments(code);

  it('booked filter uses kind === "booked" — open kind is not counted', () => {
    expect(codeNoComments).toMatch(/x\.kind\s*===\s*"booked"/);
    expect(codeNoComments).not.toMatch(/x\.kind\s*===\s*"open"\s*\?\s*1/);
  });
});

// ─── 4. Sort does NOT mutate capacity / capacity math ──────────────

describe("Today's Schedule — sort is display-only", () => {
  const code = read(PAGE_PATH);
  const codeNoComments = stripComments(code);

  it("capacity-side bookedPercent reads from `techs` (not from sorted visibleTechs)", () => {
    // bookedPercent is the team-aggregate capacity calculation. It
    // must read from the upstream slice — sorting the display order
    // must not be able to skew capacity math.
    expect(codeNoComments).toMatch(
      /const bookedPercent\s*=\s*useMemo\([\s\S]*?for \(const t of techs\)/,
    );
  });

  it("the sort uses .slice() before mutating so the input array is preserved", () => {
    expect(codeNoComments).toMatch(/mapped\.slice\(\)\.sort\(/);
  });
});

// ─── 5. Both column + stacked branches consume the sorted list ─────

describe("Today's Schedule — column + stacked both render sorted order", () => {
  const code = read(PAGE_PATH);

  it("the stacked branch maps over visibleTechs (so it inherits the sort)", () => {
    // Stacked branch uses `visibleTechs.map(...)` at the same
    // entry point as column branch — both inherit the workload sort.
    expect(code).toMatch(/data-display-mode="stacked"[\s\S]*?visibleTechs\.map\(/);
  });

  it("the column branches map over activeTechsForRender (the booked-tech partition)", () => {
    // 2026-05-07 RALPH (idle grouping): column-mode dedicated
    // columns iterate `activeTechsForRender` (the workload-sorted
    // active partition); idle techs collapse into a single
    // grouped column rendered alongside, not iterated row-by-row.
    expect(code).toMatch(/activeTechsForRender\.map\(/);
    // The active partition is derived from visibleTechs so the
    // upstream workload sort still applies.
    expect(code).toMatch(/visibleTechs\.filter\(\(t\) =>\s*techActiveSet\.has/);
  });
});

// ─── 6. Dashboard grid spacing tightened to gap-2.5 ────────────────

describe("DashboardWidgetGrid — gap tightened to gap-2.5", () => {
  const code = read(GRID_PATH);

  it("outer grid uses canonical gap-2.5 (was gap-3 — ~17 % tighter)", () => {
    expect(code).toMatch(/grid grid-cols-12 grid-flow-row-dense gap-2\.5/);
  });

  it("does NOT use the previous gap-3 on the outer grid container", () => {
    // The grid container's className template is the only place
    // gap-* applies to the dashboard cells — pin that the gap-3
    // version is gone (other gap-3 occurrences in unrelated files
    // are out of scope).
    expect(code).not.toMatch(/grid grid-cols-12 grid-flow-row-dense gap-3"/);
  });
});
