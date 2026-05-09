/**
 * Dashboard header cleanup — source-pin contract tests (2026-05-08).
 *
 * Locks the contract that:
 *   1. Collections card header has no "View all" link.
 *   2. Scheduled Revenue card header has no "View all" link.
 *   3. Operational Alerts card header has no minimize/collapse button.
 *      The card is always expanded.
 *   4. Today card header replaces the text "Column" button with a
 *      compact icon-only button (aria-label + title = "Column display").
 *   5. Dashboard drag handle is preserved (not removed with the other
 *      header controls).
 *   6. DashboardCustomizeDrawer reorder/customization wiring is untouched.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const p = (rel: string) => resolve(ROOT, rel);

const dashSrc = readFileSync(p("client/src/pages/FinancialDashboard.tsx"), "utf-8");
const alertsSrc = readFileSync(p("client/src/components/dashboard/OperationalAlertsCard.tsx"), "utf-8");
const gridSrc = readFileSync(p("client/src/dashboard/DashboardWidgetGrid.tsx"), "utf-8");
const drawerSrc = readFileSync(p("client/src/dashboard/DashboardCustomizeDrawer.tsx"), "utf-8");

// ─── 1. Collections card — no "View all" ───────────────────────────

describe("Collections card — header has no 'View all' link", () => {
  it("does NOT render the view-all testid", () => {
    expect(dashSrc).not.toMatch(/data-testid="link-view-all-collections"/);
  });

  it("does NOT contain a 'View all' button inside CollectionsOverviewCard", () => {
    const block = dashSrc.match(/function CollectionsOverviewCard\([\s\S]+?^}/m);
    expect(block).toBeTruthy();
    expect(block![0]).not.toMatch(/View all/);
  });

  it("CollectionsOverviewCard does NOT declare an onViewAll prop", () => {
    const block = dashSrc.match(/interface CollectionsOverviewCardProps\s*\{[\s\S]+?\}/m);
    expect(block).toBeTruthy();
    expect(block![0]).not.toMatch(/onViewAll/);
  });

  it("the card call site does NOT pass onViewAll", () => {
    const callSite = dashSrc.match(/<CollectionsOverviewCard[\s\S]+?\/>/m);
    expect(callSite).toBeTruthy();
    expect(callSite![0]).not.toMatch(/onViewAll/);
  });
});

// ─── 2. Scheduled Revenue card — no "View all" ─────────────────────

describe("Scheduled Revenue card — header has no 'View all' link", () => {
  it("does NOT render the view-all testid", () => {
    expect(dashSrc).not.toMatch(/data-testid="link-view-all-scheduled"/);
  });

  it("does NOT contain a 'View all' button inside ScheduledRevenueCard", () => {
    const block = dashSrc.match(/function ScheduledRevenueCard\([\s\S]+?^}/m);
    expect(block).toBeTruthy();
    expect(block![0]).not.toMatch(/View all/);
  });

  it("ScheduledRevenueCard does NOT declare an onViewAll prop", () => {
    const block = dashSrc.match(/interface ScheduledRevenueCardProps\s*\{[\s\S]+?\}/m);
    expect(block).toBeTruthy();
    expect(block![0]).not.toMatch(/onViewAll/);
  });

  it("the card call site does NOT pass onViewAll", () => {
    const callSite = dashSrc.match(/<ScheduledRevenueCard[\s\S]+?\/>/m);
    expect(callSite).toBeTruthy();
    expect(callSite![0]).not.toMatch(/onViewAll/);
  });
});

// ─── 3. Operational Alerts — no collapse/minimize button ───────────

describe("Operational Alerts card — no collapse/minimize button", () => {
  it("the collapse toggle testid is absent", () => {
    expect(alertsSrc).not.toMatch(/data-testid="operational-alerts-toggle"/);
  });

  it("does NOT render a ChevronDown (collapse indicator)", () => {
    expect(alertsSrc).not.toMatch(/ChevronDown/);
  });

  it("does NOT use useState or useRef (no collapse state)", () => {
    // After removing the collapsible behavior the component has no React
    // hooks — the `from "react"` import line was removed entirely.
    expect(alertsSrc).not.toMatch(/useState/);
    expect(alertsSrc).not.toMatch(/useRef/);
  });

  it("the header is a non-interactive div, not a button", () => {
    // The header must carry the canonical header testid as a div, not a button.
    expect(alertsSrc).toMatch(/data-testid="operational-alerts-header"/);
    // No button element that has the header area content.
    expect(alertsSrc).not.toMatch(/<button[\s\S]{0,200}?Operational alerts/);
  });

  it("the count badge still renders", () => {
    expect(alertsSrc).toMatch(/data-testid="operational-alerts-count-badge"/);
  });

  it("the body renders unconditionally (no isCollapsed guard)", () => {
    expect(alertsSrc).toMatch(/id="operational-alerts-body"/);
    expect(alertsSrc).not.toMatch(/isCollapsed/);
  });
});

// ─── 4. Today card — icon-only column display button ───────────────

describe("Today card — compact icon-only column display button", () => {
  it("the toggle button carries aria-label='Column display'", () => {
    expect(dashSrc).toMatch(/aria-label="Column display"/);
  });

  it("the toggle button carries title='Column display'", () => {
    expect(dashSrc).toMatch(/title="Column display"/);
  });

  it("does NOT render a visible text label 'Column' in the display mode toggle", () => {
    // The prior column-mode branch rendered a <span>Column</span> text
    // label. With the icon-only button that span is gone.
    // We check the displayModeToggleControl definition block only to avoid
    // false matches elsewhere in the file.
    const toggleBlock = dashSrc.match(
      /const displayModeToggleControl[\s\S]+?^\s*\) : null;/m,
    );
    expect(toggleBlock).toBeTruthy();
    // The span with the text "Column" must not be there.
    expect(toggleBlock![0]).not.toMatch(/<span>\s*Column\s*<\/span>/);
    expect(toggleBlock![0]).not.toMatch(/<span>\s*Stacked\s*<\/span>/);
  });

  it("imports Columns icon from lucide-react for column mode", () => {
    expect(dashSrc).toMatch(/\bColumns\b[\s\S]*?from\s*["']lucide-react["']/);
  });

  it("renders the Columns icon in the toggle button", () => {
    const toggleBlock = dashSrc.match(
      /const displayModeToggleControl[\s\S]+?^\s*\) : null;/m,
    );
    expect(toggleBlock).toBeTruthy();
    expect(toggleBlock![0]).toMatch(/<Columns\b/);
  });

  it("the toggle button still uses the canonical data-testid", () => {
    expect(dashSrc).toMatch(/data-testid="schedule-display-mode-toggle"/);
  });

  it("clicking the toggle still flips column ↔ stacked", () => {
    expect(dashSrc).toMatch(
      /onDisplayModeChange\(\s*scheduleDisplayMode === "column"\s*\?\s*"stacked"\s*:\s*"column"/,
    );
  });
});

// ─── 5. Drag handle preserved ──────────────────────────────────────

describe("Dashboard drag handle — not removed by header cleanup", () => {
  it("DashboardWidgetGrid still renders the per-cell drag handle button", () => {
    expect(gridSrc).toMatch(/data-testid=\{?`?dashboard-widget-drag-handle/);
  });

  it("drag handle is absolutely positioned in the cell corner", () => {
    expect(gridSrc).toMatch(/absolute[\s\S]{0,80}?top-1\.5[\s\S]{0,80}?right-1\.5/);
  });

  it("GripVertical icon still used on the drag handle", () => {
    expect(gridSrc).toMatch(/GripVertical/);
  });
});

// ─── 6. DashboardCustomizeDrawer — untouched ───────────────────────

describe("DashboardCustomizeDrawer — reorder/customization wiring unchanged", () => {
  it("drawer still directs users to drag widgets on the dashboard", () => {
    expect(drawerSrc).toMatch(/[Dd]rag widgets directly on the dashboard to reorder/);
  });

  it("drawer does NOT import @dnd-kit (drag lives on the grid)", () => {
    expect(drawerSrc).not.toMatch(/from\s+["']@dnd-kit\/core["']/);
    expect(drawerSrc).not.toMatch(/from\s+["']@dnd-kit\/sortable["']/);
  });

  it("drawer still has toggle show/hide controls", () => {
    expect(drawerSrc).toMatch(/[Tt]oggle/);
  });
});
