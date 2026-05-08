/**
 * Detail right-rail canonical primitive — source pin tests
 * (2026-05-07 extraction).
 *
 * The vertical icon strip + expandable panel chrome shared by
 * ClientDetailPage / JobDetailPage / future Invoice + Quote detail
 * surfaces lives in the canonical primitive at
 * `client/src/components/detail-rail/DetailRightRail.tsx`. These pins
 * fail if a future refactor:
 *
 *   - makes the primitive stateful (it MUST be controlled —
 *     `activeTabId` + `onActiveTabChange` props are the contract)
 *   - drops the `aria-pressed` / accent-bar / close-X wiring
 *   - hardcodes a testid string instead of templating from
 *     `${testIdPrefix}` (would break ClientDetailPage's
 *     `client-side-rail` / `client-side-panel-*` selectors and
 *     JobDetailPage's `job-side-*` namespace)
 *   - couples the primitive to a specific page's tab registry or
 *     domain types
 *
 * The primitive is tested at the source-pin level (it doesn't render
 * React in isolation here) — page-level tests in
 * `tests/client-side-rail.test.ts` and `tests/job-detail-right-rail.test.ts`
 * verify the consumer wiring.
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

  it("supports an optional `action` slot rendered in the panel header", () => {
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
    // 2026-05-07 RALPH: the primitive now carries internal `useState`
    // strictly to lag the panel section's unmount during the close
    // animation (so the slide-out can complete before the DOM tears
    // down). The controlled prop contract is unchanged; the lag state
    // is purely an animation-staging implementation detail. We pin
    // the controlled props are still there and ban `useReducer` /
    // `useRef` (which would imply a heavier internal model).
    expect(railSrc).toMatch(
      /^\s*activeTabId:\s*string\s*\|\s*null;/m,
    );
    expect(railSrc).toMatch(
      /onActiveTabChange:\s*\(id:\s*string\s*\|\s*null\)\s*=>\s*void;/,
    );
    expect(railSrc).not.toMatch(/\buseReducer\b/);
    expect(railSrc).not.toMatch(/\buseRef\b/);
    // The single permitted internal state is the lagged display id;
    // it must be initialized from `activeTabId` (not a literal null).
    expect(railSrc).toMatch(
      /useState<string\s*\|\s*null>\(\s*\n?\s*activeTabId,?\s*\n?\s*\)/,
    );
  });

  it("clicking the active tab again closes the panel via onActiveTabChange(null)", () => {
    // Toggle behavior must be implemented inside the primitive, not
    // shoved onto consumers.
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
    // 2026-05-07 RALPH: testids now read from `displayedTab` so they
    // remain stable during the close slide-out (when the user has
    // already cleared `activeTabId` but the panel is still mounted
    // and fading). The id value is identical for the duration of the
    // panel's visible lifetime.
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
    // 2026-05-07 RALPH: aria-label reads from `displayedTab` for the
    // same reason testids do — it stays valid throughout the close
    // animation. `aria-hidden` (asserted in `rail-animation.test.ts`)
    // is what tells AT the panel is in transition.
    expect(railSrc).toMatch(/aria-label=\{`\$\{displayedTab\.label\}\s+panel`\}/);
  });

  it("the icon-strip nav carries the configurable ariaLabel prop", () => {
    expect(railSrc).toMatch(/aria-label=\{ariaLabel\}/);
  });
});

// ── 5b. Collapsed-state contract: panel + width both go away ───────

describe("DetailRightRail — collapsed state (activeTabId === null)", () => {
  it("panel <section> is rendered while `displayedTab` is non-null (lagged unmount for close animation)", () => {
    // 2026-05-07 RALPH: the section's render guard now reads from
    // `displayedTab`, the lagged copy of `activeTab`. When the user
    // closes the panel `activeTab` becomes null immediately; the
    // section keeps rendering for ~300ms until the deferred-unmount
    // timer (in `rail-animation.test.ts`) fires and clears
    // `displayedTab`. After that the section truly leaves the DOM —
    // there is still no fallback / hidden div in the closed steady
    // state.
    expect(railSrc).toMatch(
      /\{displayedTab\s*&&\s*\(\s*\n?\s*<section\b/,
    );
  });

  it("the outer container shrinks to fit the nav (`w-fit`) once the close animation finishes", () => {
    // Without `w-fit`, the flex container stretches to fill its
    // parent's width and renders a blank-white rectangle next to the
    // icon strip on any page that doesn't externally constrain rail
    // width (the JobDetailPage bug). 2026-05-07 RALPH: the toggle is
    // gated on `displayedTab`, NOT `activeTab`, so it doesn't snap on
    // mid-close — see `rail-animation.test.ts` for the rationale.
    expect(railSrc).toMatch(/!displayedTab\s*&&\s*"w-fit"/);
  });

  it("the outer container exposes `data-panel-open` reflecting open/closed state", () => {
    // Useful for downstream layout adapters and a programmatic
    // hook for tests that want to assert collapsed/open without
    // querying className.
    expect(railSrc).toMatch(
      /data-panel-open=\{activeTab\s*\?\s*"true"\s*:\s*"false"\}/,
    );
  });

  it("clicking a tab when closed reopens that tab (toggle handler restores activeTabId)", () => {
    // The same toggle expression handles both directions: re-clicking
    // the active tab closes (`isActive` → null), clicking a non-
    // active tab opens it (`!isActive` → tab.id).
    expect(railSrc).toMatch(
      /onActiveTabChange\(\s*isActive\s*\?\s*null\s*:\s*tab\.id\s*\)/,
    );
  });

  it("the close-X button sets activeTabId to null", () => {
    expect(railSrc).toMatch(/onClick=\{\(\)\s*=>\s*onActiveTabChange\(null\)\}/);
  });

  it("the empty-state helper (`<DetailRightRailEmpty>`) is intended for panel BODIES — never auto-rendered when the panel is closed", () => {
    // The primitive does not render `<DetailRightRailEmpty>` itself.
    // It's a separate exported helper consumers compose into per-tab
    // bodies. So when the panel is closed (no body), no empty-state
    // placeholder appears either.
    expect(railSrc).not.toMatch(
      /\{!activeTab[\s\S]{0,200}?<DetailRightRailEmpty/,
    );
    expect(railSrc).not.toMatch(/<DetailRightRailEmpty[\s\S]{0,200}?\/>\s*\}\s*\)/);
  });
});

// ── 6. Active-state visual (canonical green accent bar) ────────────

describe("DetailRightRail — active-state styling", () => {
  it("active tab carries the canonical green accent bar (#76B054)", () => {
    expect(railSrc).toMatch(/isActive[\s\S]{0,400}?bg-\[#76B054\]/);
  });

  it("active tab text color is the canonical brand green (text-brand → #76B054 via CSS var)", () => {
    // 2026-05-07: the active state was migrated from the literal arbitrary
    // value `text-[#76B054]` to the canonical `text-brand` token. Same
    // rendered color (the brand CSS variable resolves to #76B054); the
    // utility name is now token-driven so a future brand re-tint flows
    // automatically.
    expect(railSrc).toMatch(/\btext-brand\b[\s\S]{0,200}?bg-white/);
  });

  it("focus ring is the canonical green at 40% opacity", () => {
    expect(railSrc).toMatch(/focus-visible:ring-\[#76B054\]\/40/);
  });
});

// ── 7. Surface contract: no domain coupling ────────────────────────

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
