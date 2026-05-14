/**
 * Receivables row interaction model tests (2026-05-13).
 *
 * Verifies the row-click interaction change in InvoiceListPanel receivablesMode:
 *   - Row click selects the invoice (populates right rail) instead of navigating
 *   - Open button navigates to /invoices/:id and stops row propagation
 *   - Standard mode row click still navigates
 *   - Selected row visual state (selectedRowKey + selectedHighlightClass)
 *   - Right rail context propagation via onSelectionChange
 *   - EntityListTable selectedHighlightClass prop
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

const invoiceListPanel = src("client/src/components/invoices/InvoiceListPanel.tsx");
const entityListTable  = src("client/src/components/lists/EntityListTable.tsx");

// ── EntityListTable selectedHighlightClass prop ───────────────────────────────

describe("EntityListTable selectedHighlightClass prop", () => {
  it("accepts selectedHighlightClass in EntityListTableProps interface", () => {
    expect(entityListTable).toMatch(/selectedHighlightClass\?.*string/);
  });

  it("applies selectedHighlightClass to selected row (with fallback to bg-slate-50)", () => {
    expect(entityListTable).toMatch(/selectedHighlightClass.*"bg-slate-50"/s);
  });

  it("threads selectedHighlightClass into RenderRowArgs", () => {
    expect(entityListTable).toMatch(/interface RenderRowArgs[\s\S]{0,300}selectedHighlightClass\?/);
  });

  it("threads selectedHighlightClass into RenderGroupedBodyArgs", () => {
    expect(entityListTable).toMatch(/interface RenderGroupedBodyArgs[\s\S]{0,300}selectedHighlightClass\?/);
  });
});

// ── Receivables mode: row click selects, does not navigate ───────────────────

describe("InvoiceListPanel receivablesMode row click selects", () => {
  it("receivablesMode onRowClick calls setSelectedIds with a new Set of that invoice", () => {
    // The receivablesMode EntityListTable passes this handler.
    expect(invoiceListPanel).toMatch(/onRowClick=\{\(invoice\) => setSelectedIds\(new Set\(\[invoice\.id\]\)\)\}/);
  });

  it("receivablesMode onRowClick does NOT call setLocation directly", () => {
    // setLocation in onRowClick only appears in standard mode, not the receivablesMode early return path.
    // The receivablesMode block starts with "if (receivablesMode)" and ends before "// ── Standard mode".
    const modeStart = invoiceListPanel.indexOf("if (receivablesMode)");
    const modeEnd   = invoiceListPanel.indexOf("// ── Standard mode layout");
    const modeBlock = invoiceListPanel.slice(modeStart, modeEnd);
    // onRowClick in receivablesMode must NOT contain setLocation.
    expect(modeBlock).not.toMatch(/onRowClick=\{.*setLocation/);
  });

  it("receivablesMode passes selectedRowKey derived from single selected id", () => {
    expect(invoiceListPanel).toMatch(/receivablesSelectedKey/);
    expect(invoiceListPanel).toMatch(/selectedIds\.size === 1[\s\S]{0,100}Array\.from\(selectedIds\)\[0\]/);
  });

  it("receivablesMode passes selectedHighlightClass='bg-blue-50'", () => {
    const modeStart = invoiceListPanel.indexOf("if (receivablesMode)");
    const modeEnd   = invoiceListPanel.indexOf("// ── Standard mode layout");
    const modeBlock = invoiceListPanel.slice(modeStart, modeEnd);
    expect(modeBlock).toMatch(/selectedHighlightClass="bg-blue-50"/);
  });

  it("receivablesMode passes selectedRowKey={receivablesSelectedKey} to EntityListTable", () => {
    const modeStart = invoiceListPanel.indexOf("if (receivablesMode)");
    const modeEnd   = invoiceListPanel.indexOf("// ── Standard mode layout");
    const modeBlock = invoiceListPanel.slice(modeStart, modeEnd);
    expect(modeBlock).toMatch(/selectedRowKey=\{receivablesSelectedKey\}/);
  });
});

// ── Standard mode: row click still navigates ─────────────────────────────────

describe("InvoiceListPanel standard mode row click navigates", () => {
  it("standard mode onRowClick calls setLocation with /invoices/:id", () => {
    const standardStart = invoiceListPanel.indexOf("// ── Standard mode layout");
    const standardBlock = invoiceListPanel.slice(standardStart);
    expect(standardBlock).toMatch(/onRowClick=\{\(invoice\) => setLocation\(`\/invoices\/\$\{invoice\.id\}`\)\}/);
  });

  it("standard mode does NOT use receivablesColumns (uses invoiceColumns)", () => {
    const standardStart = invoiceListPanel.indexOf("// ── Standard mode layout");
    const standardBlock = invoiceListPanel.slice(standardStart);
    // The standard mode table should use invoiceColumns, not receivablesColumns.
    expect(standardBlock).toMatch(/columns=\{invoiceColumns\}/);
    expect(standardBlock).not.toMatch(/columns=\{receivablesColumns\}/);
  });

  it("standard mode does NOT pass selectedRowKey", () => {
    const standardStart = invoiceListPanel.indexOf("// ── Standard mode layout");
    const standardBlock = invoiceListPanel.slice(standardStart);
    expect(standardBlock).not.toMatch(/selectedRowKey=/);
  });
});

// ── Open button column ────────────────────────────────────────────────────────

describe("InvoiceListPanel open button in receivablesColumns", () => {
  it("receivablesColumns is defined and includes invoiceColumns", () => {
    expect(invoiceListPanel).toMatch(/receivablesColumns/);
    expect(invoiceListPanel).toMatch(/\.\.\.invoiceColumns/);
  });

  it("open column renders a button with data-testid button-open-invoice-{id}", () => {
    expect(invoiceListPanel).toMatch(/data-testid=\{`button-open-invoice-\$\{invoice\.id\}`\}/);
  });

  it("open column button navigates to /invoices/:id via setLocation", () => {
    const colBlock = (() => {
      const start = invoiceListPanel.indexOf("id: \"open\"");
      return invoiceListPanel.slice(start, start + 600);
    })();
    expect(colBlock).toMatch(/setLocation\(`\/invoices\/\$\{invoice\.id\}`\)/);
  });

  it("open column uses kind: 'select' which stops click propagation at the cell level", () => {
    const colBlock = (() => {
      const start = invoiceListPanel.indexOf("id: \"open\"");
      return invoiceListPanel.slice(start, start + 300);
    })();
    expect(colBlock).toMatch(/kind: "select"/);
  });

  it("open column renders ExternalLink icon", () => {
    const colBlock = (() => {
      const start = invoiceListPanel.indexOf("id: \"open\"");
      return invoiceListPanel.slice(start, start + 600);
    })();
    expect(colBlock).toMatch(/ExternalLink/);
  });

  it("ExternalLink is imported from lucide-react", () => {
    expect(invoiceListPanel).toMatch(/ExternalLink.*from "lucide-react"/s);
  });

  it("receivablesMode table uses receivablesColumns not invoiceColumns", () => {
    const modeStart = invoiceListPanel.indexOf("if (receivablesMode)");
    const modeEnd   = invoiceListPanel.indexOf("// ── Standard mode layout");
    const modeBlock = invoiceListPanel.slice(modeStart, modeEnd);
    expect(modeBlock).toMatch(/columns=\{receivablesColumns\}/);
    expect(modeBlock).not.toMatch(/columns=\{invoiceColumns\}/);
  });
});

// ── Right rail context propagation ───────────────────────────────────────────

describe("Right rail receives selected invoice context", () => {
  it("onSelectionChange useEffect is still present", () => {
    expect(invoiceListPanel).toMatch(/onSelectionChange/);
  });

  it("onSelectionChange is called with selectedInvoiceIds from selectedIds", () => {
    expect(invoiceListPanel).toMatch(/onSelectionChange\(\{.*selectedInvoiceIds.*ids/s);
  });

  it("selecting a row via setSelectedIds triggers the useEffect that calls onSelectionChange", () => {
    // The useEffect depends on [selectedIds, enrichedInvoices, onSelectionChange].
    expect(invoiceListPanel).toMatch(/\[selectedIds, enrichedInvoices, onSelectionChange\]/);
  });
});

// ── Multi-select checkbox behavior preserved ──────────────────────────────────

describe("Multi-select checkbox behavior preserved", () => {
  it("checkbox onCheckedChange still toggles ids in selectedIds", () => {
    expect(invoiceListPanel).toMatch(/onCheckedChange=\{\(v\)[\s\S]{0,300}next\.add\(invoice\.id\)/);
  });

  it("select-all checkbox still selects all filtered invoices", () => {
    expect(invoiceListPanel).toMatch(/setSelectedIds\(new Set\(filteredInvoices\.map/);
  });

  it("bulk action bar is still present for multi-select", () => {
    expect(invoiceListPanel).toMatch(/selectedIds\.size > 0.*filteredInvoices\.length > 0/s);
  });
});
