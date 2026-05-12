/**
 * Source-level regression tests for the ar-summary endpoint.
 *
 * Verifies the scoping invariants of
 * GET /api/customer-companies/:customerCompanyId/ar-summary
 * by inspecting the route source.
 *
 * Scoping invariants:
 * 1. Tenant isolation: invoices.companyId AND invoices.customerCompanyId AND
 *    customerCompanies.companyId are all enforced.
 * 2. Status list includes draft, awaiting_payment, sent, partial_paid.
 *    Does not include paid or voided.
 * 3. balance > 0 filter applied (zero-balance excluded).
 * 4. Display-name join uses invoices.locationId → clientLocations (not via parentCompanyId).
 * 5. getClientBillingSummary called for lastPayment.
 * 6. New fields: sentAt, viewedAt, summary, workDescription, contextLabel.
 * 7. Customer response includes billingAddress, primaryContactName, serviceLocationCount.
 * 8. daysSinceLastPayment computed server-side.
 * 9. Location count query scoped by companyId AND parentCompanyId AND deletedAt IS NULL.
 * 10. No getInvoicesFeed call in the ar-summary handler.
 */

import { readFileSync } from "fs";
import { describe, it, expect } from "vitest";
import { resolve } from "path";

const SRC = readFileSync(
  resolve(__dirname, "../server/routes/customer-companies.ts"),
  "utf8",
);

// Isolate the ar-summary handler block for targeted assertions
const AR_BLOCK_START = SRC.indexOf("/:customerCompanyId/ar-summary");
const AR_BLOCK_END = SRC.indexOf("\n/**", AR_BLOCK_START + 100);
const AR_BLOCK = AR_BLOCK_END > 0 ? SRC.slice(AR_BLOCK_START, AR_BLOCK_END) : SRC.slice(AR_BLOCK_START);

describe("ar-summary — tenant isolation", () => {
  it("filters invoices by companyId (tenant)", () => {
    expect(AR_BLOCK).toMatch(/eq\(invoices\.companyId,\s*companyId/);
  });

  it("filters invoices by customerCompanyId (customer isolation)", () => {
    expect(AR_BLOCK).toMatch(/eq\(invoices\.customerCompanyId,\s*customerCompanyId\)/);
  });

  it("validates customer company belongs to tenant via customerCompanies.companyId", () => {
    expect(AR_BLOCK).toMatch(/eq\(customerCompanies\.companyId,\s*companyId/);
  });
});

describe("ar-summary — status filter", () => {
  it("defines AR_INVOICE_STATUSES with draft", () => {
    expect(AR_BLOCK).toMatch(/AR_INVOICE_STATUSES\s*=/);
    expect(AR_BLOCK).toContain('"draft"');
  });

  it("includes awaiting_payment, sent, partial_paid", () => {
    expect(AR_BLOCK).toContain('"awaiting_payment"');
    expect(AR_BLOCK).toContain('"sent"');
    expect(AR_BLOCK).toContain('"partial_paid"');
  });

  it("does not include paid or voided in AR_INVOICE_STATUSES array", () => {
    const match = AR_BLOCK.match(/AR_INVOICE_STATUSES\s*=\s*(\[[\s\S]*?\])\s*as const/);
    expect(match).not.toBeNull();
    const arr = match![1];
    expect(arr).not.toContain('"paid"');
    expect(arr).not.toContain('"voided"');
  });

  it("applies inArray filter with AR_INVOICE_STATUSES", () => {
    expect(AR_BLOCK).toMatch(/inArray\(invoices\.status,\s*AR_INVOICE_STATUSES/);
  });
});

describe("ar-summary — balance filter", () => {
  it("excludes zero-balance invoices", () => {
    expect(AR_BLOCK).toMatch(/CAST\(\$\{invoices\.balance\}\s*AS\s*numeric\)\s*>\s*0/);
  });
});

describe("ar-summary — display name integrity (no parentCompanyId join)", () => {
  it("joins clientLocations via invoices.locationId", () => {
    expect(AR_BLOCK).toMatch(/leftJoin\(clientLocations,\s*eq\(invoices\.locationId/);
  });

  it("does not join customerCompanies via parentCompanyId in invoice query", () => {
    expect(AR_BLOCK).not.toMatch(/eq\(clients\.parentCompanyId,\s*customerCompanies\.id\)/);
    expect(AR_BLOCK).not.toMatch(/eq\(clientLocations\.parentCompanyId,\s*customerCompanies\.id\)/);
  });

  it("selects locationSite and locationCompanyName from clientLocations", () => {
    expect(AR_BLOCK).toMatch(/locationSite:\s*clientLocations\.location/);
    expect(AR_BLOCK).toMatch(/locationCompanyName:\s*clientLocations\.companyName/);
  });
});

describe("ar-summary — communication status fields", () => {
  it("selects sentAt from invoices", () => {
    expect(AR_BLOCK).toMatch(/sentAt:\s*invoices\.sentAt/);
  });

  it("selects viewedAt from invoices", () => {
    expect(AR_BLOCK).toMatch(/viewedAt:\s*invoices\.viewedAt/);
  });

  it("selects summary and workDescription from invoices", () => {
    expect(AR_BLOCK).toMatch(/summary:\s*invoices\.summary/);
    expect(AR_BLOCK).toMatch(/workDescription:\s*invoices\.workDescription/);
  });

  it("maps sentAt and viewedAt into response via toISOOrNull", () => {
    expect(AR_BLOCK).toContain("toISOOrNull");
    expect(AR_BLOCK).toContain("sentAt: toISOOrNull");
    expect(AR_BLOCK).toContain("viewedAt: toISOOrNull");
  });
});

describe("ar-summary — context label", () => {
  it("builds contextLabel from summary > workDescription > location site", () => {
    expect(AR_BLOCK).toContain("invoiceContextLabel");
    expect(AR_BLOCK).toContain("contextLabel: invoiceContextLabel");
  });
});

describe("ar-summary — customer context fields", () => {
  it("selects billingStreet, billingCity, billingProvince from customerCompanies", () => {
    expect(AR_BLOCK).toMatch(/billingStreet:\s*customerCompanies\.billingStreet/);
    expect(AR_BLOCK).toMatch(/billingCity:\s*customerCompanies\.billingCity/);
    expect(AR_BLOCK).toMatch(/billingProvince:\s*customerCompanies\.billingProvince/);
  });

  it("includes billingAddress in customer response", () => {
    expect(AR_BLOCK).toContain("billingAddress");
    expect(AR_BLOCK).toContain("primaryContactName");
    expect(AR_BLOCK).toContain("serviceLocationCount");
  });

  it("includes daysSinceLastPayment in response", () => {
    expect(AR_BLOCK).toContain("daysSinceLastPayment");
  });
});

describe("ar-summary — location count query", () => {
  it("queries service locations scoped by companyId", () => {
    expect(AR_BLOCK).toMatch(/eq\(clientLocations\.companyId,\s*companyId/);
  });

  it("queries service locations scoped by parentCompanyId", () => {
    expect(AR_BLOCK).toMatch(/eq\(clientLocations\.parentCompanyId,\s*customerCompanyId\)/);
  });

  it("excludes soft-deleted locations via isNull(deletedAt)", () => {
    expect(AR_BLOCK).toMatch(/isNull\(clientLocations\.deletedAt\)/);
  });
});

describe("ar-summary — no stale getInvoicesFeed call", () => {
  it("does not call getInvoicesFeed in the ar-summary handler", () => {
    expect(AR_BLOCK).not.toContain("getInvoicesFeed(");
  });
});

describe("ar-summary — payment info", () => {
  it("calls getClientBillingSummary with customerCompanyId scope", () => {
    expect(AR_BLOCK).toContain("getClientBillingSummary");
    expect(AR_BLOCK).toMatch(/\{\s*customerCompanyId\s*\}/);
  });

  it("includes lastPayment in response", () => {
    expect(AR_BLOCK).toContain("lastPayment");
  });
});
