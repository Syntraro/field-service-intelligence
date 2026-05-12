/**
 * Today's Schedule — workload-driven technician ordering
 * (2026-05-07 RALPH; updated 2026-05-12 RALPH).
 *
 * The schedule card sorts visible technicians by a 4-tier rule:
 *   1. Booked-visit count desc (tasks and open slots NOT counted).
 *      Task-only techs rank below techs with at least one visit.
 *   2. Total booked+task duration desc — tasks are secondary weight.
 *   3. Earliest booked/task start time asc.
 *   4. Display name asc (stable tie-breaker).
 *
 * The sort is DISPLAY-ORDER ONLY — capacity blocks and slot
 * availability all read from the upstream `techs` / `activeTechs`
 * slice and are unaffected.
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
    expect(codeNoComments).toMatch(
      /const visibleTechs = useMemo\([\s\S]*?mapped\.slice\(\)\.sort\(/,
    );
  });

  it("primary key: booked-visit count desc (tasks and open slots excluded)", () => {
    // aBooked/bBooked filter visits ONLY — tasks excluded from the primary key
    // so task-only techs can't outrank techs with customer visits.
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

  it("secondary key: total booked+task duration (minutes) desc — tasks as secondary weight", () => {
    // aWork/bWork includes tasks for the duration tiebreaker so task hours
    // contribute as secondary weight when visit counts are equal.
    expect(codeNoComments).toMatch(
      /const aWork\s*=\s*a\.scheduleBlocks\.filter\(\(x\)\s*=>\s*x\.kind\s*===\s*"booked"\s*\|\|\s*x\.kind\s*===\s*"task"\)/,
    );
    expect(codeNoComments).toMatch(
      /aWork\.reduce\(\s*\(s,\s*x\)\s*=>\s*s\s*\+\s*\(x\.durationMinutes\s*\?\?\s*0\)/,
    );
    expect(codeNoComments).toMatch(/return\s+bDur\s*-\s*aDur/);
  });

  it("tertiary key: earliest work start time asc (Number.POSITIVE_INFINITY when empty)", () => {
    expect(codeNoComments).toMatch(
      /aWork\.length\s*>\s*0[\s\S]{0,140}Math\.min\([\s\S]{0,80}Date\.parse\(x\.startISO\)/,
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

// ─── 2. Task-only techs rank below visit techs ──────────────────────

describe("Today's Schedule — task-only techs sort after visit techs", () => {
  const code = read(PAGE_PATH);
  const codeNoComments = stripComments(code);

  it("primary sort key filters for booked (not booked||task)", () => {
    // Ensure the primary key does NOT include tasks — otherwise a tech
    // with 3 tasks and 0 visits could outrank a tech with 1 visit.
    const primaryFilterMatch = codeNoComments.match(
      /const aBooked\s*=\s*a\.scheduleBlocks\.filter\(\(x\)\s*=>([\s\S]{0,80}?)\)/,
    );
    expect(primaryFilterMatch).not.toBeNull();
    const filterBody = primaryFilterMatch![1];
    expect(filterBody).not.toContain('"task"');
    expect(filterBody).toContain('"booked"');
  });

  it("task blocks ARE included in the secondary (duration) key via aWork", () => {
    // Tasks contribute weight only — they break visit-count ties but
    // cannot override the primary visit-count ordering.
    expect(codeNoComments).toMatch(
      /const aWork\s*=[\s\S]{0,120}"task"/,
    );
  });
});

// ─── 3. Sort respects the existing scope filter ────────────────────

describe("Today's Schedule — sort respects filters", () => {
  const code = read(PAGE_PATH);
  const codeNoComments = stripComments(code);

  it("activeTechs (the scope-filtered slice) is the input to the sort, not the raw techs", () => {
    expect(codeNoComments).toMatch(
      /const mapped\s*=\s*activeTechs\.map\(/,
    );
  });

  it("activeTechs derivation gates on the existing scope-filter rules", () => {
    expect(codeNoComments).toMatch(/const activeTechs/);
    expect(codeNoComments).toMatch(/scopeIds\.includes\(t\.technicianId\)/);
  });
});

// ─── 4. Open slots do NOT contribute to "busy" ─────────────────────

describe("Today's Schedule — open slots do not count toward workload", () => {
  const code = read(PAGE_PATH);
  const codeNoComments = stripComments(code);

  it('primary booked filter uses kind === "booked" — open kind is not counted', () => {
    expect(codeNoComments).toMatch(/x\.kind\s*===\s*"booked"/);
    expect(codeNoComments).not.toMatch(/x\.kind\s*===\s*"open"\s*\?\s*1/);
  });
});

// ─── 5. Sort does NOT mutate capacity data ─────────────────────────

describe("Today's Schedule — sort is display-only", () => {
  const code = read(PAGE_PATH);
  const codeNoComments = stripComments(code);

  it("bookedPercent computation is removed (no longer rendered)", () => {
    // bookedPercent was removed in 2026-05-12 semantic cleanup — it
    // was misleading once tasks were included as booked minutes.
    expect(codeNoComments).not.toMatch(/const bookedPercent\s*=/);
  });

  it("the sort uses .slice() before mutating so the input array is preserved", () => {
    expect(codeNoComments).toMatch(/mapped\.slice\(\)\.sort\(/);
  });
});

// ─── 6. Both column + stacked branches consume the sorted list ─────

describe("Today's Schedule — column + stacked both render sorted order", () => {
  const code = read(PAGE_PATH);

  it("the stacked branch maps over visibleTechs (so it inherits the sort)", () => {
    expect(code).toMatch(/data-display-mode="stacked"[\s\S]*?visibleTechs\.map\(/);
  });

  it("the column branches map over activeTechsForRender (the booked-tech partition)", () => {
    expect(code).toMatch(/activeTechsForRender\.map\(/);
    expect(code).toMatch(/visibleTechs\.filter\(\(t\) =>\s*techActiveSet\.has/);
  });
});

// ─── 7. Dashboard grid spacing tightened to gap-2.5 ────────────────

describe("DashboardWidgetGrid — gap tightened to gap-2.5", () => {
  const code = read(GRID_PATH);

  it("outer grid uses canonical gap-2.5 (was gap-3 — ~17 % tighter)", () => {
    expect(code).toMatch(/grid grid-cols-12 grid-flow-row-dense gap-2\.5/);
  });

  it("does NOT use the previous gap-3 on the outer grid container", () => {
    expect(code).not.toMatch(/grid grid-cols-12 grid-flow-row-dense gap-3"/);
  });
});
