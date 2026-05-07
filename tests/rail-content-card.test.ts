/**
 * RailContentCard canonical primitive — source pin tests
 * (2026-05-07).
 *
 * The shared rail-content card primitive provides the canonical chrome
 * (border / radius / padding / hover / focus) used by every rail panel
 * row across JobDetailPage (Notes, Labour, Equipment) and Client
 * Detail equipment cards. These pins fail if a future refactor:
 *
 *   - moves the chrome into a per-page ad-hoc div
 *   - drops the clickable variant's hover or focus-visible affordances
 *   - couples the primitive to a specific page or domain type
 *   - changes the canonical card class string in a way that diverges
 *     from `NotesPanel` row styling on ClientDetailPage
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const PRIMITIVE = resolve(
  ROOT,
  "client/src/components/detail-rail/RailContentCard.tsx",
);
const cardSrc = readFileSync(PRIMITIVE, "utf-8");

// ── 1. Public API ──────────────────────────────────────────────────

describe("RailContentCard — public exports", () => {
  it("exports the `RailContentCard` component", () => {
    expect(cardSrc).toMatch(/export\s+function\s+RailContentCard\s*\(/);
  });

  it("exports the `RailContentCardProps` type", () => {
    expect(cardSrc).toMatch(/export\s+interface\s+RailContentCardProps\s*\{/);
  });

  it("accepts the canonical prop set: children / onClick / testId / ariaLabel / className", () => {
    expect(cardSrc).toMatch(/^\s*children:\s*ReactNode;/m);
    expect(cardSrc).toMatch(/^\s*onClick\?:\s*\(\)\s*=>\s*void;/m);
    expect(cardSrc).toMatch(/^\s*testId\?:\s*string;/m);
    expect(cardSrc).toMatch(/^\s*ariaLabel\?:\s*string;/m);
    expect(cardSrc).toMatch(/^\s*className\?:\s*string;/m);
  });
});

// ── 2. Variant contract ────────────────────────────────────────────

describe("RailContentCard — clickable / static variants", () => {
  it("when `onClick` is supplied, renders a `<button>` element", () => {
    expect(cardSrc).toMatch(
      /if\s*\(\s*onClick\s*\)\s*\{[\s\S]{0,400}?<button/,
    );
  });

  it("when `onClick` is omitted, renders a `<div>` element", () => {
    // The primitive's static fallback returns a `<div>` after the
    // `if (onClick) { return <button> }` branch.
    expect(cardSrc).toMatch(
      /\}\s*return\s*\(\s*<div/,
    );
  });

  it("clickable variant carries hover + focus-visible affordances", () => {
    expect(cardSrc).toMatch(/hover:border-slate-300/);
    expect(cardSrc).toMatch(/hover:bg-slate-50\/60/);
    expect(cardSrc).toMatch(
      /focus-visible:ring-2\s+focus-visible:ring-\[#76B054\]\/40/,
    );
  });
});

// ── 3. Canonical chrome ────────────────────────────────────────────

describe("RailContentCard — canonical card chrome", () => {
  it("uses `rounded-md`, slate border, `bg-white`, comfortable padding, subtle elevation", () => {
    // All five canonical chrome classes appear in the base class string.
    // `shadow-sm` was added 2026-05-07 so rail cards lift slightly off
    // the panel body's white background.
    expect(cardSrc).toMatch(/rounded-md/);
    expect(cardSrc).toMatch(/border\s+border-slate-200/);
    expect(cardSrc).toMatch(/\bbg-white\b/);
    expect(cardSrc).toMatch(/\bshadow-sm\b/);
    expect(cardSrc).toMatch(/px-3\s+py-2\.5/);
  });

  it("has NO domain coupling (no schema imports, no page-specific types)", () => {
    expect(cardSrc).not.toMatch(/from\s+["']@\/pages\//);
    expect(cardSrc).not.toMatch(/from\s+["']@shared\/schema["']/);
    expect(cardSrc).not.toMatch(/\bClientContact\b/);
    expect(cardSrc).not.toMatch(/\bLocationEquipment\b/);
    expect(cardSrc).not.toMatch(/\bTimeEntryDisplay\b/);
  });

  it("has NO state, NO data fetching, NO mutations", () => {
    expect(cardSrc).not.toMatch(/\buseState\b/);
    expect(cardSrc).not.toMatch(/\buseQuery\b/);
    expect(cardSrc).not.toMatch(/\buseMutation\b/);
  });
});
