/**
 * Detail right-rail canonical primitive — source pin tests
 * (2026-05-07 extraction, 2026-05-11 top-tab layout).
 *
 * The top-tab-navigation + expandable-panel chrome shared by
 * ClientDetailPage / JobDetailPage / InvoiceDetailPage / QuoteDetailPage /
 * LeadDetailPage lives in the canonical primitive at
 * `client/src/components/detail-rail/DetailRightRail.tsx`. These pins
 * fail if a future refactor:
 *
 *   - makes the primitive stateful (it MUST be controlled —
 *     `activeTabId` + `onActiveTabChange` props are the contract)
 *   - drops the `aria-pressed` / bottom-underline / close-X wiring
 *   - hardcodes a testid string instead of templating from
 *     `${testIdPrefix}` (would break ClientDetailPage's
 *     `client-side-rail` / `client-side-panel-*` selectors and
 *     JobDetailPage's `job-side-*` namespace)
 *   - couples the primitive to a specific page's tab registry or
 *     domain types
 *   - re-introduces the old left-side vertical icon strip nav
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const PRIMITIVE = resolve(
  ROOT,
  "client/src/components/detail-rail/DetailRightRail.tsx",
);
const railSrc = readFileSync(PRIMITIVE, "utf-8");

// ── 1. Public contract: named exports ──────────────────────────────

describe("DetailRightRail — public exports", () => {
  it("exports the `DetailRightRail` component", () => {
    expect(railSrc).toMatch(/export\s+function\s+DetailRightRail\s*\(/);
  });

  it("exports the `DetailRightRailEmpty` empty-state helper", () => {
    expect(railSrc).toMatch(/export\s+function\s+DetailRightRailEmpty\s*\(/);
  });

  it("exports the `DetailRailTab` tab-config type", () => {
    expect(railSrc).toMatch(/export\s+interface\s+DetailRailTab\s*\{/);
  });

  it("exports the `DetailRightRailProps` props type", () => {
    expect(railSrc).toMatch(/export\s+interface\s+DetailRightRailProps\s*\{/);
  });
});

// ── 2. Tab config shape ────────────────────────────────────────────

describe("DetailRailTab — tab config shape", () => {
  it("requires id / label / icon / content fields", () => {
    expect(railSrc).toMatch(/^\s*id:\s*string;/m);
    expect(railSrc).toMatch(/^\s*label:\s*string;/m);
    expect(railSrc).toMatch(/^\s*icon:\s*ComponentType<\{\s*className\?:\s*string\s*\}>;/m);
    expect(railSrc).toMatch(/^\s*content:\s*ReactNode;/m);
  });

  it("supports an optional `count` badge", () => {
    expect(railSrc).toMatch(/^\s*count\?:\s*number;/m);
  });

  it("supports an optional `action` slot rendered in the panel body (not the header)", () => {
    expect(railSrc).toMatch(/^\s*action\?:\s*ReactNode;/m);
  });

  it("supports an optional per-tab `testId` override", () => {
    expect(railSrc).toMatch(/^\s*testId\?:\s*string;/m);
  });
});

// ── 3. Component contract: controlled, no internal state ───────────

describe("DetailRightRail — controlled, no internal state", () => {
  it("accepts `activeTabId` and `onActiveTabChange` as the controlled-state contract", () => {
    expect(railSrc).toMatch(/^\s*activeTabId:\s*string\s*\|\s*null;/m);
    expect(railSrc).toMatch(/onActiveTabChange:\s*\(id:\s*string\s*\|\s*null\)\s*=>\s*void;/);
  });

  it("the primitive remains controlled — `activeTabId` + `onActiveTabChange` are the contract", () => {
    // 2026-05-07 RALPH: the primitive carries internal `useState`
    // strictly for the close animation lag (`displayedActiveId`) and
    // for tracking the last-active tab for the collapsed strip. The
    // controlled prop contract is unchanged; these states are purely
    // implementation details. We pin `useReducer`/`useRef` are absent.
    expect(railSrc).toMatch(
      /^\s*activeTabId:\s*string\s*\|\s*null;/m,
    );
    expect(railSrc).toMatch(
      /onActiveTabChange:\s*\(id:\s*string\s*\|\s*null\)\s*=>\s*void;/,
    );
    expect(railSrc).not.toMatch(/\buseReducer\b/);
    expect(railSrc).not.toMatch(/\buseRef\b/);
    // Animation lag state: initialized from `activeTabId`.
    expect(railSrc).toMatch(
      /useState<string\s*\|\s*null>\(\s*\n?\s*activeTabId,?\s*\n?\s*\)/,
    );
  });

  it("clicking the active tab again closes the panel via onActiveTabChange(null)", () => {
    expect(railSrc).toMatch(
      /onActiveTabChange\(\s*isActive\s*\?\s*null\s*:\s*tab\.id\s*\)/,
    );
  });
});

// ── 4. Test-id contract (consumed by all rail pages) ───────────────

describe("DetailRightRail — testid templates use the testIdPrefix prop", () => {
  it("the inner <nav> emits `${testIdPrefix}-rail`", () => {
    expect(railSrc).toMatch(/data-testid=\{`\$\{testIdPrefix\}-rail`\}/);
  });

  it("each tab button emits `tab.testId ?? ${testIdPrefix}-tab-${tab.id}`", () => {
    expect(railSrc).toMatch(
      /data-testid=\{tab\.testId\s*\?\?\s*`\$\{testIdPrefix\}-tab-\$\{tab\.id\}`\}/,
    );
  });

  it("the panel <section> emits `${testIdPrefix}-panel-${displayedTab.id}` (lagged for close animation)", () => {
    expect(railSrc).toMatch(
      /data-testid=\{`\$\{testIdPrefix\}-panel-\$\{displayedTab\.id\}`\}/,
    );
  });

  it("the panel <header> emits `${testIdPrefix}-panel-header-${displayedTab.id}`", () => {
    expect(railSrc).toMatch(
      /data-testid=\{`\$\{testIdPrefix\}-panel-header-\$\{displayedTab\.id\}`\}/,
    );
  });

  it("the panel body emits `${testIdPrefix}-panel-body-${displayedTab.id}`", () => {
    expect(railSrc).toMatch(
      /data-testid=\{`\$\{testIdPrefix\}-panel-body-\$\{displayedTab\.id\}`\}/,
    );
  });

  it("the close-X button emits `${testIdPrefix}-panel-close`", () => {
    expect(railSrc).toMatch(
      /data-testid=\{`\$\{testIdPrefix\}-panel-close`\}/,
    );
  });

  it("the empty-state helper emits `${testIdPrefix}-panel-empty`", () => {
    expect(railSrc).toMatch(
      /data-testid=\{`\$\{testIdPrefix\}-panel-empty`\}/,
    );
  });

  it("the collapsed strip emits `${testIdPrefix}-collapsed`", () => {
    expect(railSrc).toMatch(
      /data-testid=\{`\$\{testIdPrefix\}-collapsed`\}/,
    );
  });

  it("the expand button in collapsed strip emits `${testIdPrefix}-rail-expand`", () => {
    expect(railSrc).toMatch(
      /data-testid=\{`\$\{testIdPrefix\}-rail-expand`\}/,
    );
  });
});

// ── 5. Accessibility wiring ────────────────────────────────────────

describe("DetailRightRail — accessibility", () => {
  it("each tab button carries aria-pressed={isActive}", () => {
    expect(railSrc).toMatch(/aria-pressed=\{isActive\}/);
  });

  it("the close-X carries aria-label='Close panel'", () => {
    expect(railSrc).toMatch(/aria-label="Close panel"/);
  });

  it("the panel <section> carries an aria-label using the displayed tab's label", () => {
    expect(railSrc).toMatch(/aria-label=\{`\$\{displayedTab\.label\}\s+panel`\}/);
  });

  it("the tab navigation nav carries the configurable ariaLabel prop", () => {
    expect(railSrc).toMatch(/aria-label=\{ariaLabel\}/);
  });

  it("the expand button in collapsed strip has a descriptive aria-label", () => {
    expect(railSrc).toMatch(/aria-label=\{`Open \$\{collapsedTab\.label\} panel`\}/);
  });
});

// ── 5b. Collapsed-state contract ───────────────────────────────────

describe("DetailRightRail — collapsed state (activeTabId === null)", () => {
  it("panel <section> is rendered while `displayedTab` is non-null (lagged unmount for close animation)", () => {
    expect(railSrc).toMatch(
      /\{displayedTab\s*&&\s*\(\s*\n?\s*<section\b/,
    );
  });

  it("the outer container shrinks to fit (`w-fit`) once the close animation finishes", () => {
    // Gated on `displayedTab` (lagged), NOT `activeTab` (immediate),
    // so the container doesn't snap mid-close animation.
    expect(railSrc).toMatch(/!displayedTab\s*&&\s*"w-fit"/);
  });

  it("the outer container exposes `data-panel-open` reflecting open/closed state", () => {
    expect(railSrc).toMatch(
      /data-panel-open=\{activeTab\s*\?\s*"true"\s*:\s*"false"\}/,
    );
  });

  it("clicking a tab when closed reopens that tab (toggle handler restores activeTabId)", () => {
    expect(railSrc).toMatch(
      /onActiveTabChange\(\s*isActive\s*\?\s*null\s*:\s*tab\.id\s*\)/,
    );
  });

  it("the close-X button sets activeTabId to null", () => {
    expect(railSrc).toMatch(/onClick=\{\(\)\s*=>\s*onActiveTabChange\(null\)\}/);
  });

  it("the empty-state helper (`<DetailRightRailEmpty>`) is never auto-rendered when the panel is closed", () => {
    expect(railSrc).not.toMatch(
      /\{!activeTab[\s\S]{0,200}?<DetailRightRailEmpty/,
    );
    expect(railSrc).not.toMatch(/<DetailRightRailEmpty[\s\S]{0,200}?\/>\s*\}\s*\)/);
  });

  it("collapsed strip renders when `!displayedTab` (not icon strip — compact label only)", () => {
    expect(railSrc).toMatch(
      /\{!displayedTab\s*&&\s*collapsedTab\s*&&\s*\(/,
    );
  });

  it("collapsed strip does NOT render the full tab list (no tabs.map in the collapsed strip)", () => {
    // tabs.map is inside the expanded section — the collapsed strip
    // only shows the last-active label. Pin against regression.
    const collapsedBlockMatch = railSrc.match(
      /\{!displayedTab\s*&&\s*collapsedTab\s*&&\s*\([\s\S]{0,1800}?\)\s*\}/,
    );
    expect(collapsedBlockMatch, "collapsed strip block must exist").not.toBeNull();
    const block = collapsedBlockMatch?.[0] ?? "";
    expect(block).not.toMatch(/tabs\.map/);
  });

  it("collapsed strip shows the last-active or first tab label", () => {
    expect(railSrc).toMatch(/collapsedTab\.label/);
  });

  it("last-active tab id is tracked internally for collapsed strip display", () => {
    expect(railSrc).toMatch(/lastActiveTabId/);
    expect(railSrc).toMatch(/setLastActiveTabId/);
  });
});

// ── 6. Active-state visual (top-tab horizontal underline) ──────────

describe("DetailRightRail — active-state styling (top-tab underline)", () => {
  it("active tab uses green bottom-border underline (`border-[#76B054]`)", () => {
    // 2026-05-11: the old left-side accent bar (`bg-[#76B054]` span) is
    // replaced by a bottom-border underline on the horizontal top tab.
    expect(railSrc).toMatch(
      /isActive[\s\S]{0,400}?border-\[#76B054\]/,
    );
  });

  it("active tab text color is the canonical brand green (text-brand)", () => {
    expect(railSrc).toMatch(/isActive[\s\S]{0,200}?"text-brand\s+border-\[#76B054\]"/);
  });

  it("inactive tab uses border-transparent (no underline)", () => {
    expect(railSrc).toMatch(
      /"text-slate-600 hover:text-slate-900 border-transparent"/,
    );
  });

  it("focus ring is the canonical green at 40% opacity", () => {
    expect(railSrc).toMatch(/focus-visible:ring-\[#76B054\]\/40/);
  });

  it("does NOT render the old left-side accent bar `<span>` with `bg-[#76B054]`", () => {
    // The old vertical-strip accent bar was:
    //   isActive && (<span ... className="... bg-[#76B054]" />)
    // The new active indicator is the tab's own bottom border — no
    // extra <span> element needed.
    expect(railSrc).not.toMatch(
      /isActive\s*&&\s*\(\s*\n?\s*<span[\s\S]{0,200}?bg-\[#76B054\]/,
    );
  });
});

// ── 7. Layout: top-tab not vertical icon strip ─────────────────────

describe("DetailRightRail — top horizontal tab layout (not vertical icon strip)", () => {
  it("the horizontal nav is rendered INSIDE the expanded `<section>` (not outside it)", () => {
    // Nav lives inside {displayedTab && (<section ... }. It is NOT
    // an always-visible element outside the panel — the old vertical
    // icon strip was always-visible; the new horizontal nav is only
    // present when a panel is open.
    expect(railSrc).toMatch(
      /\{displayedTab\s*&&[\s\S]{0,1500}?aria-label=\{ariaLabel\}[\s\S]{0,600}?tabs\.map/,
    );
  });

  it("the outer container is flex-col (not flex-row) — top-tabs stack with body", () => {
    // Old: flex (flex-row) to place icon strip left + panel right.
    // New: flex-col to stack top-tab header above panel body.
    expect(railSrc).toMatch(
      /"h-full flex flex-col overflow-hidden bg-white border-l border-slate-200"/,
    );
  });

  it("does NOT render a standalone vertical icon strip nav outside the section", () => {
    // The old 76px `<nav className="w-[76px] shrink-0 ...">` must be gone.
    expect(railSrc).not.toMatch(/w-\[76px\]\s+shrink-0/);
    expect(railSrc).not.toMatch(/"w-\[76px\]"/);
  });

  it("tab buttons use horizontal tab padding (px-2.5) not vertical strip padding (px-1 py-2 flex-col)", () => {
    // Old vertical strip buttons: `relative w-full px-1 py-2 flex flex-col`
    // New horizontal tab buttons: `px-2.5 py-2 text-helper`
    expect(railSrc).not.toMatch(/relative w-full px-1 py-2 flex flex-col/);
    expect(railSrc).toMatch(/px-2\.5 py-2 text-helper/);
  });
});

// ── 8. Surface contract: no domain coupling ────────────────────────

describe("DetailRightRail — purely presentational, no domain coupling", () => {
  it("does NOT import any page-specific or domain types", () => {
    expect(railSrc).not.toMatch(/from\s+["']@\/pages\//);
    expect(railSrc).not.toMatch(/from\s+["']@shared\/schema["']/);
    expect(railSrc).not.toMatch(/\bClientContact\b/);
    expect(railSrc).not.toMatch(/\bLocationEquipment\b/);
    expect(railSrc).not.toMatch(/\bEntityNotesSection\b/);
    expect(railSrc).not.toMatch(/\bNotesPanel\b/);
  });

  it("does NOT make API calls (no useQuery / useMutation / fetch / apiRequest)", () => {
    expect(railSrc).not.toMatch(/\buseQuery\b/);
    expect(railSrc).not.toMatch(/\buseMutation\b/);
    expect(railSrc).not.toMatch(/\bapiRequest\b/);
    expect(railSrc).not.toMatch(/\bfetch\(/);
  });
});
