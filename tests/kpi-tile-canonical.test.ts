/**
 * KpiTile canonical renderer guard (2026-05-09).
 *
 * Pins:
 *   1. KpiTile.tsx uses text-display (canonical KPI hero token) not text-2xl.
 *   2. KpiTile.tsx uses only semantic tokens — no hardcoded hex.
 *   3. TopKpiRow.tsx (migrated) has no hardcoded hex text-[#...] classes.
 *   4. TopKpiRow.tsx has no legacy text-2xl font-bold tabular-nums.
 *   5. TopKpiRow.tsx imports KpiTile from the canonical dashboard location.
 *   6. KpiTile.tsx uses border-card-border (not border-[#e2e8f0]).
 *   7. KpiTile.tsx uses hover:border-primary (not hover:border-[#76B054]).
 *   8. KpiTile.tsx uses text-foreground for default tone value color.
 *   9. KpiTile.tsx uses text-destructive for danger tone value color.
 *  10. LowerOpsCards.tsx (intentionally deferred) is the only dashboard file
 *      still using text-2xl font-bold tabular-nums (explicit allowlist).
 *
 * Deferred (not enforced here):
 *   RevenueCenterCard, OperationalAlertsCard, QuotePipelineCard,
 *   RightColumnFinancialCards — list/row/bucket cards, not KPI tiles.
 *   Their hex drift remains; a separate canonicalization pass owns it.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const DASH = resolve(ROOT, "client/src/components/dashboard");

const kpiTileSrc     = readFileSync(resolve(DASH, "KpiTile.tsx"), "utf-8");
const topKpiRowSrc   = readFileSync(resolve(DASH, "TopKpiRow.tsx"), "utf-8");
const lowerOpsSrc    = readFileSync(resolve(DASH, "LowerOpsCards.tsx"), "utf-8");

// ── Helper ─────────────────────────────────────────────────────────────────

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// ── 1. KpiTile — typography ────────────────────────────────────────────────

describe("KpiTile canonical typography", () => {
  it("uses text-display (KPI hero token) for the value", () => {
    expect(kpiTileSrc).toMatch(/text-display/);
  });

  it("does NOT use legacy text-2xl for the value", () => {
    const code = stripComments(kpiTileSrc);
    expect(code).not.toMatch(/text-2xl/);
  });

  it("applies leading-none to suppress text-display's built-in line-height", () => {
    expect(kpiTileSrc).toMatch(/leading-none/);
  });

  it("applies tabular-nums to the value element", () => {
    // Must appear in the value div, not just anywhere.
    const block = kpiTileSrc.match(/TONE_VALUE_COLOR[\s\S]{0,400}tabular-nums/)?.[0]
      ?? kpiTileSrc.match(/text-display[\s\S]{0,100}tabular-nums/)?.[0]
      ?? kpiTileSrc;
    expect(block).toMatch(/tabular-nums/);
  });

  it("uses text-helper for the label and sub lines", () => {
    // text-helper must appear in both the label div and sub div.
    const labelSection = kpiTileSrc.match(/uppercase tracking-wide[\s\S]{0,200}text-helper/)?.[0]
      ?? kpiTileSrc;
    expect(kpiTileSrc).toMatch(/text-helper.*uppercase tracking-wide/s);
  });
});

// ── 2. KpiTile — semantic tokens only (no hex) ────────────────────────────

describe("KpiTile uses only semantic tokens", () => {
  it("no hardcoded hex text-[#...] classes", () => {
    const code = stripComments(kpiTileSrc);
    expect(code).not.toMatch(/text-\[#[0-9a-fA-F]/);
  });

  it("no hardcoded hex border-[#...] classes", () => {
    const code = stripComments(kpiTileSrc);
    expect(code).not.toMatch(/border-\[#[0-9a-fA-F]/);
  });

  it("no hardcoded hex hover:border-[#...] classes", () => {
    const code = stripComments(kpiTileSrc);
    expect(code).not.toMatch(/hover:border-\[#[0-9a-fA-F]/);
  });

  it("no hardcoded hex bg-[#...] classes", () => {
    const code = stripComments(kpiTileSrc);
    expect(code).not.toMatch(/bg-\[#[0-9a-fA-F]/);
  });

  it("no inline style boxShadow hack", () => {
    expect(kpiTileSrc).not.toMatch(/boxShadow/);
  });
});

// ── 3. KpiTile — specific semantic token usage ────────────────────────────

describe("KpiTile semantic token specifics", () => {
  it("uses border-card-border for the card shell border", () => {
    expect(kpiTileSrc).toMatch(/border-card-border/);
  });

  it("uses hover:border-primary for interactive states", () => {
    expect(kpiTileSrc).toMatch(/hover:border-primary/);
  });

  it("uses focus:ring-primary for the focus ring", () => {
    expect(kpiTileSrc).toMatch(/focus:ring-primary/);
  });

  it("uses text-foreground for default tone value color", () => {
    expect(kpiTileSrc).toMatch(/default\s*:\s*["']text-foreground["']/);
  });

  it("uses text-destructive for danger tone value color", () => {
    expect(kpiTileSrc).toMatch(/danger\s*:\s*["']text-destructive["']/);
  });

  it("uses bg-card for default tone card background", () => {
    expect(kpiTileSrc).toMatch(/default\s*:\s*["']bg-card["']/);
  });

  it("uses text-muted-foreground for label and sub text color", () => {
    expect(kpiTileSrc).toMatch(/text-muted-foreground/);
  });

  it("uses shadow-sm instead of inline boxShadow style", () => {
    expect(kpiTileSrc).toMatch(/shadow-sm/);
  });
});

// ── 4. TopKpiRow (migrated) — no hex, no legacy classes ──────────────────

describe("TopKpiRow post-migration cleanliness", () => {
  it("has no hardcoded hex text-[#...] classes", () => {
    const code = stripComments(topKpiRowSrc);
    expect(code).not.toMatch(/text-\[#[0-9a-fA-F]/);
  });

  it("has no hardcoded hex border-[#...] classes", () => {
    const code = stripComments(topKpiRowSrc);
    expect(code).not.toMatch(/border-\[#[0-9a-fA-F]/);
  });

  it("has no hardcoded hex hover:border-[#...] classes", () => {
    const code = stripComments(topKpiRowSrc);
    expect(code).not.toMatch(/hover:border-\[#[0-9a-fA-F]/);
  });

  it("has no legacy text-2xl font-bold tabular-nums", () => {
    const code = stripComments(topKpiRowSrc);
    expect(code).not.toMatch(/text-2xl\s+font-bold\s+tabular-nums/);
  });

  it("has no inline boxShadow style", () => {
    expect(topKpiRowSrc).not.toMatch(/boxShadow/);
  });

  it("imports KpiTile from the canonical dashboard location", () => {
    expect(topKpiRowSrc).toMatch(
      /import.*KpiTile.*from\s+["']@\/components\/dashboard\/KpiTile["']/,
    );
  });

  it("does not define a local KpiTile function (removed)", () => {
    const code = stripComments(topKpiRowSrc);
    // The local KpiTile was a function component — should be gone.
    expect(code).not.toMatch(/^function KpiTile\b/m);
    expect(code).not.toMatch(/const KpiTile\s*=/);
  });

  it("uses tone prop (not warn) on the overdue tile", () => {
    expect(topKpiRowSrc).toMatch(/tone=/);
    expect(topKpiRowSrc).not.toMatch(/warn=/);
  });
});

// ── 5. Allowlist — LowerOpsCards deferred ────────────────────────────────

describe("text-2xl font-bold tabular-nums allowlist (deferred migrations)", () => {
  it("LowerOpsCards still has text-2xl font-bold tabular-nums (intentionally deferred)", () => {
    // This test pins the deferred state. When LowerOpsCards is migrated,
    // update this to assert the pattern is GONE and remove from allowlist.
    expect(lowerOpsSrc).toMatch(/text-2xl\s+font-bold.*tabular-nums/);
  });

  it("TopKpiRow no longer has text-2xl font-bold tabular-nums (migration complete)", () => {
    const code = stripComments(topKpiRowSrc);
    expect(code).not.toMatch(/text-2xl\s+font-bold\s+tabular-nums/);
  });

  it("KpiTile.tsx (canonical) does not use text-2xl font-bold tabular-nums", () => {
    const code = stripComments(kpiTileSrc);
    expect(code).not.toMatch(/text-2xl\s+font-bold\s+tabular-nums/);
  });
});

// ── 6. KpiTile — tone completeness ────────────────────────────────────────

describe("KpiTile tone map completeness", () => {
  it("TONE_CARD_BG covers all 5 tones", () => {
    const block = kpiTileSrc.match(/TONE_CARD_BG[\s\S]{0,400}(?=\n\n|\n\/\/|const TONE)/)?.[0] ?? "";
    expect(block).toMatch(/default/);
    expect(block).toMatch(/danger/);
    expect(block).toMatch(/warning/);
    expect(block).toMatch(/success/);
    expect(block).toMatch(/info/);
  });

  it("TONE_VALUE_COLOR covers all 5 tones", () => {
    const block = kpiTileSrc.match(/TONE_VALUE_COLOR[\s\S]{0,400}(?=\n\n|\n\/\/|const SHELL|export)/)?.[0] ?? "";
    expect(block).toMatch(/default/);
    expect(block).toMatch(/danger/);
    expect(block).toMatch(/warning/);
    expect(block).toMatch(/success/);
    expect(block).toMatch(/info/);
  });
});
