/**
 * Compact sidebar width — icon-over-label redesign (2026-05-18).
 *
 * Sidebar is now a fixed 6rem (96px) compact column showing icon
 * above label. The variable is the SINGLE source of truth: sidebar.tsx
 * reads `var(--sidebar-width)` for both the fixed sidebar pane AND
 * the spacer that pushes the main content right.
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

describe("Sidebar width — authoritative override (App.tsx)", () => {
  it("--sidebar-width is set to 6rem (96px) on the SidebarProvider style prop", () => {
    expect(appSrc).toMatch(/"--sidebar-width":\s*"6rem"/);
  });

  it("--sidebar-width-icon is preserved at 3rem (offcanvas collapse unchanged)", () => {
    expect(appSrc).toMatch(/"--sidebar-width-icon":\s*"3rem"/);
  });
});

describe("Sidebar width — fallback constant (ui/sidebar.tsx)", () => {
  it("SIDEBAR_WIDTH fallback matches the App.tsx override at 6rem", () => {
    expect(sidebarPrimitiveSrc).toMatch(/const SIDEBAR_WIDTH = "6rem"/);
  });

  it("mobile width is not narrowed by this change", () => {
    expect(sidebarPrimitiveSrc).toMatch(/const SIDEBAR_WIDTH_MOBILE = "18rem"/);
  });
});

describe("Sidebar width — single source of truth drives main-content offset", () => {
  it("the sidebar pane and the layout spacer both read var(--sidebar-width)", () => {
    expect(sidebarPrimitiveSrc).toMatch(
      /w-\[var\(--sidebar-width\)\][\s\S]+?bg-sidebar text-sidebar-foreground/,
    );
    expect(sidebarPrimitiveSrc).toMatch(
      /fixed inset-y-0[\s\S]+?w-\[var\(--sidebar-width\)\]/,
    );
  });
});
