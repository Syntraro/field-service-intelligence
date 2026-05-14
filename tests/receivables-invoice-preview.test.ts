/**
 * Receivables inline invoice particulars panel tests (2026-05-13).
 *
 * Tests the InvoiceParticularsPanel component and its integration into
 * InvoiceListPanel receivablesMode. Replaces the earlier InvoicePreviewPanel
 * tests (same file, updated for the new component and fixed layout).
 *
 * Verifies:
 *   - InvoiceParticularsPanel exports the component
 *   - Fetches via ["invoices", "detail", invoiceId] (shared cache with InvoiceDetailPage)
 *   - Endpoint: /api/invoices/:id/details
 *   - Header: invoice number, status badge, client name, Open Invoice button, Close button
 *   - Primary fields: total, balance, issued, due date, terms, linked job
 *   - Description / summary fields
 *   - Line items table (per-line testids)
 *   - Totals summary (subtotal, tax, total, balance due row)
 *   - Notes section (notesCustomer, notesInternal, fallback "No invoice notes.")
 *   - Payment summary (amountPaid from invoice, fallback "No payments recorded.")
 *   - Uses invoice.taxTotal not taxAmount
 *   - Error state testid
 *   - InvoiceListPanel integration: imports, particularsInvoiceId, clear-on-filter-out
 *   - particulars container is inside the single scroll wrapper (no competing flex-1)
 *   - fillHeight={!particularsInvoiceId}
 *   - Close button calls setSelectedIds(new Set())
 *   - Bulk action bar hidden in receivablesMode
 *
 * Source-level tests — readFileSync + regex, no DOM/runtime.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

function src(relPath: string) {
  return readFileSync(join(ROOT, relPath), "utf-8");
}

const particularsPanel = src("client/src/components/invoices/InvoiceParticularsPanel.tsx");
const invoiceListPanel = src("client/src/components/invoices/InvoiceListPanel.tsx");

// ── InvoiceParticularsPanel: export ──────────────────────────────────────────

describe("InvoiceParticularsPanel export", () => {
  it("exports InvoiceParticularsPanel as a named export", () => {
    expect(particularsPanel).toMatch(/export function InvoiceParticularsPanel/);
  });
});

// ── InvoiceParticularsPanel: data fetching ────────────────────────────────────

describe("InvoiceParticularsPanel data fetching", () => {
  it("uses ['invoices', 'detail', invoiceId] as queryKey", () => {
    expect(particularsPanel).toMatch(/queryKey.*"invoices".*"detail".*invoiceId/s);
  });

  it("fetches from /api/invoices/:id/details", () => {
    expect(particularsPanel).toMatch(/\/api\/invoices\/\$\{invoiceId\}\/details/);
  });

  it("sets staleTime: 30_000", () => {
    expect(particularsPanel).toMatch(/staleTime.*30[_,]000/);
  });
});

// ── InvoiceParticularsPanel: header ──────────────────────────────────────────

describe("InvoiceParticularsPanel header", () => {
  it("renders data-testid=invoice-particulars-panel on root element", () => {
    expect(particularsPanel).toMatch(/data-testid="invoice-particulars-panel"/);
  });

  it("renders particulars-invoice-number testid", () => {
    expect(particularsPanel).toMatch(/data-testid="particulars-invoice-number"/);
  });

  it("renders StatusBadge with data-testid=particulars-status-badge", () => {
    expect(particularsPanel).toMatch(/data-testid="particulars-status-badge"/);
  });

  it("renders particulars-client-name testid", () => {
    expect(particularsPanel).toMatch(/data-testid="particulars-client-name"/);
  });

  it("renders Open Invoice button with data-testid=particulars-open-button", () => {
    expect(particularsPanel).toMatch(/data-testid="particulars-open-button"/);
  });

  it("Open Invoice button navigates to /invoices/:id via setLocation", () => {
    expect(particularsPanel).toMatch(/setLocation\(`\/invoices\/\$\{invoiceId\}`\)/);
  });

  it("renders close button with data-testid=particulars-close-button", () => {
    expect(particularsPanel).toMatch(/data-testid="particulars-close-button"/);
  });

  it("close button calls onClose", () => {
    expect(particularsPanel).toMatch(/onClick=\{onClose\}/);
  });
});

// ── InvoiceParticularsPanel: body fields ─────────────────────────────────────

describe("InvoiceParticularsPanel body fields", () => {
  it("renders data-testid=particulars-body on body section", () => {
    expect(particularsPanel).toMatch(/data-testid="particulars-body"/);
  });

  it("renders particulars-total testid", () => {
    expect(particularsPanel).toMatch(/data-testid="particulars-total"/);
  });

  it("renders particulars-balance testid", () => {
    expect(particularsPanel).toMatch(/data-testid="particulars-balance"/);
  });

  it("renders particulars-issue-date testid", () => {
    expect(particularsPanel).toMatch(/data-testid="particulars-issue-date"/);
  });

  it("renders particulars-due-date testid", () => {
    expect(particularsPanel).toMatch(/data-testid="particulars-due-date"/);
  });

  it("renders particulars-terms testid", () => {
    expect(particularsPanel).toMatch(/data-testid="particulars-terms"/);
  });

  it("renders particulars-linked-job testid (for invoices with a linked job)", () => {
    expect(particularsPanel).toMatch(/data-testid="particulars-linked-job"/);
  });

  it("renders particulars-description testid", () => {
    expect(particularsPanel).toMatch(/data-testid="particulars-description"/);
  });

  it("renders particulars-balance-due-row testid", () => {
    expect(particularsPanel).toMatch(/data-testid="particulars-balance-due-row"/);
  });
});

// ── InvoiceParticularsPanel: line items ──────────────────────────────────────

describe("InvoiceParticularsPanel line items", () => {
  it("renders data-testid=particulars-line-{id} per line", () => {
    expect(particularsPanel).toMatch(/data-testid=\{`particulars-line-\$\{line\.id\}`\}/);
  });

  it("shows line description, quantity, unitPrice, and lineTotal", () => {
    expect(particularsPanel).toMatch(/line\.description/);
    expect(particularsPanel).toMatch(/line\.quantity/);
    expect(particularsPanel).toMatch(/line\.unitPrice/);
    expect(particularsPanel).toMatch(/line\.lineTotal/);
  });
});

// ── InvoiceParticularsPanel: notes section ────────────────────────────────────

describe("InvoiceParticularsPanel notes section", () => {
  it("renders particulars-notes-customer when notesCustomer is present", () => {
    expect(particularsPanel).toMatch(/data-testid="particulars-notes-customer"/);
  });

  it("renders particulars-notes-internal when notesInternal is present", () => {
    expect(particularsPanel).toMatch(/data-testid="particulars-notes-internal"/);
  });

  it("renders particulars-no-notes fallback when no notes", () => {
    expect(particularsPanel).toMatch(/data-testid="particulars-no-notes"/);
  });

  it("fallback text is 'No invoice notes.'", () => {
    expect(particularsPanel).toMatch(/No invoice notes\./);
  });
});

// ── InvoiceParticularsPanel: payment summary ─────────────────────────────────

describe("InvoiceParticularsPanel payment summary", () => {
  it("renders particulars-payment-summary when amountPaid > 0", () => {
    expect(particularsPanel).toMatch(/data-testid="particulars-payment-summary"/);
  });

  it("renders particulars-no-payments fallback when no payments", () => {
    expect(particularsPanel).toMatch(/data-testid="particulars-no-payments"/);
  });

  it("fallback text is 'No payments recorded.'", () => {
    expect(particularsPanel).toMatch(/No payments recorded\./);
  });

  it("payment summary uses invoice.amountPaid (no separate payments endpoint)", () => {
    expect(particularsPanel).toMatch(/invoice\.amountPaid/);
    expect(particularsPanel).not.toMatch(/\/api\/invoices\/.*\/payments/);
    expect(particularsPanel).not.toMatch(/api\/payments/);
  });
});

// ── InvoiceParticularsPanel: taxTotal correctness ─────────────────────────────

describe("InvoiceParticularsPanel uses invoice.taxTotal not taxAmount", () => {
  it("references invoice.taxTotal for the tax row", () => {
    expect(particularsPanel).toMatch(/invoice\.taxTotal/);
  });

  it("does NOT reference invoice.taxAmount (an InvoiceLine field, not invoice-level)", () => {
    expect(particularsPanel).not.toMatch(/invoice\.taxAmount/);
  });
});

// ── InvoiceParticularsPanel: error state ─────────────────────────────────────

describe("InvoiceParticularsPanel error state", () => {
  it("renders data-testid=particulars-error on error", () => {
    expect(particularsPanel).toMatch(/data-testid="particulars-error"/);
  });
});

// ── InvoiceListPanel: InvoiceParticularsPanel integration ─────────────────────

describe("InvoiceListPanel imports InvoiceParticularsPanel", () => {
  it("imports InvoiceParticularsPanel from @/components/invoices/InvoiceParticularsPanel", () => {
    expect(invoiceListPanel).toMatch(/InvoiceParticularsPanel.*from.*invoices\/InvoiceParticularsPanel/s);
  });

  it("does NOT import InvoicePreviewPanel (replaced by InvoiceParticularsPanel)", () => {
    expect(invoiceListPanel).not.toMatch(/InvoicePreviewPanel/);
  });
});

// ── InvoiceListPanel: particularsInvoiceId derivation ────────────────────────

describe("InvoiceListPanel particularsInvoiceId", () => {
  it("derives particularsInvoiceId from receivablesMode and selectedIds.size === 1", () => {
    expect(invoiceListPanel).toMatch(/particularsInvoiceId.*receivablesMode.*selectedIds\.size === 1/s);
  });

  it("particularsInvoiceId is null when not receivablesMode or size !== 1", () => {
    expect(invoiceListPanel).toMatch(/particularsInvoiceId[\s\S]{0,200}null/);
  });
});

// ── InvoiceListPanel: clear-on-filter-out useEffect ──────────────────────────

describe("InvoiceListPanel clears selection when selected invoice is filtered out", () => {
  it("has a useEffect that checks filteredInvoices for the selected id", () => {
    expect(invoiceListPanel).toMatch(/useEffect[\s\S]{0,400}filteredInvoices\.some[\s\S]{0,100}setSelectedIds\(new Set\(\)\)/);
  });

  it("the useEffect depends on [filteredInvoices, receivablesMode, selectedIds]", () => {
    expect(invoiceListPanel).toMatch(/\[filteredInvoices, receivablesMode, selectedIds\]/);
  });

  it("the useEffect guards with receivablesMode check", () => {
    expect(invoiceListPanel).toMatch(/if \(!receivablesMode\) return/);
  });
});

// ── InvoiceListPanel: particulars container in receivablesMode ────────────────

describe("InvoiceListPanel invoice-particulars-container", () => {
  it("renders data-testid=invoice-particulars-container when particularsInvoiceId is set", () => {
    const modeStart = invoiceListPanel.indexOf("if (receivablesMode)");
    const modeEnd   = invoiceListPanel.indexOf("// ── Standard mode layout");
    const modeBlock = invoiceListPanel.slice(modeStart, modeEnd);
    expect(modeBlock).toMatch(/data-testid="invoice-particulars-container"/);
  });

  it("particulars container is conditional on particularsInvoiceId", () => {
    expect(invoiceListPanel).toMatch(/\{particularsInvoiceId &&[\s\S]{0,200}invoice-particulars-container/);
  });

  it("particulars container is INSIDE the single scroll wrapper (not a sibling flex-1 container)", () => {
    // The container must appear AFTER the opening of the scroll wrapper div but before its closing.
    // We check that invoice-particulars-container appears after invoice-table-area in the same block.
    const tableAreaIdx    = invoiceListPanel.indexOf('data-testid="invoice-table-area"');
    const particularsIdx  = invoiceListPanel.indexOf('data-testid="invoice-particulars-container"');
    expect(tableAreaIdx).toBeGreaterThan(0);
    expect(particularsIdx).toBeGreaterThan(tableAreaIdx);
  });

  it("passes invoiceId={particularsInvoiceId} to InvoiceParticularsPanel", () => {
    expect(invoiceListPanel).toMatch(/invoiceId=\{particularsInvoiceId\}/);
  });

  it("passes onClose that calls setSelectedIds(new Set()) to InvoiceParticularsPanel", () => {
    expect(invoiceListPanel).toMatch(/onClose=\{\(\) => setSelectedIds\(new Set\(\)\)\}/);
  });
});

// ── InvoiceListPanel: fillHeight={!particularsInvoiceId} ─────────────────────

describe("InvoiceListPanel EntityListTable fillHeight adapts to particulars panel", () => {
  it("passes fillHeight={!particularsInvoiceId} in receivablesMode", () => {
    const modeStart = invoiceListPanel.indexOf("if (receivablesMode)");
    const modeEnd   = invoiceListPanel.indexOf("// ── Standard mode layout");
    const modeBlock = invoiceListPanel.slice(modeStart, modeEnd);
    expect(modeBlock).toMatch(/fillHeight=\{!particularsInvoiceId\}/);
  });
});

// ── InvoiceListPanel: bulk bar hidden in receivablesMode ─────────────────────

describe("InvoiceListPanel bulk action bar hidden in receivablesMode", () => {
  it("bulkBarNode is gated with !receivablesMode", () => {
    expect(invoiceListPanel).toMatch(/bulkBarNode = !receivablesMode/);
  });

  it("bulk-action-bar testid exists in the file (defined in bulkBarNode) but not inside the receivablesMode return block", () => {
    // The testid is in the shared bulkBarNode const (defined before receivablesMode check).
    expect(invoiceListPanel).toMatch(/bulk-action-bar/);
    // The receivablesMode early return block must NOT render {bulkBarNode} directly.
    const modeStart = invoiceListPanel.indexOf("if (receivablesMode)");
    const modeEnd   = invoiceListPanel.indexOf("// ── Standard mode layout");
    const modeBlock = invoiceListPanel.slice(modeStart, modeEnd);
    expect(modeBlock).not.toMatch(/\{bulkBarNode\}/);
  });

  it("standard mode still renders bulkBarNode (behavior preserved)", () => {
    const standardStart = invoiceListPanel.indexOf("// ── Standard mode layout");
    const standardBlock = invoiceListPanel.slice(standardStart);
    expect(standardBlock).toMatch(/\{bulkBarNode\}/);
  });
});
