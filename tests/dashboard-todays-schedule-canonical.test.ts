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
