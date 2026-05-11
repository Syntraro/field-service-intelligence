/**
 * Invoice Detail right rail — Summary tab source-pin tests (2026-05-10).
 *
 * Verifies the Summary tab in InvoiceDetailPage's canonical right rail:
 *   - Tab exists as first tab, default open
 *   - Builder function declared and wired to RailPanelRenderer
 *   - Shared buildFinancialSummaryContent helper invoked (not duplicated)
 *   - Uses existing profitSummary useMemo — no new fetches
 *   - Revenue + Cost breakdown rows with correct testIds
 *   - BarChart2 icon imported
 *   - Existing Visibility / Notes / Payments tabs unaffected
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const INVOICE_DETAIL = resolve(ROOT, "client/src/pages/InvoiceDetailPage.tsx");

const invoiceSrc = readFileSync(INVOICE_DETAIL, "utf-8");

// Extract the builder function body for scoped assertions.
const builderStart = invoiceSrc.indexOf("const buildInvoiceSummaryPanelDescriptor");
const builderEnd = invoiceSrc.indexOf("\n  };", builderStart) + 5;
const builderSrc = invoiceSrc.slice(builderStart, builderEnd);

// ── 1. Tab existence, default, and type ───────────────────────────

describe("InvoiceDetailPage Summary tab — existence and default", () => {
  it("declares `id: \"summary\"` as the first tab in invoiceRailTabs", () => {
    const arrStart = invoiceSrc.indexOf("const invoiceRailTabs:");
    expect(arrStart).toBeGreaterThan(-1);
    const arrEnd = invoiceSrc.indexOf("];", arrStart);
    const firstId = invoiceSrc.slice(arrStart, arrEnd).match(/\bid:\s*"(\w+)"/)?.[1];
    expect(firstId).toBe("summary");
  });

  it("Summary tab carries label \"Summary\", BarChart2 icon, stable testId", () => {
    expect(invoiceSrc).toMatch(
      /id:\s*"summary"[\s\S]{0,400}?label:\s*"Summary"[\s\S]{0,400}?icon:\s*BarChart2[\s\S]{0,400}?testId:\s*"invoice-rail-tab-summary"/,
    );
  });

  it("default open tab is \"summary\"", () => {
    expect(invoiceSrc).toMatch(
      /useState<InvoiceRailTab\s*\|\s*null>\(\s*"summary"\s*\)/,
    );
  });

  it("InvoiceRailTab type union includes \"summary\" as first member", () => {
    expect(invoiceSrc).toMatch(/type\s+InvoiceRailTab\s*=\s*"summary"\s*\|/);
  });

  it("BarChart2 imported from lucide-react", () => {
    expect(invoiceSrc).toMatch(
      /import\s*\{[\s\S]*?\bBarChart2\b[\s\S]*?\}\s*from\s*["']lucide-react["']/,
    );
  });
});

// ── 2. Summary tab content — RailPanelRenderer wiring ─────────────

describe("InvoiceDetailPage Summary tab — RailPanelRenderer wiring", () => {
  it("Summary tab mounts <RailPanelRenderer> inside data-testid=\"card-summary\"", () => {
    expect(invoiceSrc).toMatch(
      /id:\s*"summary"[\s\S]{0,1000}?data-testid="card-summary"[\s\S]{0,800}?<RailPanelRenderer/,
    );
  });

  it("Summary panel uses testIdPrefix=\"invoice-summary\"", () => {
    const idx = invoiceSrc.indexOf('data-testid="card-summary"');
    expect(idx).toBeGreaterThan(-1);
    const slice = invoiceSrc.slice(idx, idx + 300);
    expect(slice).toMatch(/testIdPrefix="invoice-summary"/);
  });

  it("card-summary uses space-y-3 for consistent gap between Financial, Payment, and ClientVisibility cards", () => {
    expect(invoiceSrc).toMatch(/className="space-y-3"[\s\S]{0,100}?data-testid="card-summary"/);
  });

  it("descriptor builder is named buildInvoiceSummaryPanelDescriptor, returns RailPanelDescriptor", () => {
    expect(invoiceSrc).toMatch(
      /const\s+buildInvoiceSummaryPanelDescriptor\s*=\s*\(\s*\)\s*:\s*RailPanelDescriptor/,
    );
  });

  it("descriptor kind is \"list\" with testId \"invoice-summary-panel\"", () => {
    expect(builderSrc).toMatch(/kind:\s*"list"/);
    expect(builderSrc).toMatch(/testId:\s*"invoice-summary-panel"/);
  });
});

// ── 3. Shared helper — no inline JSX duplication ──────────────────

describe("InvoiceDetailPage Summary tab — shared helper invocation", () => {
  it("builder invokes buildFinancialSummaryContent (not inlining JSX)", () => {
    expect(builderSrc).toMatch(/buildFinancialSummaryContent\(/);
  });

  it("passes marginTestId, marginBarTestId, profitTestId to the helper", () => {
    expect(builderSrc).toMatch(/"invoice-summary-margin-pct"/);
    expect(builderSrc).toMatch(/"invoice-summary-margin-bar"/);
    expect(builderSrc).toMatch(/"invoice-summary-profit"/);
  });

  it("passes Revenue and Cost row testIds to the helper", () => {
    expect(builderSrc).toMatch(/"invoice-summary-revenue"/);
    expect(builderSrc).toMatch(/"invoice-summary-cost"/);
  });
});

// ── 4. profitSummary reuse — no new fetches ────────────────────────

describe("InvoiceDetailPage Summary tab — profitSummary reuse", () => {
  it("builder reads from profitSummary (existing useMemo — no new useQuery / apiRequest)", () => {
    expect(builderSrc).toMatch(/profitSummary\.margin/);
    expect(builderSrc).toMatch(/profitSummary\.profit/);
    expect(builderSrc).toMatch(/profitSummary\.totalPrice/);
    expect(builderSrc).toMatch(/profitSummary\.totalCost/);
    expect(builderSrc).not.toMatch(/useQuery\b/);
    expect(builderSrc).not.toMatch(/apiRequest\b/);
  });

  it("profitSummary useMemo is declared in InvoiceDetailPage (pre-existing)", () => {
    expect(invoiceSrc).toMatch(/const\s+profitSummary\s*=\s*useMemo\(/);
  });
});

// ── 5. Sibling tabs unaffected ─────────────────────────────────────

describe("InvoiceDetailPage Summary tab — sibling tabs present", () => {
  it("Summary tab mounts <ClientVisibilityCardV2> (visibility editor in Summary content)", () => {
    expect(invoiceSrc).toMatch(/id:\s*"summary"[\s\S]{0,3000}?<ClientVisibilityCardV2/);
  });

  it("ClientVisibilityCardV2 renders editable Switch controls (one per visibility row)", () => {
    const visBlock = invoiceSrc.slice(
      invoiceSrc.indexOf("function ClientVisibilityCardV2"),
      invoiceSrc.indexOf("export default function InvoiceDetailPage"),
    );
    // Switch testids use a template literal `switch-vis-${r.key}` over the ROWS map
    expect(visBlock).toMatch(/data-testid=\{`switch-vis-\$\{r\.key\}`\}/);
    // Save button carries a stable testid
    expect(visBlock).toMatch(/data-testid="button-save-vis-v2"/);
    // Must mount a Switch for each row (at minimum 6 rows)
    expect(visBlock).toMatch(/<Switch/);
    expect(visBlock).toMatch(/ROWS\.map/);
  });

  it("ClientVisibilityCardV2 uses compact py-1 row padding (not py-2)", () => {
    const visBlock = invoiceSrc.slice(
      invoiceSrc.indexOf("function ClientVisibilityCardV2"),
      invoiceSrc.indexOf("export default function InvoiceDetailPage"),
    );
    // Row labels use py-1 for compact rail fit
    expect(visBlock).toMatch(/grid-cols-\[1fr_auto\][\s\S]{0,100}?py-1\b/);
    // Must NOT use the old py-2 on rows
    expect(visBlock).not.toMatch(/grid-cols-\[1fr_auto\][\s\S]{0,100}?py-2\b/);
  });

  it("Financial Summary builder still invokes buildFinancialSummaryContent (unchanged)", () => {
    expect(builderSrc).toMatch(/buildFinancialSummaryContent\(/);
    expect(builderSrc).toMatch(/profitSummary\.margin/);
  });

  it("Notes & Activity tab present with InvoiceActivityPanel", () => {
    expect(invoiceSrc).toMatch(/id:\s*"notes_activity"[\s\S]{0,3000}?<InvoiceActivityPanel/);
  });

  it("Pricing tab present with InvoicePricingHistoryPanel", () => {
    expect(invoiceSrc).toMatch(/id:\s*"pricing"[\s\S]{0,3000}?<InvoicePricingHistoryPanel/);
  });

  it("tab count is THREE (Summary + Notes & Activity + Pricing)", () => {
    const arrStart = invoiceSrc.indexOf("const invoiceRailTabs:");
    const arrEnd = invoiceSrc.indexOf("];", arrStart);
    const idMatches = invoiceSrc.slice(arrStart, arrEnd).match(/\bid:\s*"\w+"/g) ?? [];
    expect(idMatches.length).toBe(3);
  });
});
