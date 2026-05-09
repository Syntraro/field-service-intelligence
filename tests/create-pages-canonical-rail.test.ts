/**
 * /leads/new, /quotes/new, /invoices/new — canonical rail layout pins (2026-05-08).
 *
 * Phase 1 (hook-order fix): QuoteDetailPage's useMemo + useLineItemsDrafts
 *   were declared after the early returns at the top of the component
 *   body. Once `details` resolved from `useQuery`, the hook count grew
 *   and React fired "Rendered more hooks than during the previous render".
 *   Pin both hooks above ALL early returns.
 *
 * Phase 3 (create-page rail canonicalization): CreateLeadPage,
 *   CreateQuotePage, and NewInvoicePage all used legacy two-column /
 *   shell layouts with stacked-cards asides. Each now mounts the
 *   canonical `<DetailRightRail>` aside as a sibling of a
 *   `*-left-column-shell`, matching the saved detail pages exactly. Save
 *   / Cancel relocated out of the rail; "Save first" placeholder cards
 *   gone; rail tabs scoped to the subset valid before save.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const QUOTE_DETAIL = resolve(ROOT, "client/src/pages/QuoteDetailPage.tsx");
const CREATE_LEAD = resolve(ROOT, "client/src/pages/CreateLeadPage.tsx");
const CREATE_QUOTE = resolve(ROOT, "client/src/pages/CreateQuotePage.tsx");
const NEW_INVOICE = resolve(ROOT, "client/src/pages/NewInvoicePage.tsx");

const quoteDetailSrc = readFileSync(QUOTE_DETAIL, "utf-8");
const createLeadSrc = readFileSync(CREATE_LEAD, "utf-8");
const createQuoteSrc = readFileSync(CREATE_QUOTE, "utf-8");
const newInvoiceSrc = readFileSync(NEW_INVOICE, "utf-8");

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}
const quoteDetailCodeOnly = stripComments(quoteDetailSrc);
const createLeadCodeOnly = stripComments(createLeadSrc);
const createQuoteCodeOnly = stripComments(createQuoteSrc);
const newInvoiceCodeOnly = stripComments(newInvoiceSrc);

// ── Phase 1 — hook-order regression guard ───────────────────────────

describe("QuoteDetailPage — hook order is stable across renders (no hooks below early returns)", () => {
  it("the `useMemo` + `useLineItemsDrafts` pair are declared BEFORE the first early return", () => {
    // Both hooks reference `details?.lines` etc. via optional chaining,
    // so they're safe to run before the `if (!details) return ...`
    // guard. Pin: useMemo's index < first `if (!quoteId)` index.
    const useMemoIdx = quoteDetailCodeOnly.indexOf(
      "const quoteLineItemsAdapter = useMemo",
    );
    const useDraftsIdx = quoteDetailCodeOnly.indexOf(
      "const lineItemsDrafts = useLineItemsDrafts",
    );
    const firstEarlyReturnIdx = quoteDetailCodeOnly.indexOf("if (!quoteId) {");
    expect(useMemoIdx).toBeGreaterThan(-1);
    expect(useDraftsIdx).toBeGreaterThan(-1);
    expect(firstEarlyReturnIdx).toBeGreaterThan(-1);
    expect(useMemoIdx).toBeLessThan(firstEarlyReturnIdx);
    expect(useDraftsIdx).toBeLessThan(firstEarlyReturnIdx);
  });

  it("no hook (useState / useMemo / useQuery / useMutation / useEffect / useRef / use*) is declared AFTER the first early return", () => {
    const firstEarlyReturnIdx = quoteDetailCodeOnly.indexOf("if (!quoteId) {");
    expect(firstEarlyReturnIdx).toBeGreaterThan(-1);
    const afterReturns = quoteDetailCodeOnly.slice(firstEarlyReturnIdx);
    // No `const X = useY(...)` calls AT THE COMPONENT TOP LEVEL after
    // the first early return. (Inline hook calls inside JSX callbacks
    // are not module-top hooks — they wouldn't be matched by this
    // pattern because the leading whitespace context is different,
    // but for safety we anchor on the canonical 2-space top-level
    // indent.)
    expect(afterReturns).not.toMatch(
      /^\s{2}const\s+[\w[\],\s{}]+\s*=\s*use[A-Z][a-zA-Z]+\(/m,
    );
  });
});

// ── Phase 3 — CreateLeadPage canonical rail ─────────────────────────

describe("CreateLeadPage (/leads/new) — canonical rail layout", () => {
  it("imports the canonical DetailRightRail primitive + DetailRailTab type", () => {
    expect(createLeadSrc).toMatch(
      /import\s*\{[\s\S]*?\bDetailRightRail\b[\s\S]*?\btype\s+DetailRailTab\b[\s\S]*?\}\s*from\s*["']@\/components\/detail-rail\/DetailRightRail["']/,
    );
  });

  it("uses the canonical outer flex shell + left-column-shell + rail-aside structure", () => {
    expect(createLeadSrc).toMatch(
      /<div\s+className="flex h-full flex-col lg:flex-row bg-\[#f1f5f9\]"\s+data-testid="create-lead-page"/,
    );
    expect(createLeadSrc).toMatch(/data-testid="create-lead-left-column-shell"/);
    expect(createLeadSrc).toMatch(/data-testid="create-lead-detail-rail-column"/);
  });

  it("the body wrapper has no inner `overflow-y-auto` (single-scroll canonical)", () => {
    const startIdx = createLeadCodeOnly.indexOf(
      'data-testid="create-lead-left-column-shell"',
    );
    const endIdx = createLeadCodeOnly.indexOf(
      'data-testid="create-lead-detail-rail-column"',
      startIdx,
    );
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    const leftSlice = createLeadCodeOnly.slice(startIdx, endIdx);
    expect(leftSlice).not.toMatch(/overflow-y-auto/);
    // The legacy `grid grid-cols-[1fr_360px]` two-column wrapper is gone.
    expect(leftSlice).not.toMatch(/grid-cols-\[1fr_360px\]/);
    // The body wrapper directly inside the shell uses the canonical
    // padding + space-y pattern.
    expect(createLeadSrc).toMatch(
      /data-testid="create-lead-left-column-shell"[\s\S]{0,1200}?<div\s+className="px-4 lg:px-6 py-4 space-y-3">/,
    );
  });

  it("rail registry has exactly ONE tab (Details) — Notes / Actions need a saved leadId and are omitted in create mode", () => {
    const arrStart = createLeadSrc.indexOf("const leadRailTabs:");
    expect(arrStart).toBeGreaterThan(-1);
    const arrEnd = createLeadSrc.indexOf("];", arrStart);
    const arrSlice = createLeadSrc.slice(arrStart, arrEnd);
    const idMatches = arrSlice.match(/\bid:\s*"\w+"/g) ?? [];
    expect(idMatches.length).toBe(1);
    expect(arrSlice).toMatch(/id:\s*"details"/);
    expect(arrSlice).not.toMatch(/id:\s*"notes"/);
    expect(arrSlice).not.toMatch(/id:\s*"actions"/);
  });

  it("Save / Cancel buttons live in an inline action row at the bottom of the left column (NOT in the rail)", () => {
    expect(createLeadSrc).toMatch(/data-testid="create-lead-action-row"/);
    expect(createLeadSrc).toMatch(/data-testid="button-create-lead"/);
    expect(createLeadSrc).toMatch(/data-testid="button-cancel-lead"/);
    // Verify both buttons live INSIDE the left-column-shell, not the rail.
    const leftStart = createLeadSrc.indexOf(
      'data-testid="create-lead-left-column-shell"',
    );
    const railStart = createLeadSrc.indexOf(
      'data-testid="create-lead-detail-rail-column"',
    );
    const leftSlice = createLeadSrc.slice(leftStart, railStart);
    expect(leftSlice).toMatch(/data-testid="button-create-lead"/);
    expect(leftSlice).toMatch(/data-testid="button-cancel-lead"/);
    // And the prior "Actions" rail card with its bg-white/border header
    // chrome is gone.
    const railSlice = createLeadSrc.slice(railStart);
    expect(railSlice).not.toMatch(/data-testid="button-create-lead"/);
    expect(railSlice).not.toMatch(/data-testid="button-cancel-lead"/);
  });

  it("the prior legacy two-column grid + stacked-cards aside markers are gone", () => {
    expect(createLeadCodeOnly).not.toMatch(/grid-cols-\[1fr_360px\]/);
    // The prior `<aside className="space-y-3 min-h-0 overflow-y-auto">`
    // wrapper is replaced by the canonical rail aside.
    expect(createLeadCodeOnly).not.toMatch(
      /<aside\s+className="space-y-3 min-h-0 overflow-y-auto"/,
    );
  });
});

// ── Phase 3 — CreateQuotePage canonical rail ────────────────────────

describe("CreateQuotePage (/quotes/new) — canonical rail layout", () => {
  it("does NOT import the legacy DetailPageShell", () => {
    expect(createQuoteSrc).not.toMatch(
      /from\s+["']@\/components\/layout\/DetailPageShell["']/,
    );
  });

  it("imports the canonical DetailRightRail primitive + DetailRailTab type", () => {
    expect(createQuoteSrc).toMatch(
      /import\s*\{[\s\S]*?\bDetailRightRail\b[\s\S]*?\btype\s+DetailRailTab\b[\s\S]*?\}\s*from\s*["']@\/components\/detail-rail\/DetailRightRail["']/,
    );
  });

  it("uses the canonical outer flex shell + left-column-shell + rail-aside structure", () => {
    expect(createQuoteSrc).toMatch(
      /<div\s+className="flex h-full flex-col lg:flex-row bg-app-bg"\s+data-testid="create-quote-page"/,
    );
    expect(createQuoteSrc).toMatch(/data-testid="create-quote-left-column-shell"/);
    expect(createQuoteSrc).toMatch(/data-testid="create-quote-detail-rail-column"/);
  });

  it("the body wrapper has no inner `overflow-y-auto` (single-scroll canonical)", () => {
    const startIdx = createQuoteCodeOnly.indexOf(
      'data-testid="create-quote-left-column-shell"',
    );
    const endIdx = createQuoteCodeOnly.indexOf(
      'data-testid="create-quote-detail-rail-column"',
      startIdx,
    );
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    const leftSlice = createQuoteCodeOnly.slice(startIdx, endIdx);
    expect(leftSlice).not.toMatch(/overflow-y-auto/);
    expect(createQuoteSrc).toMatch(
      /data-testid="create-quote-left-column-shell"[\s\S]{0,1500}?<div\s+className="px-4 lg:px-6 py-4 space-y-4">/,
    );
  });

  it("the legacy `<DetailPageShell rightRail={...}>` mount is gone", () => {
    expect(createQuoteCodeOnly).not.toMatch(/<DetailPageShell\b/);
    expect(createQuoteCodeOnly).not.toMatch(/rightRail=\{/);
    expect(createQuoteCodeOnly).not.toMatch(/leftColumn=\{/);
  });

  it("rail registry has exactly ONE tab (Summary) — Notes / References / Activity / Workflow all need saved state", () => {
    const arrStart = createQuoteSrc.indexOf("const quoteRailTabs:");
    expect(arrStart).toBeGreaterThan(-1);
    const arrEnd = createQuoteSrc.indexOf("];", arrStart);
    const arrSlice = createQuoteSrc.slice(arrStart, arrEnd);
    const idMatches = arrSlice.match(/\bid:\s*"\w+"/g) ?? [];
    expect(idMatches.length).toBe(1);
    expect(arrSlice).toMatch(/id:\s*"summary"/);
    expect(arrSlice).not.toMatch(/id:\s*"notes"/);
    expect(arrSlice).not.toMatch(/id:\s*"references"/);
    expect(arrSlice).not.toMatch(/id:\s*"activity"/);
    expect(arrSlice).not.toMatch(/id:\s*"workflow"/);
  });

  it("Summary tab content slot mounts <QuoteSummaryCard>", () => {
    expect(createQuoteSrc).toMatch(
      /id:\s*"summary"[\s\S]{0,1200}?<QuoteSummaryCard\b/,
    );
  });

  it("Save / Cancel buttons live in an inline action row at the bottom of the left column (NOT in the rail)", () => {
    expect(createQuoteSrc).toMatch(/data-testid="create-quote-action-row"/);
    expect(createQuoteSrc).toMatch(/data-testid="button-create-quote"/);
    expect(createQuoteSrc).toMatch(/data-testid="button-cancel-quote"/);
    const leftStart = createQuoteSrc.indexOf(
      'data-testid="create-quote-left-column-shell"',
    );
    const railStart = createQuoteSrc.indexOf(
      'data-testid="create-quote-detail-rail-column"',
    );
    const leftSlice = createQuoteSrc.slice(leftStart, railStart);
    expect(leftSlice).toMatch(/data-testid="button-create-quote"/);
    expect(leftSlice).toMatch(/data-testid="button-cancel-quote"/);
    const railSlice = createQuoteSrc.slice(railStart);
    expect(railSlice).not.toMatch(/data-testid="button-create-quote"/);
    expect(railSlice).not.toMatch(/data-testid="button-cancel-quote"/);
  });

  it("the prior 'Save first' rail placeholder card is gone (placeholder is no longer needed when the rail just hosts Summary)", () => {
    expect(createQuoteSrc).not.toMatch(
      /data-testid="card-quote-saved-only-placeholder"/,
    );
    expect(createQuoteSrc).not.toMatch(
      /data-testid="quote-saved-only-save-first"/,
    );
  });
});

// ── Phase 3 — NewInvoicePage canonical rail ─────────────────────────

describe("NewInvoicePage (/invoices/new) — canonical rail layout", () => {
  it("does NOT mount the legacy <InvoiceDetailShell> (only comments may reference it)", () => {
    expect(newInvoiceCodeOnly).not.toMatch(/<InvoiceDetailShell\b/);
    expect(newInvoiceCodeOnly).not.toMatch(
      /from\s+["']@\/components\/invoice\/InvoiceDetailShell["']/,
    );
  });

  it("imports the canonical DetailRightRail primitive + DetailRailTab type", () => {
    expect(newInvoiceSrc).toMatch(
      /import\s*\{[\s\S]*?\bDetailRightRail\b[\s\S]*?\btype\s+DetailRailTab\b[\s\S]*?\}\s*from\s*["']@\/components\/detail-rail\/DetailRightRail["']/,
    );
  });

  it("uses the canonical outer flex shell + left-column-shell + rail-aside structure", () => {
    expect(newInvoiceSrc).toMatch(
      /<div\s+className="flex h-full flex-col lg:flex-row bg-app-bg"\s+data-testid="new-invoice-page"/,
    );
    expect(newInvoiceSrc).toMatch(/data-testid="new-invoice-left-column-shell"/);
    expect(newInvoiceSrc).toMatch(/data-testid="new-invoice-rail-column"/);
  });

  it("the body wrapper has no inner `overflow-y-auto` (single-scroll canonical)", () => {
    const startIdx = newInvoiceCodeOnly.indexOf(
      'data-testid="new-invoice-left-column-shell"',
    );
    const endIdx = newInvoiceCodeOnly.indexOf(
      'data-testid="new-invoice-rail-column"',
      startIdx,
    );
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    const leftSlice = newInvoiceCodeOnly.slice(startIdx, endIdx);
    expect(leftSlice).not.toMatch(/overflow-y-auto/);
    expect(newInvoiceSrc).toMatch(
      /data-testid="new-invoice-left-column-shell"[\s\S]{0,1500}?<div\s+className="px-4 lg:px-6 pt-0 pb-4 space-y-2\.5">/,
    );
  });

  it("CanonicalDetailHeader lives INSIDE the body wrapper (mirrors saved-page single-scroll layout)", () => {
    const wrapperIdx = newInvoiceCodeOnly.indexOf(
      'className="px-4 lg:px-6 pt-0 pb-4 space-y-2.5"',
    );
    const headerIdx = newInvoiceCodeOnly.indexOf(
      "<CanonicalDetailHeader",
      wrapperIdx,
    );
    expect(wrapperIdx).toBeGreaterThan(-1);
    expect(headerIdx).toBeGreaterThan(wrapperIdx);
  });

  it("rail registry has exactly ONE tab (Visibility) — Notes / Payments need a saved invoiceId", () => {
    const arrStart = newInvoiceSrc.indexOf("const invoiceRailTabs:");
    expect(arrStart).toBeGreaterThan(-1);
    const arrEnd = newInvoiceSrc.indexOf("];", arrStart);
    const arrSlice = newInvoiceSrc.slice(arrStart, arrEnd);
    const idMatches = arrSlice.match(/\bid:\s*"\w+"/g) ?? [];
    expect(idMatches.length).toBe(1);
    expect(arrSlice).toMatch(/id:\s*"visibility"/);
    expect(arrSlice).not.toMatch(/id:\s*"notes"/);
    expect(arrSlice).not.toMatch(/id:\s*"payments"/);
  });

  it("Visibility tab content slot mounts <ClientVisibilityCardV2> with dirty=false (draft mode)", () => {
    expect(newInvoiceSrc).toMatch(
      /id:\s*"visibility"[\s\S]{0,2000}?<ClientVisibilityCardV2\b[\s\S]{0,1000}?dirty=\{false\}/,
    );
  });

  it("the prior 'Save first' notes placeholder card is gone (notes simply isn't a tab in create mode)", () => {
    expect(newInvoiceSrc).not.toMatch(/data-testid="invoice-notes-save-first"/);
    expect(newInvoiceSrc).not.toMatch(/Save the invoice before adding notes\./);
  });

  it("Save / Cancel buttons stay in CanonicalDetailHeader's actions slot (header-level entity action)", () => {
    // Save Invoice + Cancel buttons live in the header's `actions={}`
    // prop — same pattern as the saved Invoice page header.
    expect(newInvoiceSrc).toMatch(/data-testid="button-new-invoice-save"/);
    expect(newInvoiceSrc).toMatch(/data-testid="button-new-invoice-cancel"/);
  });
});
