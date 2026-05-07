/**
 * Tenant sidebar width — third-pass trim (2026-05-06).
 *
 * After "Recurring Jobs" was renamed to "Maintenance" (a shorter
 * label), the sidebar can shrink without any label wrapping or
 * truncation. The authoritative width is set as a CSS variable via
 * `<SidebarProvider style>` in App.tsx; ui/sidebar.tsx ships a
 * matching fallback for any caller that mounts SidebarProvider
 * without a style override.
 *
 * The shadcn sidebar primitive reads `var(--sidebar-width)` for
 * BOTH the fixed sidebar pane AND the spacer that pushes the main
 * content right, so a single CSS variable is the only knob — there
 * is no separate main-content offset to keep in sync.
 *
 * This source-pin is a regression guard against:
 *   - silent reverts to 9.625rem
 *   - widening drift in either of the two locations
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
  it("--sidebar-width is set to 8.5rem (136px) on the SidebarProvider style prop", () => {
    // 2026-05-06 fix: bumped from 8rem (128px) → 8.5rem (136px) after
    // active-state semibold "Maintenance" hit ellipsis truncation at
    // 128px. 8.5rem restores headroom while staying narrower than
    // the prior 9.625rem (154px).
    expect(appSrc).toMatch(
      /"--sidebar-width":\s*"8\.5rem"/,
    );
    // Both the prior 154px column and the regressed 128px column
    // are gone — 8.5rem is the only declared expanded width.
    expect(appSrc).not.toMatch(/"--sidebar-width":\s*"9\.625rem"/);
    expect(appSrc).not.toMatch(/"--sidebar-width":\s*"8rem"/);
  });

  it("--sidebar-width-icon is preserved at 3rem (collapse mode unchanged)", () => {
    expect(appSrc).toMatch(/"--sidebar-width-icon":\s*"3rem"/);
  });
});

describe("Sidebar width — fallback constant (ui/sidebar.tsx)", () => {
  it("SIDEBAR_WIDTH fallback matches the App.tsx override at 8.5rem", () => {
    expect(sidebarPrimitiveSrc).toMatch(/const SIDEBAR_WIDTH = "8\.5rem"/);
    expect(sidebarPrimitiveSrc).not.toMatch(/const SIDEBAR_WIDTH = "9\.625rem"/);
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

  it("the five tenant menu titles that must fit at 128px are present", () => {
    // The brief: width must still fit Dashboard, Dispatch,
    // Maintenance, Timesheets, Suppliers without wrapping. Pin each
    // title literal so a future menu reorder/rename trip-wires.
    expect(appSidebarSrc).toMatch(/title:\s*"Dashboard"/);
    expect(appSidebarSrc).toMatch(/title:\s*"Dispatch"/);
    expect(appSidebarSrc).toMatch(/title:\s*"Maintenance"/);
    expect(appSidebarSrc).toMatch(/title:\s*"Timesheets"/);
    expect(appSidebarSrc).toMatch(/title:\s*"Suppliers"/);
  });

  it("the Maintenance entry is the renamed /pm destination, not Recurring Jobs", () => {
    // Anchored to the entry shape so a future widget can't satisfy
    // the title-only assertion above by mounting a stray "Maintenance"
    // string somewhere unrelated.
    expect(appSidebarSrc).toMatch(
      /title:\s*"Maintenance"[\s\S]+?href:\s*"\/pm"/,
    );
  });
});
