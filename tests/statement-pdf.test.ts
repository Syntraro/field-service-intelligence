/**
 * Source-level tests for the customer statement feature.
 *
 * Tests cover:
 *  1.  Statement endpoints are scoped by companyId (tenant isolation).
 *  2.  Statement only includes outstanding invoices (correct status list — draft excluded).
 *  3.  Excludes paid / voided / zero-balance / draft invoices.
 *  4.  Invoices include locationName and locationAddress inline (flat list, no groups).
 *  5.  Totals and aging are computed from the flat invoice list.
 *  6.  Aging bands are computed correctly by computeAgingBands().
 *  7.  Statement PDF endpoint streams a PDF.
 *  8.  Send Statement uses statement PDF (not invoice PDFs).
 *  9.  Frontend hook routes "statement" entity to the correct endpoints.
 * 10.  SendCommunicationModal handles "statement" title.
 * 11.  locationId is accepted in all statement endpoints.
 * 12.  Location-scoped endpoints validate the location belongs to the customer + tenant.
 * 13.  PDF table uses columns: Invoice #, Location, Description, Due Date, Amount Due.
 * 14.  PDF no longer renders bottom Payment Options / Questions / Please Include boxes.
 * 15.  PDF no longer renders Date Issued or Status columns.
 * 16.  TOTAL AMOUNT DUE row always rendered (no Location Total variant).
 * 17.  statement-preview accepts locationId; email body reflects scope.
 * 18.  service-locations endpoint exists and is tenant-scoped.
 * 19.  Frontend scope picker opens when multiple locations exist.
 * 20.  SendCommunicationModal accepts locationId prop.
 * 21.  PDF title is "STATEMENT" (not "CUSTOMER STATEMENT").
 * 22.  Account Summary, Aging Summary, Account Information cards not rendered.
 * 23.  BILL TO section present.
 * 24.  FOOTER_RESERVE defined; tableBottomY = pageH - FOOTER_RESERVE.
 * 25.  Y-tracking reads doc.y after wrapped address in header and Bill To section.
 */

import { readFileSync } from "fs";
import { describe, it, expect } from "vitest";
import { resolve } from "path";
import { computeAgingBands } from "../server/services/statementPdfService";

const ROUTE_SRC = readFileSync(
  resolve(__dirname, "../server/routes/customer-companies.ts"),
  "utf8",
);

const PDF_SRC = readFileSync(
  resolve(__dirname, "../server/services/statementPdfService.ts"),
  "utf8",
);

const HOOK_SRC = readFileSync(
  resolve(__dirname, "../client/src/hooks/useSendCommunicationModal.ts"),
  "utf8",
);

const MODAL_SRC = readFileSync(
  resolve(__dirname, "../client/src/components/communication/SendCommunicationModal.tsx"),
  "utf8",
);

const COLLECTIONS_SRC = readFileSync(
  resolve(__dirname, "../client/src/components/collections/ClientCollectionsModal.tsx"),
  "utf8",
);

// Isolate statement-related route block
const STATEMENT_BLOCK_START = ROUTE_SRC.indexOf("STATEMENT_INVOICE_STATUSES");
const STATEMENT_BLOCK_END = ROUTE_SRC.indexOf("\n/**\n * GET /api/customer-companies/ar-queue");
const STATEMENT_BLOCK =
  STATEMENT_BLOCK_END > 0
    ? ROUTE_SRC.slice(STATEMENT_BLOCK_START, STATEMENT_BLOCK_END)
    : ROUTE_SRC.slice(STATEMENT_BLOCK_START);

// ─── Tenant isolation ─────────────────────────────────────────────────────────

describe("statement — tenant isolation", () => {
  it("buildStatementData filters invoices by companyId (tenant)", () => {
    expect(STATEMENT_BLOCK).toMatch(/eq\(invoices\.companyId,\s*companyId\)/);
  });

  it("buildStatementData filters invoices by customerCompanyId", () => {
    expect(STATEMENT_BLOCK).toMatch(/eq\(invoices\.customerCompanyId,\s*customerCompanyId\)/);
  });

  it("buildStatementData validates customer company belongs to tenant", () => {
    expect(STATEMENT_BLOCK).toMatch(/eq\(customerCompanies\.companyId,\s*companyId\)/);
  });

  it("locationId validation scopes by companyId and parentCompanyId", () => {
    expect(STATEMENT_BLOCK).toMatch(/eq\(clientLocations\.companyId,\s*companyId\)/);
    expect(STATEMENT_BLOCK).toMatch(/eq\(clientLocations\.parentCompanyId,\s*customerCompanyId\)/);
  });

  it("service-locations endpoint validates customer belongs to tenant", () => {
    const svcBlock = ROUTE_SRC.slice(ROUTE_SRC.indexOf("service-locations"));
    expect(svcBlock).toMatch(/eq\(customerCompanies\.companyId,\s*companyId/);
  });
});

// ─── Invoice inclusion rules ──────────────────────────────────────────────────

describe("statement — invoice inclusion rules", () => {
  it("STATEMENT_INVOICE_STATUSES includes awaiting_payment, sent, partial_paid", () => {
    const match = STATEMENT_BLOCK.match(/STATEMENT_INVOICE_STATUSES\s*=\s*(\[[\s\S]*?\])\s*as const/);
    expect(match).not.toBeNull();
    const arr = match![1];
    expect(arr).toContain('"awaiting_payment"');
    expect(arr).toContain('"sent"');
    expect(arr).toContain('"partial_paid"');
  });

  it("STATEMENT_INVOICE_STATUSES excludes draft, paid, and voided", () => {
    const match = STATEMENT_BLOCK.match(/STATEMENT_INVOICE_STATUSES\s*=\s*(\[[\s\S]*?\])\s*as const/);
    expect(match).not.toBeNull();
    const arr = match![1];
    expect(arr).not.toContain('"draft"');
    expect(arr).not.toContain('"paid"');
    expect(arr).not.toContain('"voided"');
  });

  it("applies inArray status filter on statement invoice query", () => {
    expect(STATEMENT_BLOCK).toMatch(/inArray\(invoices\.status,\s*STATEMENT_INVOICE_STATUSES/);
  });

  it("excludes zero-balance invoices from statement", () => {
    expect(STATEMENT_BLOCK).toMatch(/CAST\(\$\{invoices\.balance\}\s*AS\s*numeric\)\s*>\s*0/);
  });
});

// ─── Flat invoice list (no location grouping) ─────────────────────────────────

describe("statement — flat invoice list", () => {
  it("maps each invoice to a flat item with locationName and locationAddress", () => {
    expect(STATEMENT_BLOCK).toContain("flatInvoices");
    expect(STATEMENT_BLOCK).toContain("locationName");
    expect(STATEMENT_BLOCK).toContain("locationAddress");
  });

  it("does not use grouped Map structure for invoice grouping", () => {
    // The old locationGroups Map is gone; flat list instead
    expect(STATEMENT_BLOCK).not.toContain("grouped = new Map");
    expect(STATEMENT_BLOCK).not.toContain("locationGroups");
  });

  it("returns invoices (flat) in statementData", () => {
    expect(STATEMENT_BLOCK).toContain("invoices: flatInvoices");
  });
});

// ─── Totals ───────────────────────────────────────────────────────────────────

describe("statement — totals", () => {
  it("computes totalOutstanding from all invoice balances", () => {
    expect(STATEMENT_BLOCK).toContain("totalOutstanding");
  });

  it("computes pastDueTotal from past-due invoices", () => {
    expect(STATEMENT_BLOCK).toContain("pastDueTotal");
  });

  it("computes currentTotal from non-past-due invoices", () => {
    expect(STATEMENT_BLOCK).toContain("currentTotal");
  });
});

// ─── Location scope ───────────────────────────────────────────────────────────

describe("statement — location scope", () => {
  it("buildStatementData accepts optional locationId parameter", () => {
    expect(STATEMENT_BLOCK).toMatch(/buildStatementData\s*\([\s\S]*?locationId\?/);
  });

  it("applies eq(invoices.locationId, locationId) when locationId is provided", () => {
    expect(STATEMENT_BLOCK).toMatch(/eq\(invoices\.locationId,\s*locationId\)/);
  });

  it("validates locationId belongs to customer and tenant before using it", () => {
    expect(STATEMENT_BLOCK).toMatch(/eq\(clientLocations\.id,\s*locationId\)/);
    expect(STATEMENT_BLOCK).toContain("Location not found or does not belong to this customer");
  });

  it("sets scopeLabel to location name when locationId provided, null otherwise", () => {
    expect(STATEMENT_BLOCK).toContain("scopeLabel");
    expect(STATEMENT_BLOCK).toContain("locationId ?");
  });

  it("statement.pdf endpoint accepts locationId query param", () => {
    expect(STATEMENT_BLOCK).toContain("req.query.locationId");
  });

  it("send-statement endpoint accepts locationId in body", () => {
    expect(STATEMENT_BLOCK).toMatch(/locationId:\s*z\.string\(\)\.nullable\(\)/);
  });

  it("statement-preview endpoint reads locationId from body", () => {
    expect(STATEMENT_BLOCK).toContain("req.body?.locationId");
  });

  it("statement-preview body reflects location scope when locationId provided", () => {
    expect(STATEMENT_BLOCK).toContain("Please find attached the statement for");
  });

  it("statement-preview body uses full-account text when no locationId", () => {
    expect(STATEMENT_BLOCK).toContain("Please find attached your account statement from");
  });
});

// ─── service-locations endpoint ───────────────────────────────────────────────

describe("service-locations endpoint", () => {
  it("GET service-locations endpoint exists", () => {
    expect(ROUTE_SRC).toContain("service-locations");
  });

  it("returns { locations } array", () => {
    const svcBlock = ROUTE_SRC.slice(ROUTE_SRC.indexOf("service-locations"));
    expect(svcBlock).toContain("{ locations }");
  });

  it("scopes by companyId and parentCompanyId", () => {
    const svcBlock = ROUTE_SRC.slice(ROUTE_SRC.indexOf("service-locations"));
    expect(svcBlock).toMatch(/eq\(clientLocations\.parentCompanyId,\s*customerCompanyId\)/);
  });

  it("filters out soft-deleted locations", () => {
    const svcBlock = ROUTE_SRC.slice(ROUTE_SRC.indexOf("service-locations"));
    expect(svcBlock).toMatch(/isNull\(clientLocations\.deletedAt\)/);
  });
});

// ─── PDF endpoint ─────────────────────────────────────────────────────────────

describe("statement — PDF endpoint", () => {
  it("GET statement.pdf calls buildStatementData and generateStatementPdf", () => {
    expect(STATEMENT_BLOCK).toContain("statement.pdf");
    expect(STATEMENT_BLOCK).toContain("buildStatementData");
    expect(STATEMENT_BLOCK).toContain("generateStatementPdf");
  });

  it("returns PDF with correct Content-Type", () => {
    expect(STATEMENT_BLOCK).toContain("application/pdf");
  });
});

// ─── Send endpoint ────────────────────────────────────────────────────────────

describe("statement — send endpoint", () => {
  it("POST send-statement calls generateStatementPdf (not invoice PDF)", () => {
    expect(STATEMENT_BLOCK).toContain("send-statement");
    expect(STATEMENT_BLOCK).toContain("generateStatementPdf(statementData)");
    expect(STATEMENT_BLOCK).not.toContain("generateInvoicePdf");
  });

  it("validates recipients list is non-empty", () => {
    expect(STATEMENT_BLOCK).toMatch(/recipients.*min\(1/);
  });

  it("normalizes recipients via normalizeEmailList", () => {
    expect(STATEMENT_BLOCK).toContain("normalizeEmailList");
  });

  it("attaches statement PDF (not individual invoice PDFs)", () => {
    expect(STATEMENT_BLOCK).toContain("Statement-");
    expect(STATEMENT_BLOCK).toContain("pdfFilename");
  });

  it("returns success: true on send", () => {
    expect(STATEMENT_BLOCK).toContain("{ success: true }");
  });
});

// ─── Recipients endpoint ──────────────────────────────────────────────────────

describe("statement — recipients endpoint", () => {
  it("GET statement-recipients returns recipients array", () => {
    expect(STATEMENT_BLOCK).toContain("statement-recipients");
    expect(STATEMENT_BLOCK).toMatch(/res\.json\(\{.*recipients/);
  });

  it("scopes recipient lookup by tenant companyId", () => {
    const recipBlock = STATEMENT_BLOCK.slice(
      STATEMENT_BLOCK.indexOf("statement-recipients"),
      STATEMENT_BLOCK.indexOf("statement-preview"),
    );
    expect(recipBlock).toMatch(/eq\(customerCompanies\.companyId,\s*companyId/);
  });
});

// ─── Preview endpoint ─────────────────────────────────────────────────────────

describe("statement — preview endpoint", () => {
  it("POST statement-preview returns subject and body", () => {
    expect(STATEMENT_BLOCK).toContain("statement-preview");
    expect(STATEMENT_BLOCK).toContain("`Statement from ${companyName}`");
  });
});

// ─── PDF layout — columns ─────────────────────────────────────────────────────

describe("statementPdfService — column layout", () => {
  it("defines COL_LOC_X and COL_LOC_W for Location column", () => {
    expect(PDF_SRC).toContain("COL_LOC_X");
    expect(PDF_SRC).toContain("COL_LOC_W");
  });

  it("defines COL_AMT_X and COL_AMT_W for Amount Due column", () => {
    expect(PDF_SRC).toContain("COL_AMT_X");
    expect(PDF_SRC).toContain("COL_AMT_W");
  });

  it("table header renders Invoice #, Location, Description, Due Date, Amount Due", () => {
    expect(PDF_SRC).toContain('"Invoice #"');
    expect(PDF_SRC).toContain('"Location"');
    expect(PDF_SRC).toContain('"Description"');
    expect(PDF_SRC).toContain('"Due Date"');
    expect(PDF_SRC).toContain('"Amount Due"');
  });

  it("does NOT render Date Issued column", () => {
    expect(PDF_SRC).not.toContain('"Date Issued"');
    expect(PDF_SRC).not.toContain("COL_ISSUE_X");
    expect(PDF_SRC).not.toContain("COL_ISSUE_W");
  });

  it("does NOT render Status column", () => {
    expect(PDF_SRC).not.toContain('"Status"');
    expect(PDF_SRC).not.toContain("COL_STATUS_X");
    expect(PDF_SRC).not.toContain("COL_STATUS_W");
  });
});

// ─── PDF layout — removed bottom boxes ────────────────────────────────────────

describe("statementPdfService — removed bottom boxes", () => {
  it("does NOT render Payment Options box", () => {
    expect(PDF_SRC).not.toContain("Payment Options");
  });

  it("does NOT render Questions box", () => {
    expect(PDF_SRC).not.toContain('"Questions?"');
    expect(PDF_SRC).not.toContain('"Questions"');
  });

  it("does NOT render Please Include With Payment box", () => {
    expect(PDF_SRC).not.toContain("Please Include With Payment");
  });

  it("does NOT have drawInfoBox helper (used only for the removed bottom boxes)", () => {
    expect(PDF_SRC).not.toContain("drawInfoBox");
  });
});

// ─── PDF layout — flat table + total row ──────────────────────────────────────

describe("statementPdfService — flat table and total row", () => {
  it("iterates over a flat invoices array (no location group loop)", () => {
    expect(PDF_SRC).toContain("for (const inv of invoices)");
    expect(PDF_SRC).not.toContain("for (const group of locationGroups)");
  });

  it("always renders TOTAL AMOUNT DUE (uppercase) regardless of scope", () => {
    expect(PDF_SRC).toContain('"TOTAL AMOUNT DUE"');
    expect(PDF_SRC).not.toContain('"Total Amount Due"');
    expect(PDF_SRC).not.toContain('"Location Total"');
  });

  it("section title is ACCOUNT ACTIVITY (not BY LOCATION)", () => {
    expect(PDF_SRC).toContain('"ACCOUNT ACTIVITY"');
    expect(PDF_SRC).not.toContain("ACCOUNT ACTIVITY BY LOCATION");
  });
});

// ─── PDF layout — title and removed summary cards ─────────────────────────────

describe("statementPdfService — title and removed summary cards", () => {
  it("PDF title is 'STATEMENT' (not 'CUSTOMER STATEMENT')", () => {
    expect(PDF_SRC).toContain('"STATEMENT"');
    expect(PDF_SRC).not.toContain('"CUSTOMER STATEMENT"');
  });

  it("does NOT render Account Summary card", () => {
    expect(PDF_SRC).not.toContain('"ACCOUNT SUMMARY"');
  });

  it("does NOT render Aging Summary card", () => {
    expect(PDF_SRC).not.toContain('"AGING SUMMARY"');
  });

  it("does NOT render Account Information card", () => {
    expect(PDF_SRC).not.toContain('"ACCOUNT INFORMATION"');
  });

  it("aging field kept in StatementPdfData interface for backend compatibility", () => {
    expect(PDF_SRC).toContain("aging:");
    expect(PDF_SRC).toContain("band0to30");
  });

  it("aging data is not rendered in the PDF body", () => {
    expect(PDF_SRC).not.toContain("agingScopeLabel");
    expect(PDF_SRC).not.toContain("All Locations");
    expect(PDF_SRC).not.toContain('"0–30"');
    expect(PDF_SRC).not.toContain('"31–60"');
    expect(PDF_SRC).not.toContain('"61–90"');
  });
});

// ─── PDF layout — bill to section ─────────────────────────────────────────────

describe("statementPdfService — bill to section", () => {
  it("renders BILL TO label", () => {
    expect(PDF_SRC).toContain('"BILL TO"');
  });

  it("bill to section is between header divider and account activity table", () => {
    const billToIdx = PDF_SRC.indexOf('"BILL TO"');
    const activityIdx = PDF_SRC.indexOf('"ACCOUNT ACTIVITY"');
    const headerLineIdx = PDF_SRC.indexOf("headerBottom");
    expect(billToIdx).toBeGreaterThan(headerLineIdx);
    expect(billToIdx).toBeLessThan(activityIdx);
  });
});

// ─── PDF layout — pagination and footer reserve ────────────────────────────────

describe("statementPdfService — pagination and footer reserve", () => {
  it("defines FOOTER_RESERVE constant", () => {
    expect(PDF_SRC).toContain("FOOTER_RESERVE");
  });

  it("FOOTER_RESERVE is at least 75pt", () => {
    const match = PDF_SRC.match(/FOOTER_RESERVE\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(parseInt(match![1], 10)).toBeGreaterThanOrEqual(75);
  });

  it("tableBottomY is computed as pageH minus FOOTER_RESERVE", () => {
    expect(PDF_SRC).toMatch(/tableBottomY\s*=\s*pageH\s*-\s*FOOTER_RESERVE/);
  });

  it("ensureRoom uses tableBottomY as page-break threshold", () => {
    expect(PDF_SRC).toContain("tableBottomY");
    expect(PDF_SRC).toMatch(/rowY\s*\+\s*needed\s*<=\s*tableBottomY/);
  });

  it("footer page number Y stays within bottom margin (no phantom page 2)", () => {
    // pageH - 38 = 754 exceeds PDFKit maxY (pageH - PAGE_MARGIN = 742) and
    // triggers an auto-page-add, producing a blank second page on short statements.
    expect(PDF_SRC).not.toMatch(/pageH\s*-\s*38\b/);
    // Must reference PAGE_MARGIN so the value is always within maxY regardless of page size.
    expect(PDF_SRC).toMatch(/pageH\s*-\s*PAGE_MARGIN\s*-\s*\d+/);
  });
});

// ─── PDF layout — Y-tracking after wrapped addresses ─────────────────────────

describe("statementPdfService — Y-tracking after wrapped addresses", () => {
  it("reads doc.y after billingAddress write in header to prevent overlap", () => {
    expect(PDF_SRC).toContain("metaY = doc.y");
  });

  it("reads doc.y after billingAddress write in Bill To section", () => {
    expect(PDF_SRC).toContain("cursorY = doc.y");
  });
});

// ─── PDF layout — total amount due row ────────────────────────────────────────

describe("statementPdfService — total amount due row", () => {
  it("renders exactly one TOTAL AMOUNT DUE row (no Location Total variant)", () => {
    const matches = PDF_SRC.match(/"TOTAL AMOUNT DUE"/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it("total row uses accent divider line before the label", () => {
    const totalIdx = PDF_SRC.indexOf('"TOTAL AMOUNT DUE"');
    const strokeBeforeTotal = PDF_SRC.lastIndexOf(".stroke()", totalIdx);
    expect(strokeBeforeTotal).toBeGreaterThan(0);
    expect(totalIdx - strokeBeforeTotal).toBeLessThan(400);
  });

  it("total amount renders totalOutstanding right-aligned", () => {
    const totalIdx = PDF_SRC.indexOf('"TOTAL AMOUNT DUE"');
    const snippet = PDF_SRC.slice(totalIdx, totalIdx + 300);
    expect(snippet).toContain("totals.totalOutstanding");
    expect(snippet).toContain('align: "right"');
  });
});

// ─── Aging bands unit tests ───────────────────────────────────────────────────

describe("computeAgingBands — aging computation", () => {
  const TODAY = new Date("2026-05-12");

  it("places current (not-yet-due) invoices in 0–30 band", () => {
    const bands = computeAgingBands(
      [{ dueDate: "2026-05-20", balance: "100.00", isPastDue: false }],
      TODAY,
    );
    expect(parseFloat(bands.band0to30)).toBeCloseTo(100, 1);
    expect(parseFloat(bands.band31to60)).toBe(0);
    expect(parseFloat(bands.band61to90)).toBe(0);
    expect(parseFloat(bands.bandOver90)).toBe(0);
  });

  it("places 15-day overdue invoices in 0–30 band", () => {
    const bands = computeAgingBands(
      [{ dueDate: "2026-04-27", balance: "200.00", isPastDue: true }],
      TODAY,
    );
    expect(parseFloat(bands.band0to30)).toBeCloseTo(200, 1);
  });

  it("places 45-day overdue invoices in 31–60 band", () => {
    const bands = computeAgingBands(
      [{ dueDate: "2026-03-28", balance: "300.00", isPastDue: true }],
      TODAY,
    );
    expect(parseFloat(bands.band31to60)).toBeCloseTo(300, 1);
  });

  it("places 75-day overdue invoices in 61–90 band", () => {
    const bands = computeAgingBands(
      [{ dueDate: "2026-02-26", balance: "400.00", isPastDue: true }],
      TODAY,
    );
    expect(parseFloat(bands.band61to90)).toBeCloseTo(400, 1);
  });

  it("places 100-day overdue invoices in over-90 band", () => {
    const bands = computeAgingBands(
      [{ dueDate: "2026-02-01", balance: "500.00", isPastDue: true }],
      TODAY,
    );
    expect(parseFloat(bands.bandOver90)).toBeCloseTo(500, 1);
  });

  it("skips zero-balance invoices", () => {
    const bands = computeAgingBands(
      [{ dueDate: "2026-02-01", balance: "0.00", isPastDue: false }],
      TODAY,
    );
    expect(parseFloat(bands.band0to30)).toBe(0);
    expect(parseFloat(bands.bandOver90)).toBe(0);
  });

  it("handles null dueDate — places in 0–30 band", () => {
    const bands = computeAgingBands(
      [{ dueDate: null, balance: "150.00", isPastDue: false }],
      TODAY,
    );
    expect(parseFloat(bands.band0to30)).toBeCloseTo(150, 1);
  });

  it("handles multiple invoices across bands", () => {
    const bands = computeAgingBands(
      [
        { dueDate: "2026-05-01", balance: "100.00", isPastDue: false },
        { dueDate: "2026-03-28", balance: "200.00", isPastDue: true },
        { dueDate: "2026-02-26", balance: "300.00", isPastDue: true },
        { dueDate: "2026-02-01", balance: "400.00", isPastDue: true },
      ],
      TODAY,
    );
    expect(parseFloat(bands.band0to30)).toBeCloseTo(100, 1);
    expect(parseFloat(bands.band31to60)).toBeCloseTo(200, 1);
    expect(parseFloat(bands.band61to90)).toBeCloseTo(300, 1);
    expect(parseFloat(bands.bandOver90)).toBeCloseTo(400, 1);
  });
});

// ─── Frontend hook ────────────────────────────────────────────────────────────

describe("useSendCommunicationModal — statement entity type", () => {
  it("CommunicationEntityType includes 'statement'", () => {
    expect(HOOK_SRC).toContain('"statement"');
  });

  it("resolveEndpoints maps statement to statement-recipients", () => {
    expect(HOOK_SRC).toContain("statement-recipients");
  });

  it("resolveEndpoints maps statement to statement-preview", () => {
    expect(HOOK_SRC).toContain("statement-preview");
  });

  it("resolveEndpoints maps statement to send-statement", () => {
    expect(HOOK_SRC).toContain("send-statement");
  });

  it("locationScopeId option is supported", () => {
    expect(HOOK_SRC).toContain("locationScopeId");
  });

  it("preview POST body includes locationId when locationScopeId provided", () => {
    expect(HOOK_SRC).toContain("locationId: locationScopeId");
  });

  it("send payload includes locationId for statement type", () => {
    expect(HOOK_SRC).toMatch(/entityType.*statement.*locationScopeId|locationScopeId.*statement/);
  });

  it("load cache key includes locationScopeId to re-fetch on scope change", () => {
    expect(HOOK_SRC).toContain(":${locationScopeId");
  });
});

// ─── SendCommunicationModal ───────────────────────────────────────────────────

describe("SendCommunicationModal — statement", () => {
  it("defaultTitle returns 'Send Statement' for statement entity type", () => {
    expect(MODAL_SRC).toContain('"Send Statement"');
  });

  it("accepts locationId prop", () => {
    expect(MODAL_SRC).toContain("locationId?:");
  });

  it("passes locationId to hook as locationScopeId", () => {
    expect(MODAL_SRC).toContain("locationScopeId: locationId");
  });
});

// ─── ClientCollectionsModal ───────────────────────────────────────────────────

describe("ClientCollectionsModal — send statement integration", () => {
  it("imports SendCommunicationModal", () => {
    expect(COLLECTIONS_SRC).toContain("SendCommunicationModal");
  });

  it("uses entityType='statement' for statement flow", () => {
    expect(COLLECTIONS_SRC).toContain('entityType="statement"');
  });

  it("passes activeCustomerCompanyId as entityId to statement modal", () => {
    expect(COLLECTIONS_SRC).toContain("entityId={activeCustomerCompanyId}");
  });

  it("passes statementLocationId to SendCommunicationModal", () => {
    expect(COLLECTIONS_SRC).toContain("locationId={statementLocationId}");
  });

  it("statement modal is mounted only when showStatementModal is true", () => {
    expect(COLLECTIONS_SRC).toMatch(/showStatementModal\s*&&\s*\(/);
  });

  it("on success invalidates activity query (server-side event logging, no client note)", () => {
    // Statement sends are logged server-side; the onSuccess handler invalidates the activity cache.
    expect(COLLECTIONS_SRC).toContain("activityQueryKey");
    expect(COLLECTIONS_SRC).toMatch(/onSuccess[\s\S]{0,200}invalidateQueries/);
  });

  it("does not contain the old StatementShellModal placeholder", () => {
    expect(COLLECTIONS_SRC).not.toContain("StatementShellModal");
    expect(COLLECTIONS_SRC).not.toContain("Statement generation coming soon");
  });

  it("fetches service-locations for the active customer", () => {
    expect(COLLECTIONS_SRC).toContain("service-locations");
    expect(COLLECTIONS_SRC).toContain("serviceLocations");
  });

  it("shows scope picker dialog when multiple locations exist", () => {
    expect(COLLECTIONS_SRC).toContain("showStatementScopePicker");
    expect(COLLECTIONS_SRC).toContain("statement-scope-picker");
  });

  it("scope picker has 'Entire account' and 'Specific location' options", () => {
    expect(COLLECTIONS_SRC).toContain("Entire account");
    expect(COLLECTIONS_SRC).toContain("Specific location");
  });

  it("scope picker is skipped when customer has 0 or 1 location", () => {
    expect(COLLECTIONS_SRC).toContain("serviceLocations.length > 1");
  });

  it("handleSendStatementClick resets scope before opening picker or modal", () => {
    expect(COLLECTIONS_SRC).toContain("handleSendStatementClick");
    expect(COLLECTIONS_SRC).toContain("setStatementLocationId(null)");
  });
});

// ─── Recipient prefill + contact picker (existing, must still pass) ───────────

const CONTACT_PICKER_SRC = readFileSync(
  resolve(__dirname, "../client/src/components/communication/ContactPickerPopover.tsx"),
  "utf8",
);

describe("statement-recipients — billing-first resolution", () => {
  it("queries getCompanyDirectory for billing contacts", () => {
    expect(STATEMENT_BLOCK).toContain("getCompanyDirectory");
  });

  it("queries getLocationContacts for primary location contacts", () => {
    expect(STATEMENT_BLOCK).toContain("getLocationContacts");
  });

  it("applies billing-role priority in statement-recipients handler", () => {
    const recipBlock = STATEMENT_BLOCK.slice(
      STATEMENT_BLOCK.indexOf("statement-recipients"),
      STATEMENT_BLOCK.indexOf("statement-contacts"),
    );
    expect(recipBlock).toMatch(/billing/i);
  });

  it("falls back to scalar email when no contacts exist", () => {
    const recipBlock = STATEMENT_BLOCK.slice(
      STATEMENT_BLOCK.indexOf("statement-recipients"),
      STATEMENT_BLOCK.indexOf("statement-contacts"),
    );
    expect(recipBlock).toContain(".email");
  });
});

describe("statement-contacts endpoint", () => {
  it("GET statement-contacts endpoint exists", () => {
    expect(STATEMENT_BLOCK).toContain("statement-contacts");
  });

  it("returns { contacts } array", () => {
    const contactsBlock = STATEMENT_BLOCK.slice(
      STATEMENT_BLOCK.indexOf("statement-contacts"),
    );
    expect(contactsBlock).toContain("{ contacts }");
  });

  it("deduplicates contacts by lowercase email", () => {
    const contactsBlock = STATEMENT_BLOCK.slice(
      STATEMENT_BLOCK.indexOf("statement-contacts"),
    );
    expect(contactsBlock).toMatch(/toLowerCase|seen/);
  });

  it("scopes statement-contacts by tenant companyId", () => {
    const contactsBlock = STATEMENT_BLOCK.slice(
      STATEMENT_BLOCK.indexOf("statement-contacts"),
    );
    expect(contactsBlock).toMatch(/eq\(customerCompanies\.companyId,\s*companyId/);
  });
});

describe("ContactPickerPopover — generic contactsPath prop", () => {
  it("accepts contactsPath instead of invoiceId", () => {
    expect(CONTACT_PICKER_SRC).toContain("contactsPath");
    expect(CONTACT_PICKER_SRC).not.toContain("invoiceId");
  });

  it("fetches from contactsPath directly (not a hardcoded URL)", () => {
    expect(CONTACT_PICKER_SRC).toMatch(/apiRequest.*contactsPath/);
    expect(CONTACT_PICKER_SRC).not.toContain("/api/invoices/");
  });
});

describe("SendCommunicationModal — auto-focus suppression", () => {
  it("suppresses Radix auto-focus on open to prevent contact dropdown appearing immediately", () => {
    // Radix Dialog auto-focuses the first focusable element (To input) on open.
    // Without preventDefault, onFocus fires → toFocused=true → ContactPickerPopover mounts.
    expect(MODAL_SRC).toContain("onOpenAutoFocus");
    expect(MODAL_SRC).toContain("e.preventDefault()");
  });
});

describe("SendCommunicationModal — statement contact picker", () => {
  it("showContactPicker is true for statement entity type", () => {
    expect(MODAL_SRC).toMatch(/showContactPicker.*statement/);
  });

  it("passes contactsPath to ContactPickerPopover", () => {
    expect(MODAL_SRC).toContain("contactsPath={contactsPath}");
    expect(CONTACT_PICKER_SRC).not.toContain("invoiceId");
  });

  it("routes statement entity to statement-contacts endpoint", () => {
    expect(MODAL_SRC).toContain("statement-contacts");
  });

  it("SystemImagePickerDialog remains invoice-only after contact picker generalization", () => {
    expect(MODAL_SRC).toMatch(/entityType\s*===\s*"invoice".*SystemImagePickerDialog|SystemImagePickerDialog[\s\S]*?entityType\s*===\s*"invoice"/);
  });
});
