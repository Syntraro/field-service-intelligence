/**
 * Right-rail tab typography — canonical token pins (2026-05-07).
 *
 * The shared vertical-icon-strip primitive at
 * `client/src/components/detail-rail/DetailRightRail.tsx` is the ONE
 * tab-button surface for both ClientDetailPage and JobDetailPage. The
 * earlier visual scale (`text-helper font-medium` on the label, same on
 * the count chip) read as "button copy" — chunky enough at the 19px
 * root font-size that the rail strip looked oversized next to the
 * panel content.
 *
 * The corrected scale uses regular-weight `text-helper` (canonical
 * 13px non-uppercase) on both the label and the count chip. Active
 * emphasis lives in color (`text-brand`) + background (`bg-white`) +
 * the left accent bar, NOT in font size or font weight. `text-label`
 * was considered but rejected — its uppercase tracking overflows the
 * 76px column on "MAINTENANCE" / "COMMUNICATIONS".
 *
 * These pins fail if a future refactor:
 *   - re-introduces `font-medium` / `font-semibold` / `font-bold` on
 *     the tab button or count chip (visual weight regresses)
 *   - swaps the canonical token for the legacy ramp
 *     (`text-xs` / `text-sm` / `text-base` / `text-lg` / `text-xl`)
 *   - re-introduces an arbitrary `text-[Npx]` value (the original
 *     `text-[11px]` / `text-[10px]` drift this primitive was extracted
 *     to fix)
 *   - drops the canonical green accent bar / `text-brand` active color /
 *     `bg-white` active background — those are the three remaining
 *     emphasis sources after weight was removed.
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
  it("uses the canonical `text-helper` token for the label", () => {
    // The button's className list contains the canonical token. The
    // tab label inherits the parent button's font-size — there is no
    // separate text-* class on the inner <span>{tab.label}</span>.
    expect(codeOnly).toMatch(/"text-helper transition-colors"/);
  });

  it("does NOT layer `font-medium` / `font-semibold` / `font-bold` on the tab button", () => {
    // The earlier `text-helper font-medium` modifier read as button
    // copy. After 2026-05-07 the weight comes purely from the role
    // token (text-helper bakes regular 400). Active emphasis lives
    // in color + bg + accent bar, not weight.
    const buttonBlockMatch = codeOnly.match(
      /relative w-full px-1 py-2[\s\S]{0,400}?text-helper transition-colors[\s\S]{0,400}?focus-visible:ring-\[#76B054\]\/40/,
    );
    expect(buttonBlockMatch, "tab button class block must contain `text-helper transition-colors`").not.toBeNull();
    const block = buttonBlockMatch?.[0] ?? "";
    expect(block).not.toMatch(/\bfont-medium\b/);
    expect(block).not.toMatch(/\bfont-semibold\b/);
    expect(block).not.toMatch(/\bfont-bold\b/);
  });

  it("does NOT use the legacy size ramp on the tab button", () => {
    // Scoped to the button class block so unrelated `text-xs` /
    // `text-sm` elsewhere in the file (none today, but defensively
    // bounded) don't false-match.
    const buttonBlockMatch = codeOnly.match(
      /relative w-full px-1 py-2[\s\S]{0,400}?text-helper transition-colors[\s\S]{0,400}?focus-visible:ring-\[#76B054\]\/40/,
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
    // The whole point of the H2 token migration was to retire the
    // earlier `text-[11px]` drift. Any new `text-[Npx]` on this
    // surface would be a regression.
    const buttonBlockMatch = codeOnly.match(
      /relative w-full px-1 py-2[\s\S]{0,400}?text-helper transition-colors[\s\S]{0,400}?focus-visible:ring-\[#76B054\]\/40/,
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

// ── 3. Active / inactive state visuals preserved ───────────────────

describe("DetailRightRail — active/inactive emphasis preserved without typography size changes", () => {
  it("active tab keeps `text-brand bg-white` (color + background — the typography-free emphasis sources)", () => {
    expect(codeOnly).toMatch(/isActive[\s\S]{0,200}?"text-brand bg-white"/);
  });

  it("inactive tab keeps `text-slate-600 hover:text-slate-900 hover:bg-white`", () => {
    expect(codeOnly).toMatch(
      /"text-slate-600 hover:text-slate-900 hover:bg-white"/,
    );
  });

  it("active accent bar (canonical green `#76B054`) is preserved as the third emphasis source", () => {
    expect(codeOnly).toMatch(/isActive\s*&&\s*\(\s*\n?\s*<span[\s\S]{0,400}?bg-\[#76B054\]/);
  });

  it("aria-pressed wiring is preserved (active state is announced semantically, not visually only)", () => {
    expect(codeOnly).toMatch(/aria-pressed=\{isActive\}/);
  });
});

// ── 4. Icon sizing aligned with typography scale ───────────────────

describe("DetailRightRail — icon scaled to typography", () => {
  it("tab icon stays at `h-4 w-4` (16px) — paired with 13px label is the canonical 16/13 icon-text ratio", () => {
    // The label is text-helper (13px / 16px line-height). 16px icon +
    // 16px line-height label is the canonical balanced ratio for
    // vertical-icon-strip nav. Bumping the icon while shrinking the
    // label (or vice versa) breaks the balance.
    expect(codeOnly).toMatch(/<Icon className="h-4 w-4" \/>/);
  });

  it("the close-X icon stays at `h-3.5 w-3.5` (it lives in the panel header, not the tab strip)", () => {
    // Sanity check — the close-X is a different surface and its size
    // is intentionally distinct from the tab icon size.
    expect(codeOnly).toMatch(/<X className="h-3\.5 w-3\.5" \/>/);
  });
});
