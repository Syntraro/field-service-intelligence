/**
 * Client-level payment terms source-pin tests (2026-05-07).
 *
 * Adds an optional client-level invoice payment-terms default that
 * threads through the create-invoice resolution chain. These pins
 * fail if a future refactor:
 *
 *   - drops the migration file
 *   - removes the `paymentTermsDays` column from `customer_companies`
 *     in the Drizzle schema
 *   - strips the field from the PATCH /api/customer-companies/:id
 *     route Zod
 *   - drops the field from the storage repo write path
 *   - re-introduces the old `params ?? settings ?? 30` chain on
 *     invoice creation (must include the customer fallback)
 *   - removes the EditCompanyDialog payment-terms select / helper
 *     text / custom-days input
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const migrationPath = resolve(
  __dirname,
  "../migrations/2026_05_07_customer_companies_payment_terms.sql",
);
const schemaSrc = readFileSync(
  resolve(__dirname, "../shared/schema.ts"),
  "utf-8",
);
const customerRouteSrc = readFileSync(
  resolve(__dirname, "../server/routes/customer-companies.ts"),
  "utf-8",
);
const customerStorageSrc = readFileSync(
  resolve(__dirname, "../server/storage/customerCompanies.ts"),
  "utf-8",
);
const invoiceStorageSrc = readFileSync(
  resolve(__dirname, "../server/storage/invoices.ts"),
  "utf-8",
);
const editDialogSrc = readFileSync(
  resolve(__dirname, "../client/src/components/EditCompanyDialog.tsx"),
  "utf-8",
);

// ── Migration ────────────────────────────────────────────────────────

describe("Migration — customer_companies.payment_terms_days", () => {
  it("the migration file exists on disk", () => {
    expect(existsSync(migrationPath)).toBe(true);
  });

  it("adds the column as nullable integer (matches the docstring)", () => {
    const sql = readFileSync(migrationPath, "utf-8");
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+customer_companies[\s\S]*?ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+payment_terms_days\s+integer/i,
    );
    // Must NOT carry NOT NULL — null is the canonical "inherit from
    // company default" signal.
    expect(sql).not.toMatch(/payment_terms_days\s+integer\s+NOT\s+NULL/i);
  });

  it("is idempotent (IF NOT EXISTS)", () => {
    const sql = readFileSync(migrationPath, "utf-8");
    expect(sql).toMatch(/IF\s+NOT\s+EXISTS/i);
  });
});

// ── Drizzle schema ───────────────────────────────────────────────────

describe("shared/schema.ts — customerCompanies.paymentTermsDays", () => {
  it("declares paymentTermsDays on the customerCompanies table (nullable integer)", () => {
    // Locate the customer_companies table block by index then assert
    // the column declaration appears inside it. Avoids a single
    // mega-regex with `[\s\S]*?` spanning ~45 lines.
    const tableStart = schemaSrc.indexOf(
      'export const customerCompanies = pgTable("customer_companies"',
    );
    expect(tableStart).toBeGreaterThan(-1);
    // Body ends at the closing `}, (table) => ({` for this table
    // (every Drizzle pgTable in the file uses this shape). Search a
    // generous slice forward to capture the body.
    const tableSlice = schemaSrc.slice(tableStart, tableStart + 4000);
    expect(tableSlice).toMatch(
      /paymentTermsDays:\s*integer\(\s*"payment_terms_days"\s*\)/,
    );
    // The customer column is nullable; must NOT carry .notNull() inside
    // the customer_companies block (the invoices table has its own
    // paymentTermsDays which IS notNull — different field, ignored).
    expect(tableSlice).not.toMatch(
      /paymentTermsDays:\s*integer\(\s*"payment_terms_days"\s*\)\.notNull/,
    );
  });
});

// ── Server route Zod ─────────────────────────────────────────────────

describe("PATCH /api/customer-companies/:id — accepts paymentTermsDays", () => {
  it("the strict Zod schema admits paymentTermsDays (0–365, nullable)", () => {
    expect(customerRouteSrc).toMatch(
      /paymentTermsDays:\s*z\.number\(\)\.int\(\)\.min\(0\)\.max\(365\)\.nullable\(\)\.optional\(\)/,
    );
  });
});

// ── Storage repo signature ───────────────────────────────────────────

describe("customerCompanyRepository.updateCustomerCompany — paymentTermsDays in payload", () => {
  it("the data param admits paymentTermsDays as `number | null`", () => {
    expect(customerStorageSrc).toMatch(/paymentTermsDays\?:\s*number\s*\|\s*null;/);
  });
});

// ── Invoice creation chain ──────────────────────────────────────────

describe("createInvoiceAtomic — defaults from client paymentTermsDays", () => {
  it("fetches the customer's paymentTermsDays when customerCompanyId is present", () => {
    expect(invoiceStorageSrc).toMatch(
      /paymentTermsDays:\s*customerCompanies\.paymentTermsDays/,
    );
    expect(invoiceStorageSrc).toMatch(/clientPaymentTermsDays/);
  });

  it("the resolution chain is: caller > client > company default > 30", () => {
    // Single-line `??` chain is what the implementation uses; pin it
    // strictly so a future refactor can't reorder the precedence.
    expect(invoiceStorageSrc).toMatch(
      /params\.paymentTermsDays[\s\S]{0,80}?\?\?[\s\S]{0,80}?clientPaymentTermsDays[\s\S]{0,80}?\?\?[\s\S]{0,80}?settings\?\.defaultPaymentTermsDays[\s\S]{0,40}?\?\?[\s\S]{0,20}?30/,
    );
  });

  it("does NOT fetch the customer when there is no customerCompanyId (no extra DB read for cash sales)", () => {
    expect(invoiceStorageSrc).toMatch(/if\s*\(params\.customerCompanyId\)/);
  });
});

// ── EditCompanyDialog UI ─────────────────────────────────────────────

describe("EditCompanyDialog — Payment Terms section", () => {
  it("renders a Payment Terms FormSection in the dialog body", () => {
    expect(editDialogSrc).toMatch(/<FormSection title="Payment Terms">/);
  });

  it("renders the canonical select with all eight options", () => {
    expect(editDialogSrc).toMatch(/data-testid="select-client-payment-terms"/);
    for (const option of [
      "Use company default",
      "Due on receipt",
      "Net 7",
      "Net 15",
      "Net 30",
      "Net 45",
      "Net 60",
      "Custom",
    ]) {
      expect(editDialogSrc).toContain(option);
    }
  });

  it("surfaces the canonical helper text", () => {
    expect(editDialogSrc).toMatch(
      /Used as the default payment terms for new invoices for this\s+client\./,
    );
    expect(editDialogSrc).toMatch(
      /data-testid="text-client-payment-terms-helper"/,
    );
  });

  it("'Custom' selection reveals a number input (0–365)", () => {
    // The conditional `{form.paymentTermsMode === "custom" && (` wraps
    // a FormField + Input; distance to the testid is ~600 chars.
    expect(editDialogSrc).toMatch(
      /form\.paymentTermsMode\s*===\s*"custom"\s*&&\s*\(/,
    );
    expect(editDialogSrc).toMatch(
      /data-testid="input-client-payment-terms-custom-days"/,
    );
    expect(editDialogSrc).toMatch(/min=\{0\}/);
    expect(editDialogSrc).toMatch(/max=\{365\}/);
  });

  it("the PATCH payload sends paymentTermsDays via the mode→days mapper", () => {
    expect(editDialogSrc).toMatch(
      /paymentTermsDays:\s*paymentTermsDaysFromMode\(/,
    );
  });

  it("'Use company default' maps to null (inherits the tenant default)", () => {
    expect(editDialogSrc).toMatch(
      /case\s+"default":\s*[\s\S]{0,80}?return\s+null;/,
    );
  });
});
