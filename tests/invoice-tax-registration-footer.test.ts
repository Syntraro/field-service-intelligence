/**
 * Invoice tax-registration: settings label rename + PDF footer source
 * contract + watermark removal + render-time text verification
 * (2026-05-07 RALPH narrow + correction).
 *
 * Three contracts:
 *
 *   1. Invoice display settings page: the toggle that gates the tax-
 *      registration block on the customer-facing PDF reads
 *      "Show tax registration number" — never the prior
 *      Canada/HST-specific "Show tax / HST number".
 *
 *   2. PDF footer source: tax registration line(s) render directly
 *      under the thank-you line, one centred line per registration,
 *      gated on `policy.showTaxNumber === true` AND a non-empty
 *      `taxRegistrations` array. Each line uses the configured
 *      `taxRegistrations[].label` verbatim — no hardcoded "HST". The
 *      "BUSINESS INFORMATION" heading + the diagonal DRAFT/VOID/PAID
 *      watermark are gone entirely.
 *
 *   3. Render-time text contract: boots the actual PDFKit pipeline +
 *      the `resolveInvoiceDisplayPolicy` resolver, decompresses the
 *      generated PDF's content stream, decodes the hex-encoded text
 *      in PDFKit's `[<...> 0] TJ` operators, and asserts the rendered
 *      footer text matches the spec for each branch of the behaviour
 *      matrix (toggle on/off × regs present/absent × invoice status).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import zlib from "node:zlib";
import { generateInvoicePdf } from "../server/services/invoicePdfService";
import { resolveInvoiceDisplayPolicy } from "../shared/invoiceDisplayPolicy";
import type { Invoice, InvoiceLine, Company } from "@shared/schema";

const ROOT = resolve(__dirname, "..");
const SETTINGS_PAGE = resolve(
  ROOT,
  "client/src/pages/InvoiceDisplaySettingsPage.tsx",
);
const PDF_SRC_PATH = resolve(ROOT, "server/services/invoicePdfService.ts");

const settingsSrc = readFileSync(SETTINGS_PAGE, "utf-8");
const pdfSrc = readFileSync(PDF_SRC_PATH, "utf-8");

const codeOnly = pdfSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

// ─── Render-time text extraction helpers ────────────────────────────
//
// PDFKit emits text via the PDF `TJ` operator with a hex-encoded
// string argument: `[<48656c6c6f> 0] TJ` for "Hello". The page's
// content stream is also Flate-compressed. To assert the rendered
// text from a render-time test, we:
//   1. Decompress every `stream … endstream` block in the PDF.
//   2. For each inflated block, scan for `<hex>` substrings.
//   3. Decode each hex run as latin-1 bytes, concatenate.
// The result is a single string containing every text fragment
// PDFKit wrote, in document order, without font / spacing operators.

function extractRenderedText(buf: Buffer): string {
  const text = buf.toString("binary");
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  const fragments: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(text)) !== null) {
    let inflated: Buffer;
    try {
      inflated = zlib.inflateSync(Buffer.from(m[1], "binary"));
    } catch {
      // Stream wasn't Flate-compressed (font subset, image, etc.) —
      // skip; real text content lives in the Flate-compressed page
      // content stream.
      continue;
    }
    const inflatedStr = inflated.toString("latin1");
    const hexRe = /<([0-9a-fA-F]+)>/g;
    let h: RegExpExecArray | null;
    while ((h = hexRe.exec(inflatedStr)) !== null) {
      fragments.push(Buffer.from(h[1], "hex").toString("latin1"));
    }
  }
  return fragments.join("");
}

// ── 1. Settings label rename ───────────────────────────────────────

describe("InvoiceDisplaySettingsPage — tax registration toggle label", () => {
  it("uses the new neutral label 'Show tax registration number'", () => {
    expect(settingsSrc).toMatch(/label="Show tax registration number"/);
  });

  it("does NOT contain the prior Canada/HST-specific label", () => {
    expect(settingsSrc).not.toMatch(/Show tax \/ HST number/);
    expect(settingsSrc).not.toMatch(/Show tax\/HST number/);
  });

  it("preserves the existing toggle wiring (testid + checked binding + onChange)", () => {
    // Pin the rest of the row so the rename stays visual-only.
    expect(settingsSrc).toMatch(/testId="toggle-show-tax-number"/);
    expect(settingsSrc).toMatch(/checked=\{form\.invoiceShowTaxNumber\}/);
    expect(settingsSrc).toMatch(
      /onChange=\{\(v\)\s*=>\s*set\("invoiceShowTaxNumber",\s*v\)\}/,
    );
  });
});

// ── 2. PDF footer source contracts ─────────────────────────────────

describe("invoicePdfService — footer source contract", () => {
  it("does NOT render any 'BUSINESS INFORMATION' heading anywhere", () => {
    const codeOnly = pdfSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/"BUSINESS INFORMATION"/);
    expect(codeOnly).not.toMatch(/Business Information/);
  });

  it("gathers tax-reg lines only when policy.showTaxNumber is on AND taxRegistrations has data", () => {
    expect(pdfSrc).toMatch(/const showTaxRegs\s*=\s*!!policy\.showTaxNumber;/);
    expect(pdfSrc).toMatch(
      /const taxRegLines:\s*string\[\]\s*=\s*showTaxRegs\s*&&\s*taxRegistrations[\s\S]+?\.filter\(/,
    );
  });

  it("uses the configured registration label verbatim (falls back to 'Tax ID' only)", () => {
    expect(pdfSrc).toMatch(
      /const label\s*=\s*\(r\.label\s*\?\?\s*""\)\.trim\(\);[\s\S]+?return label\s*\?\s*`\$\{label\} # \$\{number\}`\s*:\s*`Tax ID # \$\{number\}`/,
    );
  });

  it("renders one centred tax-reg line per registration directly under thank-you", () => {
    // The render loop iterates `taxRegLines` and stacks each line
    // `TAX_REG_LINE_H` apart starting at `firstRegY` — each call
    // is centred + lineBreak: false.
    expect(pdfSrc).toMatch(
      /for\s*\(let i = 0; i < regCount; i\+\+\)\s*\{[\s\S]+?const lineY = firstRegY \+ i \* TAX_REG_LINE_H;[\s\S]+?align:\s*"center"/,
    );
  });
});

// ── 3. DRAFT/VOID/PAID watermark removed entirely (2026-05-07 correction) ──

describe("invoicePdfService — status watermark removed", () => {
  it("does NOT define a `getStatusWatermark` helper anymore", () => {
    // The helper that returned "DRAFT" / "VOID" / "PAID" string for
    // the diagonal stamp is gone from the executable source.
    expect(codeOnly).not.toMatch(/function\s+getStatusWatermark\s*\(/);
  });

  it("does NOT call doc.rotate() to draw a diagonal watermark", () => {
    // The watermark used `doc.rotate(-45, ...)` to draw the stamp at
    // 45 degrees across the page. With the watermark removed, no
    // rotate() call survives in the renderer.
    expect(codeOnly).not.toMatch(/doc\.rotate\(/);
  });

  it("does NOT contain the literal status strings 'DRAFT' / 'VOID' / 'PAID' in render code", () => {
    // Strip comments first so the doc commentary describing the
    // removal doesn't false-trip the negative pin.
    expect(codeOnly).not.toMatch(/return\s+"DRAFT"/);
    expect(codeOnly).not.toMatch(/return\s+"VOID"/);
    expect(codeOnly).not.toMatch(/return\s+"PAID"/);
  });

  it("preserves a no-op `drawWatermark` so multi-page page-break call sites stay symmetrical", () => {
    // The hook is kept as a no-op so a future re-introduction is a
    // one-line edit.
    expect(pdfSrc).toMatch(/const drawWatermark\s*=\s*\(\)\s*=>\s*\{\s*\/\*\s*no-op[\s\S]*?\*\/\s*\}/);
  });
});

// ── 4. Render-time text contract (decompressed PDF stream scan) ──

describe("invoicePdfService — render-time text contract", () => {
  function makeCompany(overrides: Partial<Company> = {}): Company {
    return {
      id: "test-company",
      name: "Samcor Mechanical Inc.",
      address: "15 Oak Ave",
      city: "River Drive Park",
      provinceState: "ON",
      postalCode: "L9N 1A7",
      country: "Canada",
      phone: "1905392828",
      email: "service@samcor.example",
      timezone: "America/Toronto",
      locale: "en-CA",
      currency: "CAD",
      taxName: "HST",
      taxRate: "13.0000",
      isActive: true,
      ...overrides,
    } as Company;
  }
  function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
    return {
      id: "inv-1",
      companyId: "test-company",
      locationId: "loc-1",
      customerCompanyId: null,
      jobId: null,
      invoiceNumber: "1002",
      status: "awaiting_payment",
      issueDate: "2026-05-01",
      dueDate: "2026-05-31",
      issuedAt: new Date("2026-05-01T12:00:00Z"),
      subtotal: "100.00",
      discountAmount: "0.00",
      taxTotal: "13.00",
      total: "113.00",
      amountPaid: "0.00",
      balance: "113.00",
      notesCustomer: null,
      workDescription: null,
      showQuantity: true,
      showUnitPrice: true,
      showLineTotals: true,
      showLineItems: true,
      showJobDescription: true,
      showBalance: true,
      paymentTermsDays: 30,
      summary: null,
      isActive: true,
      version: 0,
      createdAt: new Date(),
      ...overrides,
    } as Invoice;
  }
  const baseLine: InvoiceLine = {
    id: "line-1",
    invoiceId: "inv-1",
    lineNumber: 1,
    lineItemType: "service",
    description: "Service",
    quantity: "1",
    unitPrice: "100.00",
    lineSubtotal: "100.00",
    taxRate: "0.13",
    taxAmount: "13.00",
    lineTotal: "113.00",
    createdAt: new Date(),
  } as InvoiceLine;
  const baseLocation = {
    companyName: "Acme HVAC",
    address: "456 Service Rd",
    city: "Toronto",
    provinceState: "ON",
    postalCode: "M5V 2T6",
  };

  function policyFor(invoiceShowTaxNumber: boolean) {
    return resolveInvoiceDisplayPolicy({
      tenantSettings: { invoiceShowTaxNumber } as any,
      invoice: makeInvoice() as any,
    });
  }

  it("renders configured tax registration directly under the thank-you when toggle is ON", async () => {
    const buf = await generateInvoicePdf({
      invoice: makeInvoice(),
      lines: [baseLine],
      company: makeCompany(),
      location: baseLocation,
      customerCompany: { name: "Customer" },
      taxRegistrations: [{ label: "HST", number: "123456789 RT0001" }],
      policy: policyFor(true),
    });
    const text = extractRenderedText(buf);
    expect(text).toContain("Thank y");
    expect(text).toContain("Samcor Mechanical Inc.");
    expect(text).toContain("HST # 123456789 R");
    expect(text).toContain("T0001");
  });

  it("does NOT render tax registration when the display setting is OFF", async () => {
    const buf = await generateInvoicePdf({
      invoice: makeInvoice(),
      lines: [baseLine],
      company: makeCompany(),
      location: baseLocation,
      customerCompany: { name: "Customer" },
      taxRegistrations: [{ label: "HST", number: "123456789 RT0001" }],
      policy: policyFor(false),
    });
    const text = extractRenderedText(buf);
    expect(text).toContain("Thank y");
    expect(text).not.toContain("123456789");
    expect(text).not.toContain("HST # ");
  });

  it("does NOT render tax registration when the tenant has no registrations", async () => {
    const buf = await generateInvoicePdf({
      invoice: makeInvoice(),
      lines: [baseLine],
      company: makeCompany(),
      location: baseLocation,
      customerCompany: { name: "Customer" },
      taxRegistrations: [],
      policy: policyFor(true),
    });
    const text = extractRenderedText(buf);
    expect(text).toContain("Thank y");
    expect(text).not.toContain("HST # ");
    expect(text).not.toContain("Tax ID # ");
  });

  it("renders multiple registrations one per line, each with its configured label", async () => {
    const buf = await generateInvoicePdf({
      invoice: makeInvoice(),
      lines: [baseLine],
      company: makeCompany(),
      location: baseLocation,
      customerCompany: { name: "Customer" },
      taxRegistrations: [
        { label: "HST", number: "123456789 RT0001" },
        { label: "GST", number: "111222333" },
      ],
      policy: policyFor(true),
    });
    const text = extractRenderedText(buf);
    expect(text).toContain("HST # 123456789 R");
    expect(text).toContain("GST # 111222333");
  });

  it("does NOT hardcode 'HST' when the tenant configured a different label (e.g. VAT)", async () => {
    const buf = await generateInvoicePdf({
      invoice: makeInvoice(),
      lines: [baseLine],
      company: makeCompany({ name: "EuroAir Ltd." } as any),
      location: baseLocation,
      customerCompany: { name: "Customer" },
      taxRegistrations: [{ label: "VAT", number: "GB123456789" }],
      policy: policyFor(true),
    });
    const text = extractRenderedText(buf);
    expect(text).toContain("VAT # GB123456789");
    // The hardcoded "HST # GB" string must not appear.
    expect(text).not.toMatch(/HST # GB/);
  });

  it("falls back to 'Tax ID #' when the registration has no configured label", async () => {
    const buf = await generateInvoicePdf({
      invoice: makeInvoice(),
      lines: [baseLine],
      company: makeCompany(),
      location: baseLocation,
      customerCompany: { name: "Customer" },
      taxRegistrations: [{ label: null, number: "999888777" }],
      policy: policyFor(true),
    });
    const text = extractRenderedText(buf);
    expect(text).toContain("Tax ID # 999888777");
  });

  it("does NOT render a DRAFT watermark on a draft invoice (status watermark removed)", async () => {
    const buf = await generateInvoicePdf({
      invoice: makeInvoice({ status: "draft" }),
      lines: [baseLine],
      company: makeCompany(),
      location: baseLocation,
      customerCompany: { name: "Customer" },
      taxRegistrations: [],
      policy: policyFor(true),
    });
    const text = extractRenderedText(buf);
    expect(text).not.toContain("DRAFT");
  });

  it("does NOT render a PAID watermark on a paid invoice", async () => {
    const buf = await generateInvoicePdf({
      invoice: makeInvoice({ status: "paid" }),
      lines: [baseLine],
      company: makeCompany(),
      location: baseLocation,
      customerCompany: { name: "Customer" },
      taxRegistrations: [],
      policy: policyFor(true),
    });
    const text = extractRenderedText(buf);
    expect(text).not.toContain("PAID");
  });

  it("does NOT render a VOID watermark on a voided invoice", async () => {
    const buf = await generateInvoicePdf({
      invoice: makeInvoice({ status: "voided" }),
      lines: [baseLine],
      company: makeCompany(),
      location: baseLocation,
      customerCompany: { name: "Customer" },
      taxRegistrations: [],
      policy: policyFor(true),
    });
    const text = extractRenderedText(buf);
    expect(text).not.toContain("VOID");
  });

  it("does NOT render a 'BUSINESS INFORMATION' heading anywhere", async () => {
    const buf = await generateInvoicePdf({
      invoice: makeInvoice(),
      lines: [baseLine],
      company: makeCompany(),
      location: baseLocation,
      customerCompany: { name: "Customer" },
      taxRegistrations: [{ label: "HST", number: "123456789 RT0001" }],
      policy: policyFor(true),
    });
    const text = extractRenderedText(buf);
    expect(text).not.toContain("BUSINESS INFORMATION");
    expect(text).not.toContain("Business Information");
  });
});

