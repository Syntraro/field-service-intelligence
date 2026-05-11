/**
 * Right-rail tab typography — canonical token pins (2026-05-07,
 * updated 2026-05-11 for top-tab horizontal layout).
 *
 * The shared top-tab navigation primitive at
 * `client/src/components/detail-rail/DetailRightRail.tsx` is the ONE
 * tab-button surface for all detail pages. The layout changed from a
 * vertical icon strip to a horizontal top-tab bar in 2026-05-11.
 *
 * Typography rules (unchanged from 2026-05-07):
 *   - regular-weight `text-helper` (canonical 13px non-uppercase) on
 *     both the label and the count chip.
 *   - Active emphasis lives in color (`text-brand`) + bottom-border
 *     underline (`border-[#76B054]`) — NOT font size or weight.
 *
 * These pins fail if a future refactor:
 *   - re-introduces `font-medium` / `font-semibold` / `font-bold` on
 *     the tab button or count chip (visual weight regresses)
 *   - swaps the canonical token for the legacy ramp
 *     (`text-xs` / `text-sm` / `text-base` / `text-lg` / `text-xl`)
 *   - re-introduces an arbitrary `text-[Npx]` value
 *   - drops `text-brand` active color or `border-[#76B054]` underline
 *   - re-introduces the old left-side `bg-[#76B054]` accent bar span
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

/** Strip block + line comments so doc text doesn't false-match. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const codeOnly = stripComments(railSrc);

// ── 1. Canonical token usage ───────────────────────────────────────

describe("DetailRightRail — tab button typography", () => {
  it("uses the canonical `text-helper` token on the tab button class block", () => {
    // The button's className list contains the canonical token.
    // px-2.5 py-2 is the horizontal tab padding; text-helper is 13px.
    expect(codeOnly).toMatch(/"px-2\.5 py-2 text-helper transition-colors"/);
  });

  it("does NOT layer `font-medium` / `font-semibold` / `font-bold` on the tab button", () => {
    const buttonBlockMatch = codeOnly.match(
      /px-2\.5 py-2 text-helper transition-colors[\s\S]{0,400}?focus-visible:ring-\[#76B054\]\/40/,
    );
    expect(buttonBlockMatch, "tab button class block must contain `px-2.5 py-2 text-helper transition-colors`").not.toBeNull();
    const block = buttonBlockMatch?.[0] ?? "";
    expect(block).not.toMatch(/\bfont-medium\b/);
    expect(block).not.toMatch(/\bfont-semibold\b/);
    expect(block).not.toMatch(/\bfont-bold\b/);
  });

  it("does NOT use the legacy size ramp on the tab button", () => {
    const buttonBlockMatch = codeOnly.match(
      /px-2\.5 py-2 text-helper transition-colors[\s\S]{0,400}?focus-visible:ring-\[#76B054\]\/40/,
    );
    const block = buttonBlockMatch?.[0] ?? "";
    expect(block).not.toMatch(/\btext-xs\b/);
    expect(block).not.toMatch(/\btext-sm\b/);
    expect(block).not.toMatch(/\btext-base\b/);
    expect(block).not.toMatch(/\btext-lg\b/);
    expect(block).not.toMatch(/\btext-xl\b/);
    expect(block).not.toMatch(/\btext-2xl\b/);
  });

  it("does NOT use any arbitrary text-[Npx] value on the tab button", () => {
    const buttonBlockMatch = codeOnly.match(
      /px-2\.5 py-2 text-helper transition-colors[\s\S]{0,400}?focus-visible:ring-\[#76B054\]\/40/,
    );
    const block = buttonBlockMatch?.[0] ?? "";
    expect(block).not.toMatch(/\btext-\[[^\]]+\]/);
  });
});

// ── 2. Count chip rides the same scale ─────────────────────────────

describe("DetailRightRail — tab count chip typography", () => {
  it("uses canonical `text-helper` (matches the tab label scale, no weight bump)", () => {
    expect(codeOnly).toMatch(
      /className="text-helper text-slate-500 tabular-nums leading-none"/,
    );
  });

  it("does NOT layer `font-medium` / `font-semibold` / `font-bold` on the count chip", () => {
    const chipBlockMatch = codeOnly.match(
      /text-helper text-slate-500 tabular-nums leading-none[\s\S]{0,400}?data-testid=\{`\$\{testIdPrefix\}-tab-count-\$\{tab\.id\}`\}/,
    );
    expect(chipBlockMatch, "tab count chip class block must use `text-helper text-slate-500 tabular-nums leading-none`").not.toBeNull();
    const block = chipBlockMatch?.[0] ?? "";
    expect(block).not.toMatch(/\bfont-medium\b/);
    expect(block).not.toMatch(/\bfont-semibold\b/);
    expect(block).not.toMatch(/\bfont-bold\b/);
  });

  it("does NOT use the legacy size ramp on the count chip", () => {
    const chipBlockMatch = codeOnly.match(
      /text-helper text-slate-500 tabular-nums leading-none[\s\S]{0,400}?data-testid=\{`\$\{testIdPrefix\}-tab-count-\$\{tab\.id\}`\}/,
    );
    const block = chipBlockMatch?.[0] ?? "";
    expect(block).not.toMatch(/\btext-xs\b/);
    expect(block).not.toMatch(/\btext-sm\b/);
    expect(block).not.toMatch(/\btext-\[[^\]]+\]/);
  });
});

// ── 3. Active / inactive state visuals ────────────────────────────

describe("DetailRightRail — active/inactive emphasis without typography size changes", () => {
  it("active tab keeps `text-brand` color token", () => {
    expect(codeOnly).toMatch(/isActive[\s\S]{0,200}?"text-brand\s+border-\[#76B054\]"/);
  });

  it("active tab uses green bottom-border underline (`border-[#76B054]`) as the visual accent", () => {
    // 2026-05-11: replaced the old left-side `bg-[#76B054]` accent bar
    // span with a `border-b-2 border-[#76B054]` bottom-underline on the
    // horizontal top tab button. Same canonical green, different surface.
    expect(codeOnly).toMatch(/isActive[\s\S]{0,400}?border-\[#76B054\]/);
  });

  it("inactive tab keeps `text-slate-600 hover:text-slate-900 border-transparent`", () => {
    expect(codeOnly).toMatch(
      /"text-slate-600 hover:text-slate-900 border-transparent"/,
    );
  });

  it("aria-pressed wiring is preserved (active state is announced semantically)", () => {
    expect(codeOnly).toMatch(/aria-pressed=\{isActive\}/);
  });

  it("does NOT render the old vertical accent bar `<span bg-[#76B054]>` element", () => {
    // The old pattern: isActive && (<span className="... bg-[#76B054]" />)
    // Replaced by the horizontal tab's border-b-2 bottom underline.
    expect(codeOnly).not.toMatch(
      /isActive\s*&&\s*\(\s*\n?\s*<span[\s\S]{0,200}?bg-\[#76B054\]/,
    );
  });
});

// ── 4. Icon in collapsed strip only (not in expanded tab labels) ───

describe("DetailRightRail — icon usage", () => {
  it("the close-X icon stays at `h-3.5 w-3.5`", () => {
    expect(codeOnly).toMatch(/<X className="h-3\.5 w-3\.5" \/>/);
  });

  it("the expand ChevronLeft icon in collapsed strip is `h-4 w-4`", () => {
    expect(codeOnly).toMatch(/<ChevronLeft className="h-4 w-4" \/>/);
  });

  it("expanded top-tab buttons do NOT render an `<Icon>` element", () => {
    // In the old vertical strip each button rendered `<Icon className="h-4 w-4" />`.
    // In the new horizontal tabs, only text labels are shown in the
    // expanded panel header — icons are not used in the top-tab row.
    expect(codeOnly).not.toMatch(/<Icon className="h-4 w-4" \/>/);
  });
});
