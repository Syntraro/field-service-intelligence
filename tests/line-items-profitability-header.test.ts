/**
 * Canonical profitability header source-pin tests (2026-05-06).
 *
 * `LineItemsCard` is the SINGLE source of truth for the line-items
 * card chrome on Quote, Invoice, and Job detail pages — including
 * the create surfaces (Create Quote, New Invoice). The header renders
 * a three-metric cluster — Full Line Revenue / Profit / Profit Margin
 * — sourced from `useLineItemsDrafts.headerMetrics`. These pins fail
 * if a future refactor:
 *
 *   - reverts to the abbreviated "Rev …" header
 *   - introduces a per-page header override (Quote / Invoice / Job
 *     must all consume the canonical `<LineItemsCard>` so the cluster
 *     renders identically)
 *   - drops or renames any of the three canonical labels
 *   - duplicates the headerMetrics calculation outside
 *     `useLineItemsDrafts.ts`
 *   - re-introduces a `m.cost !== null` (or equivalent `hasCost`) gate
 *     that hides Profit + Profit Margin on quote / invoice surfaces
 *     where unitCost isn't always present. These are pricing surfaces
 *     and margin visibility is required.
 *   - reverts the typed `HeaderMetrics` shape from `number` back to
 *     `number | null` (the hook now always emits numeric values;
 *     missing unitCost is treated as 0)
 *   - drops `unitCost` from a draft / mirror line on any of the
 *     create surfaces (CreateQuotePage / NewInvoicePage)
 *
 * Mirrors the source-pin style used in `quote-create-page.test.ts`
 * and other pin tests under `tests/`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const cardSrc = readFileSync(
  resolve(__dirname, "../client/src/components/line-items/LineItemsCard.tsx"),
  "utf-8",
);
const draftsSrc = readFileSync(
  resolve(__dirname, "../client/src/components/line-items/useLineItemsDrafts.ts"),
  "utf-8",
);
const quoteDetailSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/QuoteDetailPage.tsx"),
  "utf-8",
);
const invoiceDetailSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/InvoiceDetailPage.tsx"),
  "utf-8",
);
const jobDetailSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/JobDetailPage.tsx"),
  "utf-8",
);
const createQuoteSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/CreateQuotePage.tsx"),
  "utf-8",
);
const newInvoiceSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/NewInvoicePage.tsx"),
  "utf-8",
);
const typesSrc = readFileSync(
  resolve(__dirname, "../client/src/components/line-items/types.ts"),
  "utf-8",
);
const draftQuoteAdapterSrc = readFileSync(
  resolve(
    __dirname,
    "../client/src/components/quotes/draftQuoteLineItemsAdapter.ts",
  ),
  "utf-8",
);
const draftInvoiceAdapterSrc = readFileSync(
  resolve(
    __dirname,
    "../client/src/components/invoice/draftInvoiceLineItemsAdapter.ts",
  ),
  "utf-8",
);

// ── Canonical labels ─────────────────────────────────────────────────

describe("LineItemsCard — canonical profitability header", () => {
  it("renders the three canonical labels with the explicit business terms", () => {
    expect(cardSrc).toMatch(/label="Full Line Revenue"/);
    expect(cardSrc).toMatch(/label="Profit"/);
    expect(cardSrc).toMatch(/label="Profit Margin"/);
  });

  it("does NOT use any abbreviated forms (Rev / Margin % / GP / Gross)", () => {
    // The metric tiles are rendered via <HeaderMetricBlock label=…>;
    // these labels would surface in user-visible chrome if anyone
    // reverted to them.
    expect(cardSrc).not.toMatch(/label="Rev["\s]/);
    expect(cardSrc).not.toMatch(/label="GP["\s]/);
    expect(cardSrc).not.toMatch(/label="Gross["\s]/);
    expect(cardSrc).not.toMatch(/label="Margin %["\s]/);
    // The legacy "Rev …" inline string the abbreviated header used.
    expect(cardSrc).not.toMatch(
      /["\s]Rev\s*\{["'`]\s*\{["']\s*\}\s*\{formatCurrency/,
    );
  });

  it("ships stable test ids on the cluster + each metric tile", () => {
    expect(cardSrc).toMatch(/data-testid="text-line-items-metrics"/);
    expect(cardSrc).toMatch(/testId="metric-full-line-revenue"/);
    expect(cardSrc).toMatch(/testId="metric-profit"/);
    expect(cardSrc).toMatch(/testId="metric-profit-margin"/);
  });

  it("uses a single `revenue > 0` gate (the cluster shows on every surface that has lines)", () => {
    // `showMetrics` is the ONE conditional. There is no longer a
    // `m.cost !== null` (or `hasCost` / `showProfit`) check that
    // would hide Profit + Margin on quote / invoice surfaces.
    // The card's JSX must use `{showMetrics && (` as the gate, never
    // a `showProfit` identifier or a `m.cost !== null` check.
    expect(cardSrc).toMatch(/showMetrics\s*=\s*m\.revenue\s*>\s*0/);
    expect(cardSrc).toMatch(/\{showMetrics\s*&&\s*\(/);
    // Identifier-level pin: `showProfit` must not exist as a binding.
    expect(cardSrc).not.toMatch(/(?:const|let)\s+showProfit/);
    // JSX-level pin: no `{showProfit ...}` reference inside the JSX.
    expect(cardSrc).not.toMatch(/\{showProfit\b/);
    // No remaining `m.cost !== null` boolean expression in JSX or
    // assignments — comments describing historical behaviour are
    // allowed (they don't carry runtime effect). Pin tightly so a
    // future refactor that re-introduces the gate fails this test.
    expect(cardSrc).not.toMatch(/&&\s*m\.cost\s*!==\s*null/);
    expect(cardSrc).not.toMatch(/=\s*m\.cost\s*!==\s*null/);
  });

  it("renders Full Line Revenue, Profit, and Profit Margin together (no nested showProfit guard)", () => {
    // All three tiles sit inside the same conditional `{showMetrics && (`.
    // A nested guard around Profit / Margin would re-introduce the
    // hide-on-no-cost regression on Quote / Invoice surfaces.
    expect(cardSrc).toMatch(
      /\{showMetrics\s*&&\s*\([\s\S]*?testId="metric-full-line-revenue"[\s\S]*?testId="metric-profit"[\s\S]*?testId="metric-profit-margin"[\s\S]*?\)\}/,
    );
  });

  it("uses `formatCurrency(m.revenue)` and `formatCurrency(m.profit)` without recomputation", () => {
    // Revenue and Profit values come straight from the canonical
    // `headerMetrics` source — no inline `qty * price` math in the
    // card's JSX, no `?? 0` defaulting (the hook always emits numeric).
    expect(cardSrc).toMatch(/value=\{formatCurrency\(m\.revenue\)\}/);
    expect(cardSrc).toMatch(/value=\{formatCurrency\(m\.profit\)\}/);
  });

  it("Profit Margin uses two decimal places (matches business KPI display)", () => {
    expect(cardSrc).toMatch(/m\.margin\.toFixed\(2\)/);
  });

  it("Profit Margin tile carries `emphasis` so it reads as the headline KPI", () => {
    expect(cardSrc).toMatch(
      /label="Profit Margin"[\s\S]{0,300}?emphasis/,
    );
  });

  it("Profit + Profit Margin tiles share the same green/red token (canonical emerald / rose)", () => {
    // `profitToneClass` is the single derivation; both tiles read it.
    expect(cardSrc).toMatch(
      /profitToneClass\s*=[\s\S]{0,160}?text-emerald-700[\s\S]{0,40}?text-rose-600/,
    );
    expect(cardSrc.match(/valueClassName=\{profitToneClass\}/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("Full Line Revenue tile uses the muted slate token (no green/red on revenue)", () => {
    // The revenue block does not pass valueClassName, so it falls
    // through to the default text-slate-700.
    expect(cardSrc).toMatch(
      /label="Full Line Revenue"[\s\S]{0,300}?testId="metric-full-line-revenue"/,
    );
  });

  it("the cluster wraps responsively (flex-wrap) so the edit pencil never gets pushed off-screen", () => {
    // The className declaring `flex-wrap` sits a few lines above the
    // `data-testid="text-line-items-metrics"` attribute on the same
    // wrapping div — pin the proximity in either source order.
    expect(cardSrc).toMatch(
      /flex-wrap[\s\S]{0,200}?data-testid="text-line-items-metrics"|data-testid="text-line-items-metrics"[\s\S]{0,200}?flex-wrap/,
    );
  });

  it("HeaderMetricBlock label uses the canonical 10px / uppercase / tracked / muted slate token", () => {
    expect(cardSrc).toMatch(
      /text-\[10px\]\s+font-bold\s+uppercase\s+tracking-\[0\.08em\]\s+text-slate-500/,
    );
  });
});

// ── Single source of truth for the calculation ──────────────────────

describe("useLineItemsDrafts — sole owner of headerMetrics", () => {
  it("computes revenue / cost / profit / margin in one place", () => {
    expect(draftsSrc).toMatch(/const headerMetrics:\s*HeaderMetrics/);
    expect(draftsSrc).toMatch(/profit\s*=\s*revenue\s*-\s*cost/);
    expect(draftsSrc).toMatch(/margin\s*=\s*revenue\s*>\s*0/);
  });

  it("always returns numeric cost / profit / margin (never null)", () => {
    // The hook used to gate Profit + Margin behind a `hasCost` flag
    // and return null cost / profit / margin when no row carried a
    // positive unitCost. That hid the KPIs on quote / invoice
    // pricing surfaces. The new contract: cost defaults to 0; the
    // single return is `{ revenue, cost, profit, margin }` — all
    // numeric.
    expect(draftsSrc).not.toMatch(/return\s*\{\s*revenue,\s*cost:\s*null/);
    expect(draftsSrc).not.toMatch(/hasCost/);
    expect(draftsSrc).toMatch(/return\s*\{\s*revenue,\s*cost,\s*profit,\s*margin\s*\}/);
  });

  it("treats absent / blank unitCost as zero (does NOT hide the metrics)", () => {
    // Existing per-row guard preserved: blank/null/non-numeric cost
    // values clamp to 0 (parseMoney) without contributing negative
    // numbers. The cumulative `cost` accumulator starts at 0 so the
    // final metric block emits a valid (revenue, profit=revenue,
    // margin=100%) triplet when no row carries cost.
    expect(draftsSrc).toMatch(
      /if\s*\(row\.unitCost\s*!=\s*null\s*&&\s*row\.unitCost\s*!==\s*""\)\s*\{[\s\S]*?if\s*\(c\s*>\s*0\)\s*cost\s*\+=\s*qty\s*\*\s*c/,
    );
  });

  it("margin guards divide-by-zero (revenue ≤ 0 returns 0%)", () => {
    expect(draftsSrc).toMatch(
      /revenue\s*>\s*0\s*\?\s*\(profit\s*\/\s*revenue\)\s*\*\s*100\s*:\s*0/,
    );
  });

  it("HeaderMetrics type declares cost / profit / margin as `number` (not `number | null`)", () => {
    // The type used to allow null on cost / profit / margin which
    // let the LineItemsCard infer that hiding was a valid state.
    // After this PR they're all required `number` — the hook
    // contract enforces always-emit.
    expect(typesSrc).toMatch(/cost:\s*number;/);
    expect(typesSrc).toMatch(/profit:\s*number;/);
    expect(typesSrc).toMatch(/margin:\s*number;/);
    expect(typesSrc).not.toMatch(/cost:\s*number\s*\|\s*null/);
    expect(typesSrc).not.toMatch(/profit:\s*number\s*\|\s*null/);
    expect(typesSrc).not.toMatch(/margin:\s*number\s*\|\s*null/);
  });

  it("does NOT duplicate the headerMetrics calc anywhere else in client/src", () => {
    // Crude but effective: nothing else should declare a local
    // `headerMetrics` object literal with the same shape. The canonical
    // hook is the only source.
    const offenders = [cardSrc, quoteDetailSrc, invoiceDetailSrc, jobDetailSrc, createQuoteSrc, newInvoiceSrc]
      .filter((src) => /const\s+headerMetrics:\s*HeaderMetrics\s*=/.test(src));
    expect(offenders).toEqual([]);
  });
});

// ── Adapters / mirror lines preserve unitCost end-to-end ─────────────

describe("Create surfaces — unitCost flows through draft adapters and mirror lines", () => {
  it("CreateQuotePage's makeMirrorLine accepts and persists unitCost on the synthetic mirror", () => {
    expect(createQuoteSrc).toMatch(
      /function makeMirrorLine\(args:\s*\{[\s\S]*?unitCost:\s*string\s*\|\s*null;[\s\S]*?\}\)/,
    );
    expect(createQuoteSrc).toMatch(/unitCost:\s*args\.unitCost/);
  });

  it("CreateQuotePage's onCommit reconciliation passes unitCost from the draft into the mirror", () => {
    // Both call sites — new entries (no serverId) and existing-row
    // updates — must propagate `entry.draft.unitCost`. The previous
    // implementation dropped it entirely, which was the root cause
    // of "Quote / Invoice header only shows Revenue".
    const matches = createQuoteSrc.match(
      /unitCost:\s*entry\.draft\.unitCost\s*\|\|\s*null/g,
    );
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("NewInvoicePage's makeMirrorLine accepts and persists unitCost on the synthetic mirror", () => {
    expect(newInvoiceSrc).toMatch(
      /function makeMirrorLine\(args:\s*\{[\s\S]*?unitCost:\s*string\s*\|\s*null;[\s\S]*?\}\)/,
    );
    expect(newInvoiceSrc).toMatch(/unitCost:\s*args\.unitCost/);
  });

  it("NewInvoicePage's onCommit reconciliation passes unitCost from the draft into the mirror", () => {
    expect(newInvoiceSrc).toMatch(/unitCost:\s*entry\.draft\.unitCost\s*\|\|\s*null/);
  });

  it("draft adapters do NOT strip unitCost in saveAll / validateEntry", () => {
    // The draft adapters delegate saveAll to onCommit(plan), so the
    // entry shape is whatever the parent's reconciliation reads.
    // validateEntry only enforces description + qty, not cost.
    expect(draftQuoteAdapterSrc).not.toMatch(/delete\s+\w+\.unitCost/);
    expect(draftInvoiceAdapterSrc).not.toMatch(/delete\s+\w+\.unitCost/);
  });
});

// ── Saved surfaces — hydrateDraft already brings unitCost into the
// canonical draft shape via lib/entities/lineItemMapper.ts. The
// adapters delegate to it. Pin that they don't strip cost.

describe("Saved surfaces — adapters route persisted unitCost into the canonical draft", () => {
  it("InvoiceDetailPage's adapter delegates hydration to the canonical hydrateDraft (preserves unitCost)", () => {
    expect(invoiceDetailSrc).toMatch(
      /from\s+["']@\/lib\/entities\/lineItemMapper["']/,
    );
    expect(invoiceDetailSrc).toMatch(/hydrateDraft\(/);
  });

  it("QuoteDetailPage's adapter delegates hydration to the canonical hydrateDraft (preserves unitCost when present)", () => {
    expect(quoteDetailSrc).toMatch(
      /from\s+["']@\/lib\/entities\/lineItemMapper["']/,
    );
    expect(quoteDetailSrc).toMatch(/hydrateDraft\(/);
  });

  it("JobDetailPage's adapter delegates hydration to the canonical hydrateDraft (preserves unitCost)", () => {
    expect(jobDetailSrc).toMatch(/hydrateDraft\(/);
  });
});

// ── All three pages mount the canonical card (no per-page override) ─

describe("Canonical header — all three surfaces consume the same card", () => {
  it("QuoteDetailPage mounts <LineItemsCard> from the canonical module", () => {
    expect(quoteDetailSrc).toMatch(
      /from\s+["']@\/components\/line-items["']/,
    );
    expect(quoteDetailSrc).toMatch(/<LineItemsCard/);
  });

  it("InvoiceDetailPage mounts <LineItemsCard> from the canonical module", () => {
    expect(invoiceDetailSrc).toMatch(
      /from\s+["']@\/components\/line-items["']/,
    );
    expect(invoiceDetailSrc).toMatch(/<LineItemsCard/);
  });

  it("JobDetailPage mounts <LineItemsCard> from the canonical module (via LineItemsTable wrapper)", () => {
    expect(jobDetailSrc).toMatch(
      /from\s+["']@\/components\/line-items["']/,
    );
    expect(jobDetailSrc).toMatch(/<LineItemsCard/);
  });

  it("the draft surfaces (CreateQuotePage / NewInvoicePage) also consume the canonical card", () => {
    expect(createQuoteSrc).toMatch(/<LineItemsCard/);
    expect(newInvoiceSrc).toMatch(/<LineItemsCard/);
  });

  it("no consuming page renders its own profitability header tile for line items", () => {
    // Pin the identifying wire of a competing header: the
    // <HeaderMetricBlock> labels are passed by string literal as
    // `label="Full Line Revenue"` / `label="Profit"` /
    // `label="Profit Margin"`. Comments in pages mentioning the
    // KPI names by way of explanation are fine (they carry no
    // runtime effect); a literal `label="…"` prop on a competing
    // header would. Likewise, the `metric-*` testIds are private
    // to the card.
    for (const src of [quoteDetailSrc, invoiceDetailSrc, jobDetailSrc, createQuoteSrc, newInvoiceSrc]) {
      expect(src).not.toMatch(/label="Full Line Revenue"/);
      expect(src).not.toMatch(/label="Profit Margin"/);
      expect(src).not.toMatch(/data-testid="metric-full-line-revenue"/);
      expect(src).not.toMatch(/data-testid="metric-profit-margin"/);
    }
  });
});
