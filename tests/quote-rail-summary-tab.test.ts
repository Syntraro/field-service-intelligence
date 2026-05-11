/**
 * Quote Detail right rail — Summary tab source-pin tests (2026-05-10).
 *
 * Verifies the Summary tab in QuoteDetailPage's canonical right rail:
 *   - Tab exists as first tab, default open
 *   - Builder function declared and wired to RailPanelRenderer
 *   - Shared buildFinancialSummaryContent helper invoked (not duplicated)
 *   - quoteProfitSummary useMemo derived from lines
 *   - Revenue + Cost breakdown rows with correct testIds
 *   - Shared helper: KPI hero, bar, semantic color tokens, profit total
 *   - Existing Notes / References / Activity tabs unaffected
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const QUOTE_DETAIL = resolve(ROOT, "client/src/pages/QuoteDetailPage.tsx");
const HELPER = resolve(ROOT, "client/src/components/detail-rail/buildFinancialSummaryContent.tsx");

const quoteSrc = readFileSync(QUOTE_DETAIL, "utf-8");
const helperSrc = readFileSync(HELPER, "utf-8");

// Extract the builder function body for scoped assertions.
const builderStart = quoteSrc.indexOf("const buildQuoteSummaryPanelDescriptor");
const builderEnd = quoteSrc.indexOf("\n  };", builderStart) + 5;
const builderSrc = quoteSrc.slice(builderStart, builderEnd);

// ── 1. Tab existence, default, and type ───────────────────────────

describe("QuoteDetailPage Summary tab — existence and default", () => {
  it("declares `id: \"summary\"` as the first tab in quoteRailTabs", () => {
    const arrStart = quoteSrc.indexOf("const quoteRailTabs:");
    expect(arrStart).toBeGreaterThan(-1);
    const arrEnd = quoteSrc.indexOf("];", arrStart);
    const firstId = quoteSrc.slice(arrStart, arrEnd).match(/\bid:\s*"(\w+)"/)?.[1];
    expect(firstId).toBe("summary");
  });

  it("Summary tab carries label \"Summary\", DollarSign icon, stable testId", () => {
    expect(quoteSrc).toMatch(
      /id:\s*"summary"[\s\S]{0,400}?label:\s*"Summary"[\s\S]{0,400}?icon:\s*DollarSign[\s\S]{0,400}?testId:\s*"quote-rail-tab-summary"/,
    );
  });

  it("default open tab is \"summary\"", () => {
    expect(quoteSrc).toMatch(
      /useState<QuoteRailTab\s*\|\s*null>\(\s*"summary"\s*\)/,
    );
  });

  it("QuoteRailTab type union includes \"summary\" as first member", () => {
    expect(quoteSrc).toMatch(/type\s+QuoteRailTab\s*=\s*"summary"\s*\|/);
  });
});

// ── 2. Summary tab content — RailPanelRenderer wiring ─────────────

describe("QuoteDetailPage Summary tab — RailPanelRenderer wiring", () => {
  it("Summary tab mounts <RailPanelRenderer> inside data-testid=\"card-summary\"", () => {
    expect(quoteSrc).toMatch(
      /id:\s*"summary"[\s\S]{0,1000}?data-testid="card-summary"[\s\S]{0,800}?<RailPanelRenderer/,
    );
  });

  it("Summary panel uses testIdPrefix=\"quote-summary\"", () => {
    const idx = quoteSrc.indexOf('data-testid="card-summary"');
    expect(idx).toBeGreaterThan(-1);
    const slice = quoteSrc.slice(idx, idx + 300);
    expect(slice).toMatch(/testIdPrefix="quote-summary"/);
  });

  it("descriptor builder is named buildQuoteSummaryPanelDescriptor, returns RailPanelDescriptor", () => {
    expect(quoteSrc).toMatch(
      /const\s+buildQuoteSummaryPanelDescriptor\s*=\s*\(\s*\)\s*:\s*RailPanelDescriptor/,
    );
  });

  it("descriptor kind is \"list\" with testId \"quote-summary-panel\"", () => {
    expect(builderSrc).toMatch(/kind:\s*"list"/);
    expect(builderSrc).toMatch(/testId:\s*"quote-summary-panel"/);
  });
});

// ── 3. Shared helper — no inline JSX duplication ──────────────────

describe("QuoteDetailPage Summary tab — shared helper invocation", () => {
  it("builder invokes buildFinancialSummaryContent (not inlining JSX)", () => {
    expect(builderSrc).toMatch(/buildFinancialSummaryContent\(/);
  });

  it("passes marginTestId, marginBarTestId, profitTestId to the helper", () => {
    expect(builderSrc).toMatch(/"quote-summary-margin-pct"/);
    expect(builderSrc).toMatch(/"quote-summary-margin-bar"/);
    expect(builderSrc).toMatch(/"quote-summary-profit"/);
  });

  it("passes Revenue and Cost row testIds to the helper", () => {
    expect(builderSrc).toMatch(/"quote-summary-revenue"/);
    expect(builderSrc).toMatch(/"quote-summary-cost"/);
  });
});

// ── 4. quoteProfitSummary useMemo ──────────────────────────────────

describe("QuoteDetailPage Summary tab — quoteProfitSummary derivation", () => {
  it("quoteProfitSummary useMemo is declared (no new useQuery)", () => {
    expect(quoteSrc).toMatch(/const\s+quoteProfitSummary\s*=\s*useMemo\(/);
  });

  it("quoteProfitSummary reads from details?.lines with unitPrice + unitCost", () => {
    const memoStart = quoteSrc.indexOf("const quoteProfitSummary = useMemo(");
    expect(memoStart).toBeGreaterThan(-1);
    const memoEnd = quoteSrc.indexOf("}, [details?.lines]);", memoStart) + 22;
    const memoSrc = quoteSrc.slice(memoStart, memoEnd);
    // body references lines (via local alias) and the dep array closes on details?.lines
    expect(memoSrc).toMatch(/details\?\.lines/);
    expect(memoSrc).toMatch(/unitPrice/);
    expect(memoSrc).toMatch(/unitCost/);
  });

  it("builder reads margin and profit from quoteProfitSummary", () => {
    expect(builderSrc).toMatch(/quoteProfitSummary\.margin/);
    expect(builderSrc).toMatch(/quoteProfitSummary\.profit/);
    expect(builderSrc).toMatch(/quoteProfitSummary\.totalPrice/);
    expect(builderSrc).toMatch(/quoteProfitSummary\.totalCost/);
  });
});

// ── 5. Shared helper — canonical JSX patterns ─────────────────────

describe("buildFinancialSummaryContent helper — canonical KPI layout", () => {
  it("helper file exports buildFinancialSummaryContent function", () => {
    expect(helperSrc).toMatch(/export\s+function\s+buildFinancialSummaryContent/);
  });

  it("margin % uses text-header canonical token", () => {
    expect(helperSrc).toMatch(/text-header/);
  });

  it("eyebrow uses text-label canonical token", () => {
    expect(helperSrc).toMatch(/text-label/);
  });

  it("breakdown rows use text-row canonical token", () => {
    expect(helperSrc).toMatch(/text-row/);
  });

  it("profit total row uses text-emphasis canonical token", () => {
    expect(helperSrc).toMatch(/text-emphasis/);
  });

  it("positive path uses text-success semantic token", () => {
    expect(helperSrc).toMatch(/isProfit\s*\?\s*"text-success"\s*:\s*"text-danger"/);
  });

  it("positive path uses bg-success for the indicator bar", () => {
    expect(helperSrc).toMatch(/isProfit\s*\?\s*"bg-success"\s*:\s*"bg-danger"/);
  });

  it("isProfit flag derived from profit >= 0", () => {
    expect(helperSrc).toMatch(/isProfit\s*=\s*profit\s*>=\s*0/);
  });

  it("bar fill clamped with Math.max / Math.min / Math.abs guard", () => {
    expect(helperSrc).toMatch(/Math\.max\(0,\s*Math\.min\(100,\s*Math\.abs\(marginPct\)\)\)/);
  });

  it("margin % display uses Math.round", () => {
    expect(helperSrc).toMatch(/Math\.round\(marginPct\)/);
  });

  it("no raw color classes in helper (no text-emerald-* / text-red-*)", () => {
    expect(helperSrc).not.toMatch(/text-emerald-\d+/);
    expect(helperSrc).not.toMatch(/text-red-\d+/);
    expect(helperSrc).not.toMatch(/text-green-\d+/);
  });
});

// ── 6. Existing tabs unaffected ────────────────────────────────────

describe("QuoteDetailPage Summary tab — existing tabs unaffected", () => {
  it("Notes tab still present with EntityNotesPanel", () => {
    expect(quoteSrc).toMatch(/id:\s*"notes"[\s\S]{0,3000}?<EntityNotesPanel/);
  });

  it("References tab still present with ReferenceFieldsSection", () => {
    expect(quoteSrc).toMatch(/id:\s*"references"[\s\S]{0,3000}?<ReferenceFieldsSection/);
  });

  it("Activity tab still present with ActivityCard", () => {
    expect(quoteSrc).toMatch(/id:\s*"activity"[\s\S]{0,3000}?<ActivityCard/);
  });

  it("tab count is FOUR (Summary + Notes + References + Activity)", () => {
    const arrStart = quoteSrc.indexOf("const quoteRailTabs:");
    const arrEnd = quoteSrc.indexOf("];", arrStart);
    const idMatches = quoteSrc.slice(arrStart, arrEnd).match(/\bid:\s*"\w+"/g) ?? [];
    expect(idMatches.length).toBe(4);
  });
});

// ── 7. No QuoteSummaryCard in Summary tab slot ────────────────────

describe("QuoteDetailPage Summary tab — QuoteSummaryCard retired from rail", () => {
  it("Summary tab slot does not mount <QuoteSummaryCard", () => {
    const summaryTabIdx = quoteSrc.indexOf('id: "summary"');
    const notesTabIdx = quoteSrc.indexOf('id: "notes"', summaryTabIdx);
    const summaryTabSlice = quoteSrc.slice(summaryTabIdx, notesTabIdx);
    expect(summaryTabSlice).not.toMatch(/<QuoteSummaryCard/);
  });

  it("QuoteSummaryCard import removed from QuoteDetailPage", () => {
    expect(quoteSrc).not.toMatch(/import.*QuoteSummaryCard/);
  });
});
