/**
 * Receivables layout refinement tests (2026-05-13).
 *
 * Verifies the layout changes applied to the Receivables workspace:
 *   - Activity tab removed (3 tabs: Invoices, Payments, Insights)
 *   - Top-level Filters button removed from header
 *   - KPI summary cards absent when receivablesMode=true
 *   - Invoice search/filter controls in the tab row (invoices tab only)
 *   - Payments and Insights tabs do NOT show invoice search controls
 *   - InsightsTab compact coming-soon with planned feature list
 *   - InvoiceListPanel uses tighter spacing in receivablesMode
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

function src(relPath: string) {
  return readFileSync(join(ROOT, relPath), "utf-8");
}

const receivablesPage      = src("client/src/pages/ReceivablesPage.tsx");
const invoiceListPanel     = src("client/src/components/invoices/InvoiceListPanel.tsx");
const invoicesWorkspaceTab = src("client/src/pages/receivables/InvoicesWorkspaceTab.tsx");
const insightsTab          = src("client/src/pages/receivables/InsightsTab.tsx");

// ── Activity tab removed ─────────────────────────────────────────────

describe("Activity tab removal", () => {
  it("ReceivablesPage TAB_VALUES does not include activity as a tab value", () => {
    // The string "activity" still appears in the normalization alias (t === "activity").
    // Check the specific tab definition format is absent.
    expect(receivablesPage).not.toMatch(/value: "activity"/);
    expect(receivablesPage).not.toMatch(/label: "Activity"/);
  });

  it("ReceivablesPage does not import ActivityTab", () => {
    expect(receivablesPage).not.toMatch(/ActivityTab/);
  });

  it("ReceivablesPage does not render tab-content-activity", () => {
    expect(receivablesPage).not.toMatch(/tab-content-activity/);
  });

  it("ReceivablesPage normalizes ?tab=activity to insights", () => {
    expect(receivablesPage).toMatch(/t === "activity".*return "insights"/);
  });
});

// ── Filters button removed from header ──────────────────────────────

describe("Filters button removed from page header", () => {
  it("ReceivablesPage does not import SlidersHorizontal", () => {
    expect(receivablesPage).not.toMatch(/SlidersHorizontal/);
  });

  it("ReceivablesPage header does not contain a standalone Filters button", () => {
    // The header action area is the shrink-0 div before the tab strip.
    // No <Button ... >Filters</Button> should exist at the page level.
    expect(receivablesPage).not.toMatch(/>(\s*)Filters(\s*)<\/Button>/);
  });
});

// ── KPI cards gated behind receivablesMode early return ─────────────

describe("KPI cards absent in receivablesMode", () => {
  it("InvoiceListPanel has an early return for receivablesMode (KPI cards never rendered in that path)", () => {
    // The receivablesMode path exits before the standard section that holds grid-cols-4.
    expect(invoiceListPanel).toMatch(/if \(receivablesMode\)/);
  });

  it("InvoiceListPanel grid-cols-4 KPI section is only in the standard return path (after the early return)", () => {
    // The receivablesMode early return comes BEFORE the grid-cols-4 block.
    const earlyReturnIdx = invoiceListPanel.indexOf("if (receivablesMode)");
    const gridCols4Idx   = invoiceListPanel.indexOf("grid-cols-4");
    expect(earlyReturnIdx).toBeGreaterThan(0);
    expect(gridCols4Idx).toBeGreaterThan(earlyReturnIdx);
  });

  it("InvoiceListPanel stats query is disabled when receivablesMode=true", () => {
    expect(invoiceListPanel).toMatch(/enabled: !receivablesMode/);
  });

  it("InvoiceListPanel still renders SummaryCard in the file (standard mode)", () => {
    expect(invoiceListPanel).toMatch(/SummaryCard/);
  });
});

// ── Invoice search/filter controls in the tab row ────────────────────

describe("Invoice search/filter in tab row", () => {
  it("ReceivablesPage renders invoice-tab-controls testid", () => {
    expect(receivablesPage).toMatch(/data-testid="invoice-tab-controls"/);
  });

  it("ReceivablesPage renders input-search-invoices-tab only when invoices tab active", () => {
    expect(receivablesPage).toMatch(/activeTab === "invoices"[\s\S]{0,600}input-search-invoices-tab/);
  });

  it("ReceivablesPage does NOT show invoice tab controls for payments or insights tabs", () => {
    // The controls are gated by activeTab === "invoices" — not rendered for other tabs.
    const controlsBlock = receivablesPage.indexOf('data-testid="invoice-tab-controls"');
    const paymentsBlock = receivablesPage.indexOf('data-testid="tab-content-payments"');
    const insightsBlock = receivablesPage.indexOf('data-testid="tab-content-insights"');
    // Controls are always before the tab content rendering section
    expect(controlsBlock).toBeGreaterThan(0);
    expect(controlsBlock).toBeLessThan(paymentsBlock);
    expect(controlsBlock).toBeLessThan(insightsBlock);
  });

  it("ReceivablesPage manages invoiceSearch and invoiceFilter state", () => {
    expect(receivablesPage).toMatch(/invoiceSearch/);
    expect(receivablesPage).toMatch(/invoiceFilter/);
    expect(receivablesPage).toMatch(/setInvoiceSearch/);
    expect(receivablesPage).toMatch(/setInvoiceFilter/);
  });

  it("ReceivablesPage resets search and filter when activeView changes", () => {
    expect(receivablesPage).toMatch(/setInvoiceSearch\(""\)/);
    expect(receivablesPage).toMatch(/setInvoiceFilter\("all"\)/);
    expect(receivablesPage).toMatch(/\[activeView\]/);
  });

  it("ReceivablesPage passes externalSearchQuery and externalActiveFilter to InvoicesWorkspaceTab", () => {
    expect(receivablesPage).toMatch(/externalSearchQuery=\{invoiceSearch\}/);
    expect(receivablesPage).toMatch(/externalActiveFilter=\{invoiceFilter\}/);
  });

  it("InvoicesWorkspaceTab accepts and threads external search/filter props", () => {
    expect(invoicesWorkspaceTab).toMatch(/externalSearchQuery/);
    expect(invoicesWorkspaceTab).toMatch(/externalActiveFilter/);
    expect(invoicesWorkspaceTab).toMatch(/onExternalSearchChange/);
    expect(invoicesWorkspaceTab).toMatch(/onExternalActiveFilterChange/);
  });

  it("InvoiceListPanel exports InvoiceStatusFilter type", () => {
    expect(invoiceListPanel).toMatch(/export type InvoiceStatusFilter/);
  });

  it("InvoiceListPanel inline search/filter row only appears in the standard return path (after the early return)", () => {
    // The receivablesMode early return exits before the standard section that holds input-search-invoices.
    const earlyReturnIdx  = invoiceListPanel.indexOf("if (receivablesMode)");
    const standardPathIdx = invoiceListPanel.indexOf("// ── Standard mode layout");
    const searchInputIdx  = invoiceListPanel.indexOf('data-testid="input-search-invoices"');
    expect(earlyReturnIdx).toBeGreaterThan(0);
    expect(standardPathIdx).toBeGreaterThan(earlyReturnIdx);
    expect(searchInputIdx).toBeGreaterThan(standardPathIdx);
  });

  it("InvoiceListPanel uses effectiveSearchQuery and effectiveActiveFilter in filteredInvoices", () => {
    expect(invoiceListPanel).toMatch(/effectiveSearchQuery/);
    expect(invoiceListPanel).toMatch(/effectiveActiveFilter/);
  });
});

// ── Height fill + spacing in receivablesMode ────────────────────────

describe("InvoiceListPanel height-fill layout in receivablesMode", () => {
  it("receivablesMode path uses flex flex-col h-full min-h-0 root container", () => {
    expect(invoiceListPanel).toMatch(/flex flex-col h-full min-h-0/);
  });

  it("receivablesMode path has a flex-1 min-h-0 overflow-y-auto table wrapper", () => {
    expect(invoiceListPanel).toMatch(/flex-1 min-h-0 overflow-y-auto/);
  });

  it("receivablesMode path passes fillHeight to EntityListTable", () => {
    // fillHeight must appear in the receivablesMode early-return block.
    const modeStart  = invoiceListPanel.indexOf("if (receivablesMode)");
    const modeEnd    = invoiceListPanel.indexOf("// ── Standard mode layout");
    const modeBlock  = invoiceListPanel.slice(modeStart, modeEnd);
    expect(modeBlock).toMatch(/fillHeight/);
  });

  it("receivablesMode path does NOT use min-h-screen", () => {
    const modeStart = invoiceListPanel.indexOf("if (receivablesMode)");
    const modeEnd   = invoiceListPanel.indexOf("// ── Standard mode layout");
    const modeBlock = invoiceListPanel.slice(modeStart, modeEnd);
    expect(modeBlock).not.toMatch(/min-h-screen/);
  });

  it("standard mode uses p-6 space-y-5 container (unchanged)", () => {
    expect(invoiceListPanel).toMatch(/p-6 space-y-5/);
  });

  it("InvoicesWorkspaceTab center panel uses overflow-hidden (not overflow-auto)", () => {
    expect(invoicesWorkspaceTab).toMatch(/overflow-hidden/);
    // overflow-auto must NOT be on the center panel div (the flex-1 min-w-0 container).
    expect(invoicesWorkspaceTab).not.toMatch(/flex-1 min-w-0 overflow-auto/);
  });

  it("InvoicesWorkspaceTab does not introduce min-h-screen", () => {
    expect(invoicesWorkspaceTab).not.toMatch(/min-h-screen/);
  });
});

// ── EntityListTable fillHeight prop ──────────────────────────────────

describe("EntityListTable fillHeight prop", () => {
  const entityListTable = (() => {
    const { readFileSync } = require("fs");
    const { join } = require("path");
    return readFileSync(join(__dirname, "..", "client/src/components/lists/EntityListTable.tsx"), "utf-8");
  })();

  it("EntityListTable accepts fillHeight prop in its props interface", () => {
    expect(entityListTable).toMatch(/fillHeight\?.*boolean/);
  });

  it("EntityListTable applies flex flex-col to outer div when fillHeight+showingState", () => {
    expect(entityListTable).toMatch(/fillHeight.*showingState.*flex flex-col/s);
  });

  it("EntityListTable wraps state blocks in flex-1 centering div when fillHeight", () => {
    expect(entityListTable).toMatch(/fillHeight.*flex-1 flex items-center justify-center/s);
  });

  it("EntityListTable does not apply flex-col to rows (only to state blocks)", () => {
    // The flex flex-col on outer div is conditional on showingState.
    // When rows render, the outer div is NOT a flex column.
    expect(entityListTable).toMatch(/fillHeight && showingState/);
  });
});

// ── InsightsTab compact coming-soon ──────────────────────────────────

describe("InsightsTab compact coming-soon with feature list", () => {
  it("renders insights-tab-coming-soon testid", () => {
    expect(insightsTab).toMatch(/data-testid="insights-tab-coming-soon"/);
  });

  it("lists all 6 planned insight features", () => {
    expect(insightsTab).toMatch(/Aging buckets/);
    expect(insightsTab).toMatch(/Collection performance/);
    expect(insightsTab).toMatch(/Average days to pay/);
    expect(insightsTab).toMatch(/Promise-to-pay conversion/);
    expect(insightsTab).toMatch(/Overdue trend tracking/);
    expect(insightsTab).toMatch(/Collector activity/);
  });

  it("uses compact inline layout (items-start gap-4) not centered column", () => {
    expect(insightsTab).toMatch(/items-start gap-4/);
    // Old centered layout should be gone
    expect(insightsTab).not.toMatch(/items-center justify-center py-16/);
  });

  it("preserves TODO comments pointing to future API endpoints", () => {
    expect(insightsTab).toMatch(/TODO/);
    expect(insightsTab).toMatch(/\/api\/receivables/);
  });
});
