/**
 * Tenant sidebar width — fourth-pass adjustment (2026-05-07).
 *
 * After the second module rename ("Maintenance" → "Service Plans"),
 * the longest tenant menu label is now 13 chars instead of 11. The
 * width was bumped from 8.5rem (136px) → 9.5rem (152px) so "Service
 * Plans" still fits on a single line at active-state semibold weight
 * — without going back to the prior 9.625rem ceiling. The
 * authoritative width is set as a CSS variable via `<SidebarProvider
 * style>` in App.tsx; ui/sidebar.tsx ships a matching fallback for
 * any caller that mounts SidebarProvider without a style override.
 *
 * The shadcn sidebar primitive reads `var(--sidebar-width)` for
 * BOTH the fixed sidebar pane AND the spacer that pushes the main
 * content right, so a single CSS variable is the only knob — there
 * is no separate main-content offset to keep in sync.
 *
 * This source-pin is a regression guard against:
 *   - silent reverts to 8.5rem (truncates "Service Plans")
 *   - widening drift back toward 9.625rem
 *   - a future label rename that re-wraps because someone forgot
 *     `[&>span:last-child]:truncate` is what keeps lines single
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const appSrc = readFileSync(
  resolve(__dirname, "../client/src/App.tsx"),
  "utf-8",
);
const sidebarPrimitiveSrc = readFileSync(
  resolve(__dirname, "../client/src/components/ui/sidebar.tsx"),
  "utf-8",
);
const appSidebarSrc = readFileSync(
  resolve(__dirname, "../client/src/components/AppSidebar.tsx"),
  "utf-8",
);

describe("Sidebar width — authoritative override (App.tsx)", () => {
  it("--sidebar-width is set to 9.5rem (152px) on the SidebarProvider style prop", () => {
    // 2026-05-07 fix: bumped from 8.5rem (136px) → 9.5rem (152px) so
    // "Service Plans" (the new longest tenant menu label) still fits
    // on a single line at active-state semibold weight. Stays narrower
    // than the prior 9.625rem (154px) ceiling.
    expect(appSrc).toMatch(
      /"--sidebar-width":\s*"9\.5rem"/,
    );
    // Earlier widths are all gone — 9.5rem is the only declared
    // expanded width.
    expect(appSrc).not.toMatch(/"--sidebar-width":\s*"9\.625rem"/);
    expect(appSrc).not.toMatch(/"--sidebar-width":\s*"8\.5rem"/);
    expect(appSrc).not.toMatch(/"--sidebar-width":\s*"8rem"/);
  });

  it("--sidebar-width-icon is preserved at 3rem (collapse mode unchanged)", () => {
    expect(appSrc).toMatch(/"--sidebar-width-icon":\s*"3rem"/);
  });
});

describe("Sidebar width — fallback constant (ui/sidebar.tsx)", () => {
  it("SIDEBAR_WIDTH fallback matches the App.tsx override at 9.5rem", () => {
    expect(sidebarPrimitiveSrc).toMatch(/const SIDEBAR_WIDTH = "9\.5rem"/);
    expect(sidebarPrimitiveSrc).not.toMatch(/const SIDEBAR_WIDTH = "9\.625rem"/);
    expect(sidebarPrimitiveSrc).not.toMatch(/const SIDEBAR_WIDTH = "8\.5rem"/);
    expect(sidebarPrimitiveSrc).not.toMatch(/const SIDEBAR_WIDTH = "8rem"/);
  });

  it("the icon-collapsed width and mobile width are not narrowed by this change", () => {
    // Only the expanded desktop width was trimmed — collapse and
    // mobile sheet widths are intentionally untouched.
    expect(sidebarPrimitiveSrc).toMatch(/const SIDEBAR_WIDTH_ICON = "3rem"/);
    expect(sidebarPrimitiveSrc).toMatch(/const SIDEBAR_WIDTH_MOBILE = "18rem"/);
  });
});

describe("Sidebar width — single source of truth drives main-content offset", () => {
  it("the sidebar pane and the layout spacer both read var(--sidebar-width)", () => {
    // Pin the architectural contract: changing the CSS var alone is
    // enough to update BOTH the visual sidebar AND the main-content
    // offset. If either of these reads disappears, the sidebar and
    // the content offset can drift apart.
    expect(sidebarPrimitiveSrc).toMatch(
      /w-\[var\(--sidebar-width\)\][\s\S]+?bg-sidebar text-sidebar-foreground/,
    );
    // The fixed-position desktop sidebar pane uses the same var.
    expect(sidebarPrimitiveSrc).toMatch(
      /fixed inset-y-0[\s\S]+?w-\[var\(--sidebar-width\)\]/,
    );
  });
});

describe("Create button — collapsed-mode rendering", () => {
  it("Create span has group-data-[collapsible=icon]:hidden (text hidden in collapsed rail)", () => {
    // Root cause fix: the Create button used a plain <button> that did not
    // inherit SidebarMenuButton's automatic icon-collapse logic. Adding
    // group-data-[collapsible=icon]:hidden to the span is the idiomatic
    // shadcn approach — same selector the SidebarMenuButton CVA applies
    // internally to its label spans.
    expect(appSidebarSrc).toMatch(/group-data-\[collapsible=icon\]:hidden/);
  });

  it("Create button has group-data-[collapsible=icon]:justify-center (icon centers in 48px rail)", () => {
    expect(appSidebarSrc).toMatch(/group-data-\[collapsible=icon\]:justify-center/);
  });

  it("Plus icon on Create button has shrink-0 (does not compress in collapsed rail)", () => {
    // Ensures the Plus icon doesn't get squashed when the rail is 3rem wide.
    expect(appSidebarSrc).toMatch(/Plus.*shrink-0|shrink-0.*Plus/s);
  });
});

describe("Sidebar labels stay on one line at the trimmed width", () => {
  it("SidebarMenuButton applies truncate to the label (no wrapping)", () => {
    // The cva variant string includes `[&>span:last-child]:truncate`
    // which sets white-space:nowrap + overflow:hidden + ellipsis on
    // the inner label span. This is what guarantees single-line
    // labels regardless of column width.
    expect(sidebarPrimitiveSrc).toMatch(
      /\[&>span:last-child\]:truncate/,
    );
  });

  it("the five tenant menu titles that must fit at the chosen width are present", () => {
    // The brief: width must still fit Dashboard, Dispatch,
    // Service Plans, Timesheets, Suppliers without wrapping. Pin each
    // title literal so a future menu reorder/rename trip-wires.
    expect(appSidebarSrc).toMatch(/title:\s*"Dashboard"/);
    expect(appSidebarSrc).toMatch(/title:\s*"Dispatch"/);
    expect(appSidebarSrc).toMatch(/title:\s*"Service Plans"/);
    expect(appSidebarSrc).toMatch(/title:\s*"Timesheets"/);
    expect(appSidebarSrc).toMatch(/title:\s*"Suppliers"/);
  });

  it("the Service Plans entry is the renamed /pm destination, not Maintenance / Recurring Jobs", () => {
    // Anchored to the entry shape so a future widget can't satisfy
    // the title-only assertion above by mounting a stray "Service Plans"
    // string somewhere unrelated.
    expect(appSidebarSrc).toMatch(
      /title:\s*"Service Plans"[\s\S]+?href:\s*"\/pm"/,
    );
  });
});
