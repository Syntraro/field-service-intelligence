/**
 * Receivables layout refinement tests (2026-05-13, updated 2026-05-14).
 *
 * Verifies the layout constraints on the Invoices workspace (/receivables):
 *   - No ActivityTab, PaymentsTab, or InsightsTab in ReceivablesPage
 *   - No top-level Filters button in the page header
 *   - KPI summary cards absent when receivablesMode=true (InvoiceListPanel)
 *   - InvoiceListPanel height-fill layout in receivablesMode
 *   - EntityListTable fillHeight prop behavior
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

// ── Tab components removed ───────────────────────────────────────────
// ReceivablesPage no longer has tabs — it renders InvoicesWorkspaceTab directly.

describe("Tab components absent from ReceivablesPage", () => {
  it("ReceivablesPage does not import or reference ActivityTab", () => {
    expect(receivablesPage).not.toMatch(/ActivityTab/);
    expect(receivablesPage).not.toMatch(/value: "activity"/);
    expect(receivablesPage).not.toMatch(/tab-content-activity/);
  });

  it("ReceivablesPage does not import or reference PaymentsTab", () => {
    expect(receivablesPage).not.toMatch(/PaymentsTab/);
    expect(receivablesPage).not.toMatch(/value: "payments"/);
  });

  it("ReceivablesPage does not import or reference InsightsTab", () => {
    expect(receivablesPage).not.toMatch(/InsightsTab/);
    expect(receivablesPage).not.toMatch(/value: "insights"/);
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

