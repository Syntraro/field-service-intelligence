/**
 * Canonical detail header — parity fixes (2026-05-10).
 *
 * Source-pin tests for the four consistency fixes applied across all detail pages:
 *
 *   1. addressLabel — Invoice/Quote/Lead now pass the correct address block label
 *      (Job already had "Service Address").
 *
 *   2. Lead Convert-to-Quote primary CTA — pre-existing; confirmed present with
 *      correct gate (hidden when canConvert=false or already converted).
 *
 *   3. Invoice editControls parity — saveTestId/cancelTestId now wired;
 *      error prop intentionally absent (Invoice uses toast-only error handling).
 *
 *   4. descriptionEdit.testId — stable textarea test IDs added to Invoice, Quote, Lead.
 *      Job's "textarea-job-description" is pre-existing and unchanged.
 *
 * Note: detail-header-canonical.test.ts has 42 pre-existing failures against the
 * old CDH API (layout=, statusChip=, editFooter=, etc.). Those are out of scope here.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

const invoiceSrc = readFileSync(
  resolve(ROOT, "client/src/pages/InvoiceDetailPage.tsx"),
  "utf-8",
);
const quoteHeaderSrc = readFileSync(
  resolve(ROOT, "client/src/components/QuoteHeaderCard.tsx"),
  "utf-8",
);
const leadSrc = readFileSync(
  resolve(ROOT, "client/src/components/leads/LeadSummaryCard.tsx"),
  "utf-8",
);
const jobSrc = readFileSync(
  resolve(ROOT, "client/src/pages/JobDetailPage.tsx"),
  "utf-8",
);

// ── 1. addressLabel — all four pages now pass an address block label ───

describe("Canonical header — addressLabel consistency across detail pages", () => {
  it("Job passes addressLabel=\"Service Address\" (pre-existing, unchanged)", () => {
    expect(jobSrc).toMatch(/addressLabel="Service Address"/);
  });

  it("Quote passes addressLabel=\"Service Address\"", () => {
    expect(quoteHeaderSrc).toMatch(/addressLabel="Service Address"/);
  });

  it("Lead passes addressLabel=\"Location\"", () => {
    expect(leadSrc).toMatch(/addressLabel="Location"/);
  });

  it("Invoice passes dynamic addressLabel (Service Address when serviceAddress present, Billing Address otherwise)", () => {
    // Label is computed inline: serviceAddress ? "Service Address" : billingAddress ? "Billing Address" : undefined
    expect(invoiceSrc).toMatch(/addressLabel=\{serviceAddress\s*\?\s*"Service Address"\s*:\s*billingAddress\s*\?\s*"Billing Address"\s*:\s*undefined\}/);
  });

  it("Invoice addressLabel is placed immediately after the addressLines IIFE prop", () => {
    const addrLinesIdx = invoiceSrc.indexOf("addressLines={(() => {");
    const addrLabelIdx = invoiceSrc.indexOf('addressLabel={serviceAddress', addrLinesIdx);
    expect(addrLinesIdx).toBeGreaterThan(-1);
    expect(addrLabelIdx).toBeGreaterThan(addrLinesIdx);
    // Must appear before phone prop
    const phoneIdx = invoiceSrc.indexOf("phone={primaryContact", addrLinesIdx);
    expect(addrLabelIdx).toBeLessThan(phoneIdx);
  });
});

// ── 2. Lead Convert-to-Quote — primary CTA gates ──────────────────────

describe("LeadSummaryCard — Convert to Quote canonical primary CTA", () => {
  it("Convert to Quote action carries variant: \"primary\"", () => {
    expect(leadSrc).toMatch(
      /id:\s*["']convert-to-quote["'][\s\S]{0,200}?variant:\s*["']primary["']/,
    );
  });

  it("Convert to Quote is hidden when canConvert is false (non-actionable lead)", () => {
    expect(leadSrc).toMatch(/hidden:\s*!actions\.canConvert/);
  });

  it("Convert to Quote is hidden when lead already has a convertedQuoteId (already converted)", () => {
    expect(leadSrc).toMatch(/convertedQuoteId/);
    // hidden flag combines both conditions
    const convertBlock = leadSrc.slice(
      leadSrc.indexOf('"convert-to-quote"'),
      leadSrc.indexOf('"convert-to-quote"') + 300,
    );
    expect(convertBlock).toMatch(/!actions\.canConvert\s*\|\|\s*!!actions\.convertedQuoteId/);
  });

  it("View Quote action (outline) is shown when convertedQuoteId is present, not primary", () => {
    expect(leadSrc).toMatch(
      /id:\s*["']view-quote["'][\s\S]{0,200}?variant:\s*["']outline["']/,
    );
    const viewBlock = leadSrc.slice(
      leadSrc.indexOf('"view-quote"'),
      leadSrc.indexOf('"view-quote"') + 300,
    );
    expect(viewBlock).toMatch(/hidden:\s*!actions\.convertedQuoteId/);
  });

  it("Mark Contacted action is outline (not primary)", () => {
    expect(leadSrc).toMatch(
      /id:\s*["']mark-contacted["'][\s\S]{0,200}?variant:\s*["']outline["']/,
    );
  });

  it("only Convert to Quote uses variant: \"primary\" in Lead primary actions", () => {
    // Count "primary" variant occurrences in primaryActions array
    const primaryActionsStart = leadSrc.indexOf("const primaryActions: HeaderAction[]");
    const primaryActionsEnd = leadSrc.indexOf("const overflowActions", primaryActionsStart);
    const primaryActionsBlock = leadSrc.slice(primaryActionsStart, primaryActionsEnd);
    const primaryMatches = primaryActionsBlock.match(/variant:\s*["']primary["']/g) ?? [];
    expect(primaryMatches.length).toBe(1);
  });
});

// ── 3. Invoice editControls parity ────────────────────────────────────

describe("InvoiceDetailPage — editControls parity with Job/Quote/Lead", () => {
  it("editControls has saveTestId: \"button-header-save\"", () => {
    expect(invoiceSrc).toMatch(/saveTestId:\s*["']button-header-save["']/);
  });

  it("editControls has cancelTestId: \"button-header-cancel\"", () => {
    expect(invoiceSrc).toMatch(/cancelTestId:\s*["']button-header-cancel["']/);
  });

  it("editControls does NOT pass error prop (Invoice uses toast-only error handling — no headerError state)", () => {
    // Confirm there is no headerError state in InvoiceDetailPage
    expect(invoiceSrc).not.toMatch(/const\s+\[headerError,\s*setHeaderError\]/);
    expect(invoiceSrc).not.toMatch(/headerError\s*=\s*useState/);
    // Confirm editControls block does not wire error:
    const editControlsIdx = invoiceSrc.lastIndexOf("editControls={");
    const editControlsSlice = invoiceSrc.slice(editControlsIdx, editControlsIdx + 300);
    expect(editControlsSlice).not.toMatch(/error:\s*headerError/);
  });

  it("Job editControls has error: headerError for comparison (reference — not broken by this change)", () => {
    expect(jobSrc).toMatch(/error:\s*headerError/);
  });
});

// ── 4. descriptionEdit.testId — stable test IDs on all four pages ─────

describe("Canonical header — descriptionEdit.testId across detail pages", () => {
  it("Job descriptionEdit has testId: \"textarea-job-description\" (pre-existing, unchanged)", () => {
    expect(jobSrc).toMatch(/testId:\s*["']textarea-job-description["']/);
  });

  it("Invoice descriptionEdit has testId: \"textarea-invoice-description\"", () => {
    expect(invoiceSrc).toMatch(/testId:\s*["']textarea-invoice-description["']/);
  });

  it("Quote descriptionEdit has testId: \"textarea-quote-description\"", () => {
    expect(quoteHeaderSrc).toMatch(/testId:\s*["']textarea-quote-description["']/);
  });

  it("Lead descriptionEdit has testId: \"textarea-lead-description\"", () => {
    expect(leadSrc).toMatch(/testId:\s*["']textarea-lead-description["']/);
  });

  it("Invoice descriptionEdit.testId appears inside the conditional descriptionEdit block (not a bare testId)", () => {
    const descEditIdx = invoiceSrc.indexOf("descriptionEdit={");
    const descEditEnd = invoiceSrc.indexOf(": undefined\n            }", descEditIdx);
    const descEditBlock = invoiceSrc.slice(descEditIdx, descEditEnd);
    expect(descEditBlock).toMatch(/testId:\s*["']textarea-invoice-description["']/);
  });

  it("Quote descriptionEdit.testId appears inside the conditional descriptionEdit block", () => {
    const descEditIdx = quoteHeaderSrc.indexOf("descriptionEdit={");
    const descEditEnd = quoteHeaderSrc.indexOf(": undefined\n      }", descEditIdx);
    const descEditBlock = quoteHeaderSrc.slice(descEditIdx, descEditEnd);
    expect(descEditBlock).toMatch(/testId:\s*["']textarea-quote-description["']/);
  });

  it("Lead descriptionEdit.testId appears inside the conditional descriptionEdit block", () => {
    const descEditIdx = leadSrc.indexOf("descriptionEdit={");
    const descEditEnd = leadSrc.indexOf(": undefined\n        }", descEditIdx);
    const descEditBlock = leadSrc.slice(descEditIdx, descEditEnd);
    expect(descEditBlock).toMatch(/testId:\s*["']textarea-lead-description["']/);
  });
});

// ── 5. Create pages are untouched ─────────────────────────────────────

describe("Create pages — not modified by parity fixes", () => {
  it("NewInvoicePage does not exist or does not use CanonicalDetailHeader", () => {
    // Create pages use CanonicalCreateHeader, not CDH
    const { existsSync } = require("fs");
    const newInvoicePath = resolve(ROOT, "client/src/pages/NewInvoicePage.tsx");
    if (existsSync(newInvoicePath)) {
      const src = readFileSync(newInvoicePath, "utf-8");
      // Must use CanonicalCreateHeader (or no CDH usage)
      expect(src).not.toMatch(/import\s*\{[^}]*\bCanonicalDetailHeader\b[^}]*\}\s*from/);
    }
    // If file doesn't exist, the test vacuously passes
  });

  it("CreateQuotePage does not use CanonicalDetailHeader", () => {
    const { existsSync } = require("fs");
    const createQuotePath = resolve(ROOT, "client/src/pages/CreateQuotePage.tsx");
    if (existsSync(createQuotePath)) {
      const src = readFileSync(createQuotePath, "utf-8");
      expect(src).not.toMatch(/import\s*\{[^}]*\bCanonicalDetailHeader\b[^}]*\}\s*from/);
    }
  });
});
