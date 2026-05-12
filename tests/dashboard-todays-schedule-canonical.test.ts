/**
 * dashboard-todays-schedule-canonical.test.ts
 *
 * Phase 2D canonicalization guard tests for TodaysScheduleCard
 * in `client/src/pages/FinancialDashboard.tsx`.
 *
 * Scope: shell and header chrome only — schedule internals (rows, columns,
 * filters, popovers, capacity indicators) are NOT touched by Phase 2D and
 * intentionally still contain raw color/typography tokens. Assertions that
 * check for absence of raw classes MUST be narrowed to the header region
 * only, not the entire TodaysScheduleCard function slice.
 *
 * Pins:
 *  1.  Uses CardShell (not local DashCard)
 *  2.  DashCard function deleted from the file
 *  3.  Stacked header uses border-card-border (not hex border)
 *  4.  Default header uses border-card-border (not hex border)
 *  5.  Stacked header region has no hex border
 *  6.  Default header region has no hex border
 *  7.  Stacked header title uses text-foreground (not hex text)
 *  8.  Default header title uses text-foreground (not hex text)
 *  9.  EmptyState helper still present (used inside TodaysScheduleCard)
 * 10.  Schedule internals preserved: data-testid="todays-schedule-header" present
 * 11.  Schedule internals preserved: data-header-variant stacked + default
 * 12.  CalendarIcon still present in the schedule header
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT    = resolve(__dirname, "..");
const dashSrc = readFileSync(resolve(ROOT, "client/src/pages/FinancialDashboard.tsx"), "utf-8");

// Slice the TodaysScheduleCard region only.
const schedStart = dashSrc.indexOf("function TodaysScheduleCard(");
const SCHED_SRC  = dashSrc.slice(schedStart);

// ── Header-only windows ──────────────────────────────────────────────────────
//
// The two header divs use data-header-variant as a unique landmark.
// In JSX, the className attribute (which carries border-card-border) appears
// BEFORE the data-header-variant attribute on the same div. The h3 title
// appears ~300–500 chars AFTER the data-header-variant.
//
// Window strategy: 250 chars before the attribute (captures className) +
// 700 chars after (captures the h3 + its text) = a ~950-char header-only
// region that does not reach the schedule internals below.

const stackedVariantIdx = SCHED_SRC.indexOf('data-header-variant="stacked"');
const defaultVariantIdx = SCHED_SRC.indexOf('data-header-variant="default"');

const STACKED_HEADER = SCHED_SRC.slice(
  Math.max(0, stackedVariantIdx - 250),
  stackedVariantIdx + 700,
);
const DEFAULT_HEADER = SCHED_SRC.slice(
  Math.max(0, defaultVariantIdx - 250),
  defaultVariantIdx + 700,
);

// ── 1. CardShell replaces DashCard ──────────────────────────────────────────

describe("TodaysScheduleCard — uses CardShell (Phase 2D)", () => {
  it("renders CardShell as the root element", () => {
    expect(SCHED_SRC).toContain("<CardShell");
  });

  it("does not use the local DashCard helper", () => {
    expect(SCHED_SRC).not.toContain("<DashCard");
  });
});

// ── 2. DashCard function deleted ────────────────────────────────────────────

describe("DashCard — deleted from file (Phase 2D)", () => {
  it("function DashCard definition is gone", () => {
    expect(dashSrc).not.toContain("function DashCard(");
  });

  it("no <DashCard usage anywhere in the file", () => {
    expect(dashSrc).not.toContain("<DashCard");
  });
});

// ── 3 & 4. Header borders use semantic token ─────────────────────────────────
//
// In the JSX, className (containing border-card-border) comes before the
// data-header-variant attribute on the same <div>. Use header-only windows
// rather than forward-from-attribute patterns.

describe("TodaysScheduleCard — header borders use border-card-border", () => {
  it("stacked header uses border-card-border", () => {
    // className="...border-card-border..." sits ~100 chars before
    // data-header-variant="stacked" on the same div opening tag.
    expect(STACKED_HEADER).toContain("border-card-border");
  });

  it("default header uses border-card-border", () => {
    expect(DEFAULT_HEADER).toContain("border-card-border");
  });

  it("stacked header region has no hex border (border-[#e2e8f0])", () => {
    // Narrow to header window only — schedule internals below this
    // region intentionally still use border-[#e2e8f0] and are out of scope.
    expect(STACKED_HEADER).not.toContain("border-[#e2e8f0]");
  });

  it("default header region has no hex border (border-[#e2e8f0])", () => {
    expect(DEFAULT_HEADER).not.toContain("border-[#e2e8f0]");
  });

  it("no dark:border-gray-600 override remains in header regions", () => {
    expect(STACKED_HEADER).not.toContain("dark:border-gray-600");
    expect(DEFAULT_HEADER).not.toContain("dark:border-gray-600");
  });
});

// ── 5 & 6. Header titles use semantic token ──────────────────────────────────

describe("TodaysScheduleCard — header titles use text-foreground", () => {
  it("stacked header title uses text-foreground", () => {
    expect(STACKED_HEADER).toContain("text-foreground");
  });

  it("default header title uses text-foreground", () => {
    expect(DEFAULT_HEADER).toContain("text-foreground");
  });

  it("stacked header region has no hex text color (text-[#111827])", () => {
    // Narrow to header window only — schedule internals intentionally preserved.
    expect(STACKED_HEADER).not.toContain("text-[#111827]");
  });

  it("default header region has no hex text color (text-[#111827])", () => {
    expect(DEFAULT_HEADER).not.toContain("text-[#111827]");
  });

  it("no dark:text-gray-100 override in header regions", () => {
    expect(STACKED_HEADER).not.toContain("dark:text-gray-100");
    expect(DEFAULT_HEADER).not.toContain("dark:text-gray-100");
  });
});

// ── 7. EmptyState helper still present ──────────────────────────────────────

describe("EmptyState — still present for TodaysScheduleCard", () => {
  it("function EmptyState still exists in the file", () => {
    expect(dashSrc).toContain("function EmptyState(");
  });

  it("TodaysScheduleCard still uses EmptyState", () => {
    expect(SCHED_SRC).toContain("EmptyState");
  });
});

// ── 8 & 9. Schedule internals preserved ─────────────────────────────────────

describe("TodaysScheduleCard — schedule internals preserved", () => {
  it("todays-schedule-header testid preserved", () => {
    expect(SCHED_SRC).toContain('data-testid="todays-schedule-header"');
  });

  it("stacked header variant preserved", () => {
    expect(SCHED_SRC).toContain('data-header-variant="stacked"');
  });

  it("default header variant preserved", () => {
    expect(SCHED_SRC).toContain('data-header-variant="default"');
  });
});

// ── 10. CalendarIcon preserved ───────────────────────────────────────────────

describe("TodaysScheduleCard — CalendarIcon in header preserved", () => {
  it("CalendarIcon still rendered in TodaysScheduleCard", () => {
    expect(SCHED_SRC).toContain("CalendarIcon");
  });
});

// ── 11. Available column: no numeric counter ─────────────────────────────────
//
// The Available column previously showed {idleTechsForRender.length} as a
// right-aligned badge. That counter must be absent — the names themselves
// communicate availability.

describe("TodaysScheduleCard — Available column has no numeric counter", () => {
  it("does not render idleTechsForRender.length as a visible counter", () => {
    expect(SCHED_SRC).not.toContain("{idleTechsForRender.length}");
  });

  it("Available column header does not use justify-between layout (counter removed)", () => {
    const availableColSrc = SCHED_SRC.slice(
      SCHED_SRC.indexOf('data-testid="schedule-available-column"'),
    ).slice(0, 500);
    expect(availableColSrc).not.toContain("justify-between");
  });
});

// ── 12. No "Other scheduled visits" heading ──────────────────────────────────

describe("TodaysScheduleCard — Other scheduled visits section removed", () => {
  it('does not contain "Other scheduled visits" text', () => {
    expect(SCHED_SRC).not.toContain("Other scheduled visits");
  });

  it('does not render data-testid="other-scheduled-visits"', () => {
    expect(SCHED_SRC).not.toContain('data-testid="other-scheduled-visits"');
  });
});

// ── 13. Task blocks use indigo palette (not blue) ────────────────────────────

// Slice anchors for the two render paths that show task blocks.
// Slices are large enough to capture all color ternaries in JSX,
// which sit 3500–6500 chars after the map() landmark due to comments.
const singleTechIdx  = SCHED_SRC.indexOf("visibleTechs[0].scheduleBlocks.map");
const singleTechSrc  = SCHED_SRC.slice(singleTechIdx, singleTechIdx + 6000);
const multiColIdx    = SCHED_SRC.indexOf("tech.scheduleBlocks.map((block, bIdx");
const multiColSrc    = SCHED_SRC.slice(multiColIdx, multiColIdx + 8000);
const unassignedIdx  = SCHED_SRC.indexOf('data-testid="schedule-unassigned-column"');
const unassignedSrc  = SCHED_SRC.slice(unassignedIdx, unassignedIdx + 4000);

describe("TodaysScheduleCard — task blocks use indigo palette (Phase 3)", () => {
  it("single-tech view: no blue-* task class remains", () => {
    // Only fails if a text-blue-* or bg-blue-* appears in this region.
    expect(singleTechSrc).not.toMatch(/text-blue-[0-9]/);
    expect(singleTechSrc).not.toMatch(/bg-blue-[0-9]/);
  });

  it("single-tech view: task background uses bg-indigo-50/60", () => {
    expect(singleTechSrc).toContain("bg-indigo-50/60");
  });

  it("single-tech view: task text uses text-indigo-800", () => {
    expect(singleTechSrc).toContain("text-indigo-800");
  });

  it("single-tech view: task bullet uses text-indigo-400", () => {
    expect(singleTechSrc).toContain("text-indigo-400");
  });

  it("multi-column view: no blue-* task class remains", () => {
    expect(multiColSrc).not.toMatch(/text-blue-[0-9]/);
    expect(multiColSrc).not.toMatch(/bg-blue-[0-9]/);
  });

  it("multi-column view: task background uses bg-indigo-50/60", () => {
    expect(multiColSrc).toContain("bg-indigo-50/60");
  });

  it("multi-column view: task text uses text-indigo-800", () => {
    expect(multiColSrc).toContain("text-indigo-800");
  });

  it("unassigned column: no blue-* task class remains", () => {
    expect(unassignedSrc).not.toMatch(/text-blue-[0-9]/);
    expect(unassignedSrc).not.toMatch(/bg-blue-[0-9]/);
  });

  it("unassigned column: task background uses bg-indigo-50/60", () => {
    expect(unassignedSrc).toContain("bg-indigo-50/60");
  });
});

// ── 14. time_off bullet uses amber-400 (not slate) ───────────────────────────

describe("TodaysScheduleCard — time_off bullet uses amber-400", () => {
  it("single-tech view: time_off bullet uses text-amber-400", () => {
    expect(singleTechSrc).toContain("text-amber-400");
  });

  it("multi-column view: time_off bullet uses text-amber-400", () => {
    expect(multiColSrc).toContain("text-amber-400");
  });

  it("single-tech view: time_off duration uses text-amber-600", () => {
    expect(singleTechSrc).toContain("text-amber-600");
  });

  it("multi-column view: time_off duration uses text-amber-600", () => {
    expect(multiColSrc).toContain("text-amber-600");
  });
});

// ── 15. No ChevronRight on non-interactive rows (single-tech view) ────────────

describe("TodaysScheduleCard — ChevronRight absent from task and time_off rows", () => {
  it("single-tech view: ChevronRight is guarded by !isTask && !isTimeOff", () => {
    expect(singleTechSrc).toContain("!isTask && !isTimeOff");
  });

  it("single-tech view: ChevronRight not rendered unconditionally", () => {
    // The guard must wrap the ChevronRight — it should not appear outside the guard.
    // We detect the guard by checking it precedes ChevronRight in this region.
    const guardIdx = singleTechSrc.indexOf("!isTask && !isTimeOff");
    const chevronIdx = singleTechSrc.indexOf("ChevronRight");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(chevronIdx).toBeGreaterThan(guardIdx);
  });
});

// ── 16. Unassigned column task rows show "(task)" suffix ─────────────────────

describe("TodaysScheduleCard — unassigned task rows labeled with (task)", () => {
  it('unassigned task nameLabel appends " (task)" suffix', () => {
    expect(unassignedSrc).toContain("(task)");
  });

  it("unassigned column still renders schedule-unassigned-task- testids", () => {
    expect(unassignedSrc).toContain("schedule-unassigned-task-");
  });
});

// ── 17. Unassigned column rendered in the same structure as tech rows ─────────

describe("TodaysScheduleCard — Unassigned column structure", () => {
  it('renders data-testid="schedule-unassigned-column"', () => {
    expect(SCHED_SRC).toContain('data-testid="schedule-unassigned-column"');
  });

  it('renders data-testid="schedule-unassigned-label" for the italic label', () => {
    expect(SCHED_SRC).toContain('data-testid="schedule-unassigned-label"');
  });

  it("Unassigned label uses italic styling", () => {
    // className="italic ..." sits before data-testid on the same element —
    // capture 300 chars before the testid attribute to include the className.
    const idx = SCHED_SRC.indexOf('data-testid="schedule-unassigned-label"');
    const labelSrc = SCHED_SRC.slice(Math.max(0, idx - 300), idx + 100);
    expect(labelSrc).toContain("italic");
  });

  it('renders schedule-unassigned-row-${row.visitId} testids for individual rows', () => {
    expect(SCHED_SRC).toContain("schedule-unassigned-row-");
  });

  it("unassigned rows use the same 3-column grid as technician blocks", () => {
    const colSrc = SCHED_SRC.slice(
      SCHED_SRC.indexOf('data-testid="schedule-unassigned-column"'),
    ).slice(0, 3000);
    expect(colSrc).toContain("96px minmax(0, 1fr) auto");
  });

  it("unassigned rows render the visit title (nameLabel)", () => {
    const colSrc = SCHED_SRC.slice(
      SCHED_SRC.indexOf('data-testid="schedule-unassigned-column"'),
    ).slice(0, 1500);
    expect(colSrc).toContain("nameLabel");
  });

  it("unassigned rows render formatTimeRange for time display", () => {
    const colSrc = SCHED_SRC.slice(
      SCHED_SRC.indexOf('data-testid="schedule-unassigned-column"'),
    ).slice(0, 1500);
    expect(colSrc).toContain("formatTimeRange");
  });

  it("Unassigned column appears in both stacked and column modes", () => {
    // hasUnassigned drives both branches — assert the guard appears twice
    // (once in stacked mode, once in column mode).
    const matches = SCHED_SRC.split("renderUnassignedColumn").length - 1;
    // definition (1) + stacked call (1) + grid call (1) + scroll call (1) = ≥ 4
    expect(matches).toBeGreaterThanOrEqual(4);
  });
});
