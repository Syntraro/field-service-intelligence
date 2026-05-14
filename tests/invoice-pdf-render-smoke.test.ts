/**
 * Invoice PDF — render-time smoke test (2026-05-06 RALPH).
 *
 * Source-pin tests verify the layout *contract*; this file boots the
 * actual PDFKit pipeline so we know the redesign produces a valid
 * single-buffer PDF for the typical 1–3 line-item invoice and that it
 * also paginates cleanly for a long invoice. The intent is regression
 * coverage for two specific brief requirements:
 *
 *   • "Simple invoice with normal header, address, notes, and 1–3
 *     line items does not force a second page."
 *   • "Long invoice can still paginate naturally."
 *
 * Page-count detection uses the byte-stream `/Type /Page` marker in
 * the PDF object stream — PDFKit emits one `Type /Page` PDF object per
 * page and never repeats the marker for chrome elements, so the count
 * of those occurrences equals the rendered page count. This avoids
 * pulling in a full PDF parser as a test dependency.
 */

import { describe, it, expect } from "vitest";
import { generateInvoicePdf } from "../server/services/invoicePdfService";
import type { Invoice, InvoiceLine, Company } from "@shared/schema";

function countPages(buf: Buffer): number {
  // PDFKit writes one `<<… /Type /Page …>>` object per page (capital P,
  // followed by either a `/` or a whitespace boundary so we don't false-
  // count `/Pages` or `/PageLayout`). The marker is stable across PDFKit
  // versions and correctly counts the rendered page total.
  const text = buf.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? [];
  return matches.length;
}

function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: "test-company-id",
    name: "Acme HVAC Inc.",
    address: "123 Main Street",
    city: "Toronto",
    provinceState: "ON",
    postalCode: "M5V 2T6",
    country: "Canada",
    phone: "555-555-1234",
    email: "billing@acme.example",
    timezone: "America/Toronto",
    locale: "en-CA",
    currency: "CAD",
    taxName: "HST",
    taxRate: "13.0000",
    serviceRadius: 25,
    isActive: true,
    deletedAt: null,
    subscriptionStatus: "active",
    subscriptionPlan: "growth",
    trialEndsAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    paypalSubscriptionId: null,
    paypalSubscriptionStatus: null,
    qboCompanyId: null,
    qboAccessToken: null,
    qboRefreshToken: null,
    qboTokenExpiresAt: null,
    qboLastSync: null,
    qboInvoiceItemId: null,
    qboTaxCodeId: null,
    qboNonTaxableTaxCodeId: null,
    qboTaxRateId: null,
    qboNonTaxableTaxRateId: null,
    portalCustomBranding: null,
    portalSubdomain: null,
    portalCustomDomain: null,
    onboardingCompletedAt: null,
    onboardingStep: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Company;
}

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1",
    companyId: "test-company-id",
    locationId: "loc-1",
    customerCompanyId: null,
    jobId: null,
    invoiceNumber: "1002",
    status: "awaiting_payment",
    issueDate: "2026-05-01",
    dueDate: "2026-05-31",
    issuedAt: new Date("2026-05-01T12:00:00Z"),
    subtotal: "1000.00",
    discountType: null,
    discountPercent: null,
    discountAmount: "0.00",
    taxTotal: "130.00",
    total: "1130.00",
    amountPaid: "0.00",
    balance: "1130.00",
    sentAt: null,
    paidAt: null,
    voidedAt: null,
    closedAt: null,
    workDescription: "Annual HVAC system tune-up and filter replacement.",
    clientMessage: "Thank you for choosing us.",
    showQuantity: true,
    showUnitPrice: true,
    showLineTotals: true,
    showLineItems: true,
    showJobDescription: true,
    showBalance: true,
    qboInvoiceId: null,
    qboSyncStatus: null,
    qboSyncToken: null,
    qboLastSyncedAt: null,
    qboOutOfSync: false,
    qboLastOutOfSyncAt: null,
    qboLastOutOfSyncReason: null,
    qboLastOutOfSyncBy: null,
    paymentTermsDays: 30,
    summary: null,
    version: 0,
    isActive: true,
    deletedAt: null,
    createdAt: new Date("2026-05-01T12:00:00Z"),
    updatedAt: null,
    ...overrides,
  } as Invoice;
}

function makeLine(idx: number, overrides: Partial<InvoiceLine> = {}): InvoiceLine {
  return {
    id: `line-${idx}`,
    invoiceId: "inv-1",
    lineNumber: idx,
    lineItemType: "service",
    productId: null,
    description: `Service line item ${idx}`,
    quantity: "1",
    unitPrice: "100.00",
    lineSubtotal: "100.00",
    taxRate: "0.13",
    taxAmount: "13.00",
    lineTotal: "113.00",
    qboItemId: null,
    qboTaxCodeId: null,
    createdAt: new Date(),
    updatedAt: null,
    ...overrides,
  } as InvoiceLine;
}

const baseLocation = {
  companyName: "Acme HVAC Inc.",
  address: "456 Service Rd",
  address2: null,
  city: "Toronto",
  provinceState: "ON",
  postalCode: "M5V 2T6",
  phone: null,
  email: null,
};

const baseCustomer = { name: "Fady's Hockey" };

describe("invoicePdfService — render-time smoke", () => {
  it("simple invoice (header + bill-to + 3 line items + small notes) renders ONE page", async () => {
    const company = makeCompany();
    const invoice = makeInvoice({
      workDescription: "Annual maintenance service.",
      clientMessage: "Please remit within 30 days.",
    });
    const lines = [makeLine(1), makeLine(2), makeLine(3)];

    const buf = await generateInvoicePdf({
      invoice,
      lines,
      company,
      location: baseLocation,
      customerCompany: baseCustomer,
    });

    expect(buf.length).toBeGreaterThan(0);
    expect(countPages(buf)).toBe(1);
  });

  it("dense invoice (8 line items + tax registrations + notes) still fits on ONE page", async () => {
    // The brief: "Optimize for invoices with 8+ line items on page 1."
    const company = makeCompany();
    const invoice = makeInvoice();
    const lines = Array.from({ length: 8 }, (_, i) => makeLine(i + 1));

    const buf = await generateInvoicePdf({
      invoice,
      lines,
      company,
      location: baseLocation,
      customerCompany: baseCustomer,
      taxRegistrations: [{ label: "HST", number: "739597326 RT0001" }],
    });

    expect(countPages(buf)).toBe(1);
  });

  it("very long invoice (40 line items) paginates naturally to multiple pages", async () => {
    const company = makeCompany();
    const invoice = makeInvoice();
    const lines = Array.from({ length: 40 }, (_, i) => makeLine(i + 1));

    const buf = await generateInvoicePdf({
      invoice,
      lines,
      company,
      location: baseLocation,
      customerCompany: baseCustomer,
    });

    const pages = countPages(buf);
    expect(pages).toBeGreaterThanOrEqual(2);
    // Sanity bound — 40 rows shouldn't exceed 4 pages.
    expect(pages).toBeLessThanOrEqual(4);
  });

  it("no client message, no work description → still single page (no blank trailing page)", async () => {
    const company = makeCompany();
    const invoice = makeInvoice({
      workDescription: null,
      clientMessage: null,
    });
    const lines = [makeLine(1), makeLine(2)];

    const buf = await generateInvoicePdf({
      invoice,
      lines,
      company,
      location: baseLocation,
      customerCompany: baseCustomer,
    });

    expect(countPages(buf)).toBe(1);
  });

  it("invoice with tax registrations renders without forcing a second page", async () => {
    // Business Information block sits in the bottom 60pt band on the
    // last page — pin that adding it doesn't push the body over the
    // page boundary.
    const company = makeCompany();
    const invoice = makeInvoice();
    const lines = [makeLine(1), makeLine(2), makeLine(3), makeLine(4)];

    const buf = await generateInvoicePdf({
      invoice,
      lines,
      company,
      location: baseLocation,
      customerCompany: baseCustomer,
      taxRegistrations: [
        { label: "HST", number: "739597326 RT0001" },
        { label: "GST", number: "111222333 RT0002" },
      ],
    });

    expect(countPages(buf)).toBe(1);
  });
});
