/**
 * Today's Schedule height consistency + display-mode toggle —
 * regression guard (2026-05-07 RALPH).
 *
 * Pins:
 *   • Grid cell wrapper has `overflow-hidden` so the cell never
 *     visually exceeds its declared `h-[300px]` regardless of
 *     inner content. This is the height-consistency guard — Today
 *     stays the same height at 1, 2, 3, 4, and 5+ techs because the
 *     CELL clamps the chrome inside it.
 *   • Page exposes a `column` ↔ `stacked` display mode for the
 *     schedule card with a header dropdown.
 *   • Stacked mode forces `flex flex-col` regardless of breakpoint.
 *   • Column mode keeps the existing `flex flex-col xl:grid` /
 *     `overflow-x-auto` behaviour for ≤4 / ≥5 techs respectively.
 *   • Display mode is hidden in compact (1-tech) mode — column is
 *     the only sensible layout when there's one tech.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const path = (p: string) => resolve(ROOT, p);

const GRID_PATH = path("client/src/dashboard/DashboardWidgetGrid.tsx");
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

// ─── 1. Grid cell wrapper clamps to declared height ────────────────

describe("DashboardWidgetGrid — cell height clamp", () => {
  const code = read(GRID_PATH);

  it("the grid cell wrapper carries overflow-hidden", () => {
    // The cell's className must include `overflow-hidden` alongside
    // the span + height + row-span classes — without it, content
    // with intrinsic min-height greater than 300px can visibly
    // overflow the declared cell height and stretch the row track
    // in some grid configurations.
    expect(code).toMatch(/overflow-hidden`/);
  });

  it("the grid container uses grid-flow-row-dense so smaller cards backfill around row-span-2 widgets", () => {
    expect(code).toMatch(/grid-cols-12 grid-flow-row-dense/);
  });

  it("HEIGHT_CLASSES.summary is the canonical h-[300px]", () => {
    expect(code).toMatch(/summary:\s*"h-\[300px\]"/);
  });

  it("does not introduce a per-tech-count height override", () => {
    expect(code).not.toMatch(/visibleTechCount/);
    expect(code).not.toMatch(/scheduleVisibleTechCount/);
  });
});

// ─── 2. Display-mode state + dropdown ──────────────────────────────

describe("Today's Schedule — display-mode state + toggle button", () => {
  const code = read(PAGE_PATH);

  it("page declares scheduleDisplayMode state at the page level (lifted)", () => {
    expect(code).toMatch(
      /useState<\s*"column"\s*\|\s*"stacked"\s*>\("column"\)/,
    );
    expect(code).toMatch(/scheduleDisplayMode/);
    expect(code).toMatch(/setScheduleDisplayMode/);
  });

  it("display mode is threaded into the schedule card as a controlled prop", () => {
    expect(code).toMatch(/displayMode=\{scheduleDisplayMode\}/);
    expect(code).toMatch(/onDisplayModeChange=\{setScheduleDisplayMode\}/);
  });

  it("renders a single toggle button (no dropdown / Popover) with the canonical test id", () => {
    // Toggle replaces the prior Popover/dropdown — pin the new shape.
    expect(code).toMatch(/data-testid="schedule-display-mode-toggle"/);
    expect(code).not.toMatch(/data-testid="schedule-display-mode"/);
    expect(code).not.toMatch(/data-testid="schedule-display-mode-column"/);
    expect(code).not.toMatch(/data-testid="schedule-display-mode-stacked"/);
  });

  it("clicking the toggle flips column ↔ stacked", () => {
    // Inline arrow on onClick: when current is column → next is stacked, else column.
    expect(code).toMatch(
      /onClick=\{[\s\S]*?onDisplayModeChange\(\s*scheduleDisplayMode === "column"\s*\?\s*"stacked"\s*:\s*"column"/,
    );
  });

  it("toggle stamps the current mode on data-display-mode for assertion", () => {
    expect(code).toMatch(/data-display-mode=\{scheduleDisplayMode\}/);
  });

  it("the toggle visibility is gated on isStackedMode || isMultiTech (regression-fix formula)", () => {
    // 2026-05-07 RALPH (regression fix): the visibility formula is
    // now `showDisplayModeToggle = isStackedMode || isMultiTech`.
    // The previous formula was `isStackedMode || !compact`, which
    // hid the toggle whenever the grid reduced widthUnits to 1 —
    // that happens whenever zero techs are currently active (after
    // idle-grouping + ACTIVE-driven width derivation), leaving the
    // user stuck in stacked mode with no way back to column mode.
    // The new formula keeps the toggle visible whenever the company
    // has ≥ 2 schedulable techs OR the user is already in stacked
    // mode (so they can always switch back). Solo-tech users in
    // column mode still get the toggle hidden — the original intent.
    const codeNoComments = stripComments(code);
    expect(codeNoComments).toMatch(
      /showDisplayModeToggle\s*=\s*isStackedMode\s*\|\|\s*isMultiTech/,
    );
    expect(codeNoComments).toMatch(
      /displayModeToggleControl\s*=\s*showDisplayModeToggle\s*\?/,
    );
  });
});

// ─── 3. Stacked branch — vertical sections at every breakpoint ─────

describe("Today's Schedule — stacked branch", () => {
  const code = read(PAGE_PATH);
  const codeNoComments = stripComments(code);

  it("stacked mode renders <div data-display-mode='stacked'>", () => {
    expect(code).toMatch(
      /data-testid="schedule-multi-column-view"[\s\S]*?data-display-mode="stacked"/,
    );
  });

  it("stacked branch uses flex flex-col (not xl:grid, not overflow-x-auto)", () => {
    // The stacked branch is the FIRST conditional return inside the
    // multi-tech IIFE, before the column-mode useGrid branches.
    const stackedRegex = /if\s*\(isStacked\)\s*\{\s*return\s*\(\s*<div\s+className="flex flex-col flex-1"/;
    expect(codeNoComments).toMatch(stackedRegex);
  });

  it("column branch is gated on !isStacked + effectiveColumnCount <= 4", () => {
    // 2026-05-07 RALPH (idle-grouping update): useGrid is now gated
    // on `effectiveColumnCount` (active-tech count + 1 if any idle
    // techs exist) rather than the raw `visibleTechs.length`. The
    // threshold of 4 columns is unchanged — only the column-count
    // source changed when idle grouping landed.
    expect(codeNoComments).toMatch(
      /const useGrid\s*=\s*!isStacked\s*&&\s*effectiveColumnCount\s*<=\s*4/,
    );
  });

  it("column-mode wrappers carry data-display-mode='column' for assertion", () => {
    // Both column branches (≤4 grid + ≥5 horizontal scroll) emit
    // the column attribute so tests + DevTools can read the choice.
    const matches = code.match(/data-display-mode="column"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── 3b. Stacked-mode width + row-span heuristic ───────────────────

describe("Today's Schedule — stacked mode shrinks width + conditionally row-spans", () => {
  const code = read(PAGE_PATH);
  const codeNoComments = stripComments(code);

  it("stacked mode forces the schedule cell to 1 column wide regardless of tech count", () => {
    expect(codeNoComments).toMatch(
      /scheduleDisplayMode === "stacked"\s*\?\s*1\s*:\s*todaysScheduleWidthUnits/,
    );
  });

  it("column mode preserves the existing 1/2/3 tech-count → width-units mapping", () => {
    // Defensive — pin both scheduleVisibleTechCount usage AND the
    // todaysScheduleWidthUnits derived value, so a future refactor
    // can't drop the column-mode width logic.
    expect(codeNoComments).toMatch(/scheduleVisibleTechCount/);
    expect(codeNoComments).toMatch(/todaysScheduleWidthUnits/);
  });

  it("page exposes a row-span override map keyed by widget", () => {
    expect(codeNoComments).toMatch(/widgetRowSpanOverrides/);
    expect(codeNoComments).toMatch(/todays_schedule:\s*scheduleStackedNeedsDoubleHeight\s*\?\s*2\s*:\s*1/);
  });

  it("row-span flips to 2 only when stacked AND content rows exceed the threshold", () => {
    expect(codeNoComments).toMatch(
      /scheduleDisplayMode === "stacked"\s*&&\s*scheduleStackedContentRows\s*>\s*6/,
    );
  });

  it("the page passes rowSpanOverrides to <DashboardWidgetGrid>", () => {
    expect(code).toMatch(/rowSpanOverrides=\{widgetRowSpanOverrides\}/);
  });

  it("schedule visible techs are filtered at the page level (same logic as the card)", () => {
    // Lifted so the row-overflow heuristic can read the SAME
    // post-scope-filter tech list the card renders.
    expect(codeNoComments).toMatch(/scheduleVisibleTechs/);
    expect(codeNoComments).toMatch(/scheduleScopeIds\.includes/);
  });
});

// ─── 4. Stacked view does NOT increase card height ─────────────────

describe("Today's Schedule — height invariants", () => {
  const code = read(PAGE_PATH);
  const codeNoComments = stripComments(code);

  it("schedule body wrapper still has the canonical scroll classes", () => {
    expect(code).toMatch(
      /flex-1 flex flex-col min-h-0 overflow-y-auto/,
    );
    expect(code).toMatch(/data-testid="schedule-body-scroll"/);
  });

  it("the page does NOT compute or pass a height override for any widget", () => {
    expect(codeNoComments).not.toMatch(/widgetHeightOverrides/);
    expect(codeNoComments).not.toMatch(/todaysScheduleHeightPreset/);
    expect(codeNoComments).not.toMatch(/heightOverrides=\{/);
  });

  it("Today's Schedule width override still keys on visible tech count", () => {
    // Width is the ONLY tech-count-driven value the page passes.
    expect(codeNoComments).toMatch(/todaysScheduleWidthUnits/);
    expect(codeNoComments).toMatch(/widthOverrides=\{widgetWidthOverrides\}/);
  });
});

// ─── 4b. Stacked-mode header polish ────────────────────────────────

describe("Today's Schedule — stacked-mode header layout", () => {
  const code = read(PAGE_PATH);
  const codeNoComments = stripComments(code);

  it("the schedule card renders two header variants (data-header-variant)", () => {
    expect(code).toMatch(/data-header-variant="stacked"/);
    expect(code).toMatch(/data-header-variant="default"/);
  });

  it("stacked-mode title is 'Schedule' (not 'Today')", () => {
    // Pin the literal inside the stacked branch only.
    const stackedSlice = code.split('data-header-variant="stacked"')[1] ?? "";
    const before = stackedSlice.split('data-header-variant="default"')[0] ?? stackedSlice;
    expect(before).toMatch(/<h3[^>]*>\s*Schedule\s*</);
  });

  it("default header still shows 'Today' (not 'Schedule')", () => {
    const defaultSlice = code.split('data-header-variant="default"')[1] ?? "";
    expect(defaultSlice).toMatch(/<h3[^>]*>\s*Today/);
  });

  it("stacked header does NOT render the scope-suffix or booked-% chip", () => {
    const stackedSlice = code.split('data-header-variant="stacked"')[1] ?? "";
    const before = stackedSlice.split('data-header-variant="default"')[0] ?? stackedSlice;
    expect(before).not.toMatch(/scopeHeaderSuffix/);
    expect(before).not.toMatch(/capacity-indicator-booked/);
    expect(before).not.toMatch(/Unscheduled/);
  });

  it("stacked header puts controls in a SECOND row (flex flex-col gap-2)", () => {
    // The stacked branch's outer header div uses `flex flex-col gap-2`
    // — the flex direction flips from `row` to `col` so the controls
    // wrap onto a separate row below the title.
    expect(codeNoComments).toMatch(
      /className="px-4 py-2 border-b[^"]*flex flex-col gap-2"[\s\S]*?data-header-variant="stacked"/,
    );
  });

  it("display-mode toggle is visible in stacked mode (so the user can switch back)", () => {
    // 2026-05-07 RALPH: formula is `isStackedMode || isMultiTech`.
    // The stacked branch is one of the two truthy disjuncts, so
    // stacked mode always shows the toggle regardless of compact.
    expect(codeNoComments).toMatch(
      /showDisplayModeToggle\s*=\s*isStackedMode\s*\|\|\s*isMultiTech/,
    );
  });

  it("stacked-mode toggle uses the icon-only shape (h-8 w-8 + LayoutGrid icon)", () => {
    expect(code).toMatch(/h-8 w-8 rounded-md border/);
    expect(code).toMatch(/<LayoutGrid className="h-3\.5 w-3\.5"/);
  });

  it("team filter trigger collapses to a short 'Team' label in stacked mode", () => {
    expect(codeNoComments).toMatch(
      /isStackedMode\s*\?\s*"Team"\s*:\s*scopeLabel/,
    );
  });

  it("Open + Team controls and the toggle are extracted into reusable JSX consts", () => {
    // Both layouts (stacked + default) reference the same control
    // consts so we don't duplicate JSX.
    expect(codeNoComments).toMatch(/openOnlyToggleControl/);
    expect(codeNoComments).toMatch(/teamFilterControl/);
    expect(codeNoComments).toMatch(/displayModeToggleControl/);
  });
});

// ─── 5. Open-slot click flow preserved in both modes ───────────────

describe("Today's Schedule — open-slot click handler still wires onOpenSlot", () => {
  const code = read(PAGE_PATH);

  it("handleBlockClick still routes open-slot kinds through onOpenSlot", () => {
    expect(code).toMatch(/handleBlockClick/);
    expect(code).toMatch(/onOpenSlot\(/);
  });

  it("the per-row buttons carry their canonical schedule-block test ids", () => {
    expect(code).toMatch(/data-testid=\{?`?schedule-block-/);
  });
});

// ─── 6. Width contract — 4 techs full-width, 5+ horizontal scroll ──

describe("Today's Schedule — width contract for 1/2/3/4/5+ techs", () => {
  const code = read(PAGE_PATH);
  const codeNoComments = stripComments(code);

  it("4 techs still fits within the existing useGrid threshold (<= 4)", () => {
    // 2026-05-07 RALPH (idle-grouping update): the upper bound
    // moved from `visibleTechs.length` to `effectiveColumnCount`
    // when idle grouping landed. The threshold of 4 is preserved —
    // a future refactor must not silently reduce 4-column support
    // to 3.
    expect(codeNoComments).toMatch(
      /effectiveColumnCount\s*<=\s*4/,
    );
  });

  it("5+ techs path uses overflow-x-auto + 220px column width", () => {
    expect(codeNoComments).toMatch(/overflow-x-auto/);
    expect(codeNoComments).toMatch(/flex-none w-\[220px\]/);
  });

  it("page width-units mapping clamps to 1 / 2 / 3 — never grows beyond 3 for many techs", () => {
    expect(codeNoComments).toMatch(/todaysScheduleWidthUnits:\s*1\s*\|\s*2\s*\|\s*3/);
  });
});
