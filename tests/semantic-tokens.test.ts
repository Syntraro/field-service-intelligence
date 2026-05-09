/**
 * Semantic foreground token guard — Phase 3.1 (2026-05-09).
 *
 * Pins:
 *   1. CSS variables --success-foreground, --warning-foreground,
 *      --info-foreground exist in index.css (both :root and .dark).
 *   2. Tailwind config registers the foreground sub-keys on
 *      success / warning / info color objects.
 *   3. CanonicalDetailHeader ALERT_TONE_CLASS uses text-warning-foreground
 *      (dark amber, WCAG AA) — NOT text-warning (amber fill, 2.18:1, fails AA).
 *   4. StateBlock iconColor uses text-warning-foreground for warning tone.
 *   5. ActionMenu TONE_CLASSES uses text-warning-foreground for warning tone.
 *   6. The "Token gap" note is removed from action-menu.tsx doc comment.
 *   7. No hardcoded semantic palette classes remain in the three primitive files.
 *   8. --warning-foreground is amber-hued (hue ~20-45°) not near-black (not 222°).
 *   9. bg-warning (DEFAULT fill) is still amber fill (not changed by foreground fix).
 *  10. No canonical primitive uses bare text-warning for tonal alert/icon text.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const INDEX_CSS      = resolve(ROOT, "client/src/index.css");
const TAILWIND_CFG   = resolve(ROOT, "tailwind.config.ts");
const CDH            = resolve(ROOT, "client/src/components/detail/CanonicalDetailHeader.tsx");
const STATE_BLOCK    = resolve(ROOT, "client/src/components/ui/state-block.tsx");
const ACTION_MENU    = resolve(ROOT, "client/src/components/ui/action-menu.tsx");

const cssSrc    = readFileSync(INDEX_CSS, "utf-8");
const twSrc     = readFileSync(TAILWIND_CFG, "utf-8");
const cdhSrc    = readFileSync(CDH, "utf-8");
const sbSrc     = readFileSync(STATE_BLOCK, "utf-8");
const amSrc     = readFileSync(ACTION_MENU, "utf-8");

// ── Helper ─────────────────────────────────────────────────────────────────

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// ── 1. CSS variable existence ──────────────────────────────────────────────

describe("Phase 3.1 — semantic foreground CSS variables", () => {
  it("--success-foreground is declared in :root", () => {
    expect(cssSrc).toMatch(/--success-foreground\s*:/);
  });

  it("--warning-foreground is declared in :root", () => {
    expect(cssSrc).toMatch(/--warning-foreground\s*:/);
  });

  it("--info-foreground is declared in :root", () => {
    expect(cssSrc).toMatch(/--info-foreground\s*:/);
  });

  it("--warning-foreground uses dark text (not white) because amber is high-luminance", () => {
    // warning-foreground must be a non-white HSL value so that text on
    // amber backgrounds passes WCAG contrast. The value should NOT be
    // 0 0% 100% (white) which produces < 2.5:1 on amber-400.
    const match = cssSrc.match(/--warning-foreground\s*:\s*([^;]+);/);
    expect(match, "--warning-foreground declaration must be found").toBeTruthy();
    const value = match![1].trim();
    // White = "0 0% 100%" — reject that.
    expect(value).not.toBe("0 0% 100%");
    // Must contain a lightness value below 50% (dark) — format: H S% L%
    // Extract the third numeric token (lightness).
    const parts = value.split(/\s+/);
    expect(parts.length, "HSL triple: hue saturation lightness").toBe(3);
    const lightness = parseFloat(parts[2]);
    expect(lightness, "--warning-foreground lightness must be < 50% (dark text)").toBeLessThan(50);
  });

  it("--warning-foreground is amber-hued (hue 20–45°), not near-black (hue 222°)", () => {
    // Near-black (222 47% 11%) would pass contrast but lose semantic amber meaning.
    // Dark amber (hue ~20-45°) keeps tonal identity AND passes WCAG AA (~4.88:1).
    const match = cssSrc.match(/--warning-foreground\s*:\s*([^;/\n]+)/);
    expect(match, "--warning-foreground must be found in :root").toBeTruthy();
    const hue = parseFloat(match![1].trim().split(/\s+/)[0]);
    expect(hue, "--warning-foreground hue must be amber-range (20–45°)").toBeGreaterThanOrEqual(20);
    expect(hue, "--warning-foreground hue must be amber-range (20–45°)").toBeLessThanOrEqual(45);
  });

  it("--success-foreground and --info-foreground are declared in .dark block", () => {
    const darkBlock = cssSrc.match(/\.dark\s*\{([\s\S]+?)\}/)?.[1] ?? "";
    expect(darkBlock).toMatch(/--success-foreground\s*:/);
    expect(darkBlock).toMatch(/--info-foreground\s*:/);
  });

  it("--warning-foreground is declared in .dark block", () => {
    const darkBlock = cssSrc.match(/\.dark\s*\{([\s\S]+?)\}/)?.[1] ?? "";
    expect(darkBlock).toMatch(/--warning-foreground\s*:/);
  });

  it("dark mode --warning-foreground is amber-hued (not near-black)", () => {
    const darkBlock = cssSrc.match(/\.dark\s*\{([\s\S]+?)\}/)?.[1] ?? "";
    const match = darkBlock.match(/--warning-foreground\s*:\s*([^;/\n]+)/);
    expect(match, "--warning-foreground must be in .dark block").toBeTruthy();
    const hue = parseFloat(match![1].trim().split(/\s+/)[0]);
    expect(hue, "dark --warning-foreground hue must be amber-range (20–45°)").toBeGreaterThanOrEqual(20);
    expect(hue, "dark --warning-foreground hue must be amber-range (20–45°)").toBeLessThanOrEqual(45);
  });
});

// ── 2. Tailwind color config ────────────────────────────────────────────────

describe("Phase 3.1 — Tailwind semantic color utilities", () => {
  it("success is a nested object with DEFAULT and foreground sub-keys", () => {
    expect(twSrc).toMatch(/success\s*:\s*\{/);
    expect(twSrc).toMatch(/success[\s\S]{0,200}foreground:\s*"hsl\(var\(--success-foreground\)/);
  });

  it("warning is a nested object with DEFAULT and foreground sub-keys", () => {
    expect(twSrc).toMatch(/warning\s*:\s*\{/);
    expect(twSrc).toMatch(/warning[\s\S]{0,200}foreground:\s*"hsl\(var\(--warning-foreground\)/);
  });

  it("info is a nested object with DEFAULT and foreground sub-keys", () => {
    expect(twSrc).toMatch(/info\s*:\s*\{/);
    expect(twSrc).toMatch(/info[\s\S]{0,200}foreground:\s*"hsl\(var\(--info-foreground\)/);
  });

  it("success DEFAULT still uses --success (fill color unchanged)", () => {
    expect(twSrc).toMatch(/success[\s\S]{0,100}DEFAULT\s*:\s*"hsl\(var\(--success\)/);
  });

  it("warning DEFAULT still uses --warning (fill color unchanged)", () => {
    expect(twSrc).toMatch(/warning[\s\S]{0,100}DEFAULT\s*:\s*"hsl\(var\(--warning\)/);
  });

  it("info DEFAULT still uses --info (fill color unchanged)", () => {
    expect(twSrc).toMatch(/info[\s\S]{0,100}DEFAULT\s*:\s*"hsl\(var\(--info\)/);
  });
});

// ── 3. CanonicalDetailHeader ALERT_TONE_CLASS ──────────────────────────────

describe("Phase 3.1 — CanonicalDetailHeader ALERT_TONE_CLASS", () => {
  it("warning uses text-warning-foreground (dark amber, WCAG AA) not text-warning (amber fill)", () => {
    const code = stripComments(cdhSrc);
    expect(code).toMatch(/warning\s*:\s*"text-warning-foreground"/);
    expect(code).not.toMatch(/warning\s*:\s*"text-warning"/);
  });

  it("contains text-info (semantic) not text-blue-*", () => {
    const code = stripComments(cdhSrc);
    expect(code).toMatch(/info\s*:\s*"text-info"/);
    expect(code).not.toMatch(/text-blue-\d/);
  });

  it("contains text-success (semantic) not text-emerald-*", () => {
    const code = stripComments(cdhSrc);
    expect(code).toMatch(/success\s*:\s*"text-success"/);
    expect(code).not.toMatch(/text-emerald-/);
  });

  it("error tone still uses text-destructive", () => {
    expect(cdhSrc).toMatch(/error\s*:\s*"text-destructive"/);
  });

  it("no hardcoded semantic palette classes remain in ALERT_TONE_CLASS", () => {
    const code = stripComments(cdhSrc);
    const toneBlock = code.match(/ALERT_TONE_CLASS[^=]*=\s*\{[^}]+\}/)?.[0] ?? "";
    expect(toneBlock, "ALERT_TONE_CLASS block must be found").toBeTruthy();
    expect(toneBlock).not.toMatch(/text-(amber|emerald|blue|sky|rose|red|green|indigo|purple|teal|cyan|orange|yellow)-\d/);
  });

  it("ALERT_TONE_CLASS does not use bare text-warning (amber fill token)", () => {
    const code = stripComments(cdhSrc);
    const toneBlock = code.match(/ALERT_TONE_CLASS[^=]*=\s*\{[^}]+\}/)?.[0] ?? "";
    expect(toneBlock, "ALERT_TONE_CLASS block must be found").toBeTruthy();
    // bare "text-warning" (without -foreground) must not appear in the tone map
    expect(toneBlock).not.toMatch(/"text-warning"/);
  });
});

// ── 4. StateBlock iconColor function ───────────────────────────────────────

describe("Phase 3.1 — StateBlock iconColor uses semantic tokens", () => {
  it("warning case returns text-warning-foreground (dark amber) not text-warning (amber fill)", () => {
    const code = stripComments(sbSrc);
    expect(code).toMatch(/case\s+"warning"\s*:\s*return\s+"text-warning-foreground"/);
    expect(code).not.toMatch(/case\s+"warning"\s*:\s*return\s+"text-warning"/);
  });

  it("info case returns text-info (not text-sky-* / text-blue-*)", () => {
    const code = stripComments(sbSrc);
    expect(code).toMatch(/case\s+"info"\s*:\s*return\s+"text-info"/);
    expect(code).not.toMatch(/text-sky-\d/);
  });

  it("danger case still returns text-destructive", () => {
    expect(sbSrc).toMatch(/case\s+"danger"\s*:\s*return\s+"text-destructive"/);
  });

  it("no hardcoded palette color classes in iconColor function", () => {
    const code = stripComments(sbSrc);
    const fnBody = code.match(/function\s+iconColor[\s\S]{0,400}(?=\n\nfunction|\n\/\/ ─|$)/)?.[0] ?? "";
    expect(fnBody, "iconColor function body must be found").toBeTruthy();
    expect(fnBody).not.toMatch(/text-(amber|emerald|blue|sky|rose|red|green|indigo|purple|teal|cyan|orange|yellow)-\d/);
  });

  it("iconColor does not use bare text-warning", () => {
    const code = stripComments(sbSrc);
    const fnBody = code.match(/function\s+iconColor[\s\S]{0,400}(?=\n\nfunction|\n\/\/ ─|$)/)?.[0] ?? "";
    expect(fnBody, "iconColor function body must be found").toBeTruthy();
    expect(fnBody).not.toMatch(/"text-warning"/);
  });
});

// ── 5. ActionMenu TONE_CLASSES ─────────────────────────────────────────────

describe("Phase 3.1 — ActionMenu TONE_CLASSES uses semantic utilities", () => {
  it("success tone uses text-success / focus:text-success", () => {
    expect(amSrc).toMatch(/success\s*:\s*"text-success focus:text-success"/);
  });

  it("warning tone uses text-warning-foreground / focus:text-warning-foreground (dark amber, WCAG AA)", () => {
    expect(amSrc).toMatch(/warning\s*:\s*"text-warning-foreground focus:text-warning-foreground"/);
    expect(amSrc).not.toMatch(/warning\s*:\s*"text-warning focus:text-warning"/);
  });

  it("info tone uses text-info / focus:text-info", () => {
    expect(amSrc).toMatch(/info\s*:\s*"text-info focus:text-info"/);
  });

  it("destructive tone uses text-destructive / focus:text-destructive", () => {
    expect(amSrc).toMatch(/destructive\s*:\s*"text-destructive focus:text-destructive"/);
  });

  it("TONE_CLASSES has no hardcoded palette classes", () => {
    const code = stripComments(amSrc);
    const toneBlock = code.match(/TONE_CLASSES[^=]*=\s*\{[^}]+\}/)?.[0] ?? "";
    expect(toneBlock, "TONE_CLASSES block must be found").toBeTruthy();
    expect(toneBlock).not.toMatch(/text-(amber|emerald|blue|sky|rose|red|green|indigo|purple|teal|cyan|orange|yellow)-\d/);
  });

  it("the 'Token gap' note is removed from the doc comment", () => {
    expect(amSrc).not.toMatch(/Token gap/);
  });
});

// ── 6. No new hardcoded semantic palette leaks ─────────────────────────────

describe("Phase 3.1 — no new hardcoded semantic palette classes in canonical primitives", () => {
  const PALETTE_RE = /text-(amber|emerald|blue|sky|rose|red|green|indigo|purple|teal|cyan|orange|yellow)-\d/;

  it("CanonicalDetailHeader has no hardcoded semantic palette text classes", () => {
    const code = stripComments(cdhSrc);
    expect(PALETTE_RE.test(code)).toBe(false);
  });

  it("StateBlock has no hardcoded semantic palette text classes", () => {
    const code = stripComments(sbSrc);
    expect(PALETTE_RE.test(code)).toBe(false);
  });

  it("ActionMenu has no hardcoded semantic palette text classes", () => {
    const code = stripComments(amSrc);
    expect(PALETTE_RE.test(code)).toBe(false);
  });
});

// ── 7. bg-warning fill orientation (chip fills must remain amber) ──────────

describe("Phase 3.1 — bg-warning preserves amber fill (chip backgrounds)", () => {
  it("tailwind warning DEFAULT points to --warning fill (not --warning-foreground)", () => {
    // This ensures bg-warning stays amber for EntityChip pills.
    // The foreground fix must NOT change the DEFAULT color entry.
    expect(twSrc).toMatch(/warning[\s\S]{0,100}DEFAULT\s*:\s*"hsl\(var\(--warning\)\s*\//);
  });

  it("--warning in index.css remains amber fill (hue 20-50°, high saturation)", () => {
    const match = cssSrc.match(/--warning\s*:\s*([^;/\n]+)/);
    expect(match, "--warning fill token must exist").toBeTruthy();
    const hue = parseFloat(match![1].trim().split(/\s+/)[0]);
    expect(hue, "--warning hue must be amber-range (20–50°)").toBeGreaterThanOrEqual(20);
    expect(hue, "--warning hue must be amber-range (20–50°)").toBeLessThanOrEqual(50);
  });
});
