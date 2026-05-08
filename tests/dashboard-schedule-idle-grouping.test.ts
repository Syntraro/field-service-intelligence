/**
 * Today's Schedule — idle-tech grouping in column mode
 * (2026-05-07 RALPH).
 *
 * Pins the new column-mode behaviour:
 *   • Active techs (≥ 1 booked block) get dedicated columns,
 *     workload-sorted (busiest leftmost) per the prior follow-up.
 *   • Idle techs (no booked blocks) collapse into ONE grouped
 *     "Available" column at the right edge of the column layout.
 *   • The grouped column counts as a single column for the grid
 *     template + the 4-column-grid-vs-horizontal-scroll threshold,
 *     so idle techs never widen the dashboard cell on their own.
 *   • Stacked mode is unchanged — every tech still gets their own
 *     section.
 *   • Capacity math (`bookedPercent`), slot availability, and the
 *     team-scope filter are all upstream of the partition and
 *     remain unaffected.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const path = (p: string) => resolve(ROOT, p);

const PAGE_PATH = path("client/src/pages/FinancialDashboard.tsx");

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

// ─── 1. Active vs idle classification ──────────────────────────────

describe("Today's Schedule — active vs idle classification", () => {
  const code = read(PAGE_PATH);
  const codeNoComments = stripComments(code);

  it("derives techActiveSet from the upstream activeTechs (pre-openOnly)", () => {
    // The active set reads `activeTechs` (scope-filtered, pre
    // open-only-filter) so flipping the openOnly toggle never
    // reclassifies an actively booked tech as idle.
    expect(codeNoComments).toMatch(/const techActiveSet\s*=\s*useMemo/);
    expect(codeNoComments).toMatch(/for \(const t of activeTechs\)/);
  });

  it('uses kind === "booked" as the workload predicate (open slots NOT counted)', () => {
    // Pin the predicate inside the techActiveSet derivation to
    // make sure open slots can never make a tech "active."
    expect(codeNoComments).toMatch(
      /t\.scheduleBlocks\.some\(\(b\)\s*=>\s*b\.kind\s*===\s*"booked"\)/,
    );
  });

  it("partitions the workload-sorted visibleTechs into active + idle slices", () => {
    expect(codeNoComments).toMatch(/const activeTechsForRender\s*=\s*useMemo/);
    expect(codeNoComments).toMatch(/const idleTechsForRender\s*=\s*useMemo/);
    // Active partition keeps visibleTechs order (workload sort).
    expect(codeNoComments).toMatch(
      /visibleTechs\.filter\(\(t\)\s*=>\s*techActiveSet\.has\(t\.technicianId\)\)/,
    );
    // Idle partition is the inverse.
    expect(codeNoComments).toMatch(
      /visibleTechs[\s\S]{0,80}filter\(\(t\)\s*=>\s*!techActiveSet\.has\(t\.technicianId\)\)/,
    );
  });

  it("idle partition is sorted ALPHABETICALLY by name (not by workload)", () => {
    // Within the grouped column, workload is uniformly zero, so
    // the visible order is alphabetical for predictable scanning.
    expect(codeNoComments).toMatch(
      /\.sort\(\(a, b\)\s*=>\s*\(a\.name\s*\?\?\s*""\)\.localeCompare\(b\.name\s*\?\?\s*""\)\)/,
    );
  });
});

// ─── 2. effectiveColumnCount drives grid template + threshold ──────

describe("Today's Schedule — effectiveColumnCount drives layout", () => {
  const code = read(PAGE_PATH);
  const codeNoComments = stripComments(code);

  it("effectiveColumnCount = active techs + (1 if any idle exists, else 0)", () => {
    expect(codeNoComments).toMatch(
      /const effectiveColumnCount\s*=\s*activeTechsForRender\.length\s*\+\s*\(hasIdleGroup\s*\?\s*1\s*:\s*0\)/,
    );
  });

  it("hasIdleGroup is just `idleTechsForRender.length > 0`", () => {
    expect(codeNoComments).toMatch(
      /const hasIdleGroup\s*=\s*idleTechsForRender\.length\s*>\s*0/,
    );
  });

  it("useGrid threshold reads effectiveColumnCount (not raw visibleTechs)", () => {
    expect(codeNoComments).toMatch(
      /const useGrid\s*=\s*!isStacked\s*&&\s*effectiveColumnCount\s*<=\s*4/,
    );
    expect(codeNoComments).not.toMatch(
      /const useGrid\s*=\s*!isStacked\s*&&\s*visibleTechs\.length\s*<=\s*4/,
    );
  });

  it("gridTemplateColumns uses effectiveColumnCount", () => {
    expect(code).toMatch(
      /gridTemplateColumns:\s*`repeat\(\$\{effectiveColumnCount\},\s*minmax\(0,\s*1fr\)\)`/,
    );
  });
});

// ─── 3. Page width-units derives from ACTIVE tech count ────────────

describe("Today's Schedule — page width derives from ACTIVE count", () => {
  const code = read(PAGE_PATH);
  const codeNoComments = stripComments(code);

  it("page computes scheduleActiveTechCount from booked-block presence", () => {
    expect(codeNoComments).toMatch(/const scheduleActiveTechCount\s*=\s*useMemo/);
    // The filter expression may wrap across lines; collapse
    // whitespace before asserting on the body shape.
    const collapsed = codeNoComments.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /scheduleVisibleTechs\.filter\(\(t\) => t\.scheduleBlocks\.some\(\(b\) => b\.kind === "booked"\),?\s*\)\.length/,
    );
  });

  it("todaysScheduleWidthUnits derives from scheduleActiveTechCount", () => {
    expect(codeNoComments).toMatch(
      /todaysScheduleWidthUnits[\s\S]{0,40}scheduleActiveTechCount\s*<=\s*1/,
    );
  });

  it("0 or 1 active → 1 unit; 2-3 active → 2; 4+ active → 3", () => {
    expect(codeNoComments).toMatch(
      /scheduleActiveTechCount\s*<=\s*1[\s\S]{0,30}\?\s*1[\s\S]{0,80}scheduleActiveTechCount\s*<=\s*3[\s\S]{0,30}\?\s*2[\s\S]{0,30}:\s*3/,
    );
  });
});

// ─── 4. Grouped Available column rendering ─────────────────────────

describe("Today's Schedule — grouped Available column", () => {
  const code = read(PAGE_PATH);
  const codeNoComments = stripComments(code);

  it("renders a renderGroupedAvailableColumn helper inside the multi-tech IIFE", () => {
    expect(codeNoComments).toMatch(/const renderGroupedAvailableColumn\s*=/);
  });

  it("the grouped column carries the canonical schedule-available-column test id", () => {
    expect(code).toMatch(/data-testid="schedule-available-column"/);
  });

  it('the grouped column header reads "Available"', () => {
    expect(code).toMatch(/<span className="truncate">Available<\/span>/);
  });

  it("shows the idle-tech count next to the Available header", () => {
    expect(code).toMatch(/idleTechsForRender\.length/);
  });

  it("each idle row carries a stable test id keyed on technicianId", () => {
    expect(code).toMatch(/data-testid=\{?`?schedule-available-row-/);
  });

  it("clicking an idle row routes through handleBlockClick → onOpenSlot when an open block exists", () => {
    // The row's onClick fires `firstOpen && handleBlockClick(tech, firstOpen)`
    // — the same canonical create-from-slot path the per-tech
    // columns use. Off-shift techs with no open block render a
    // disabled, non-interactive row.
    expect(codeNoComments).toMatch(
      /firstOpen\s*&&\s*handleBlockClick\(tech,\s*firstOpen\)/,
    );
    expect(code).toMatch(/disabled=\{!hasClickable\}/);
  });

  it("only renders the grouped column when at least one idle tech exists", () => {
    // Both column branches gate on `hasIdleGroup &&` before
    // appending the grouped column.
    const matches = code.match(/hasIdleGroup\s*&&\s*renderGroupedAvailableColumn/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── 5. Active dedicated columns + last-col border logic ───────────

describe("Today's Schedule — active dedicated columns", () => {
  const code = read(PAGE_PATH);
  const codeNoComments = stripComments(code);

  it("column branches iterate activeTechsForRender (not the raw visibleTechs)", () => {
    // Column branch is now active-only; idle techs never get a
    // dedicated column. Pin both grid + scroll branches.
    const matches = code.match(/activeTechsForRender\.map\(/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    // visibleTechs.map(...) is still used by stacked + single-tech
    // paths but should NOT appear inside the column branches'
    // render expressions.
  });

  it("renderColumn's isLastCol is computed against the rightmost RENDERED column", () => {
    // When a grouped Available column is appended on the right,
    // the last active column is no longer the rightmost — its
    // border-right divider must keep painting.
    expect(codeNoComments).toMatch(
      /!hasIdleGroup\s*&&\s*i\s*===\s*activeColumnsLastIdx/,
    );
  });
});

// ─── 6. Stacked mode is UNCHANGED ──────────────────────────────────

describe("Today's Schedule — stacked mode unchanged", () => {
  const code = read(PAGE_PATH);

  it("stacked branch still iterates visibleTechs (no idle grouping in stacked)", () => {
    // Stacked mode renders every tech as its own vertical section.
    expect(code).toMatch(
      /data-display-mode="stacked"[\s\S]*?visibleTechs\.map\(/,
    );
  });

  it("stacked branch does NOT reference activeTechsForRender / idleTechsForRender / hasIdleGroup", () => {
    // Pin the absence — grouping is column-only, never stacked.
    const stackedSliceMatch = code.match(
      /data-display-mode="stacked"[\s\S]*?<\/div>\s*\)\s*;\s*\}/,
    );
    expect(stackedSliceMatch).not.toBeNull();
    if (stackedSliceMatch) {
      expect(stackedSliceMatch[0]).not.toMatch(/activeTechsForRender/);
      expect(stackedSliceMatch[0]).not.toMatch(/idleTechsForRender/);
      expect(stackedSliceMatch[0]).not.toMatch(/hasIdleGroup/);
    }
  });
});

// ─── 7. Capacity math + slot availability untouched ────────────────

describe("Today's Schedule — capacity math is upstream of grouping", () => {
  const code = read(PAGE_PATH);
  const codeNoComments = stripComments(code);

  it("bookedPercent still iterates `techs` (the raw upstream slice)", () => {
    expect(codeNoComments).toMatch(
      /const bookedPercent\s*=\s*useMemo\([\s\S]*?for \(const t of techs\)/,
    );
  });

  it("activeTechs (the team-scope-filtered upstream slice) is untouched", () => {
    expect(codeNoComments).toMatch(/const activeTechs\s*=\s*useMemo/);
    expect(codeNoComments).toMatch(/scopeIds\.includes\(t\.technicianId\)/);
  });

  it("the grouped-column derivation does not mutate scheduleBlocks", () => {
    // Sort + filter must read-only — pin that we use slice() before
    // sort() and never touch scheduleBlocks directly.
    expect(codeNoComments).toMatch(
      /visibleTechs[\s\S]{0,80}filter\(\(t\)\s*=>\s*!techActiveSet\.has\(t\.technicianId\)\)\s*\.slice\(\)\s*\.sort\(/,
    );
  });
});
