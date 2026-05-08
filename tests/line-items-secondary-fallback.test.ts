/**
 * LineItemRow secondary-slot fallback chain — pins the resilience
 * fix shipped on 2026-05-07 (third item-display iteration).
 *
 * Context: even with the JOIN-based productName surfaced for the
 * primary label, the row could still collapse to single-line on
 * legacy data where the line's `description` column happened to
 * equal the catalog name (a common state because earlier helper
 * revisions wrote `description = item.name`). The fix: surface a
 * second JOIN field `productDescription` (catalog `items.description`)
 * and let the row pick whichever non-empty candidate differs from
 * the primary label — `description` first (user override / fresh
 * data), `productDescription` as the catalog-side fallback.
 *
 * Verifies on all three persisted surfaces:
 *   - Server JOINs surface both fields.
 *   - Client display types carry both.
 *   - Job projection remaps r.itemName → productName + r.itemDescription
 *     → productDescription.
 *   - Row renderer's candidate-scan picks the right secondary.
 *
 * Source-pin tests (no jsdom/RTL harness in this repo).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");

const ROW_PATH = resolve(ROOT, "client/src/components/line-items/LineItemRow.tsx");
const INVOICE_STORAGE = resolve(ROOT, "server/storage/invoices.ts");
const QUOTE_STORAGE = resolve(ROOT, "server/storage/quotes.ts");
const INVOICE_PAGE = resolve(ROOT, "client/src/pages/InvoiceDetailPage.tsx");
const QUOTE_PAGE = resolve(ROOT, "client/src/pages/QuoteDetailPage.tsx");
const JOB_PAGE = resolve(ROOT, "client/src/pages/JobDetailPage.tsx");

const rowSrc = readFileSync(ROW_PATH, "utf-8");
const invoiceStorageSrc = readFileSync(INVOICE_STORAGE, "utf-8");
const quoteStorageSrc = readFileSync(QUOTE_STORAGE, "utf-8");
const invoicePageSrc = readFileSync(INVOICE_PAGE, "utf-8");
const quotePageSrc = readFileSync(QUOTE_PAGE, "utf-8");
const jobPageSrc = readFileSync(JOB_PAGE, "utf-8");

// ── Server JOINs surface productDescription ────────────────────────

describe("server JOIN — productDescription is surfaced on every line route", () => {
  it("getInvoiceLines selects items.description as productDescription", () => {
    expect(invoiceStorageSrc).toMatch(/productDescription:\s*items\.description/);
    expect(invoiceStorageSrc).toMatch(/productDescription:\s*r\.productDescription/);
  });

  it("getQuoteLines selects items.description as productDescription", () => {
    expect(quoteStorageSrc).toMatch(/productDescription:\s*items\.description/);
    expect(quoteStorageSrc).toMatch(/productDescription:\s*r\.productDescription/);
  });

  it("getJobParts (already had itemDescription via the existing JOIN — pin its presence)", () => {
    const jobStorageSrc = readFileSync(
      resolve(ROOT, "server/storage/jobs.ts"),
      "utf-8",
    );
    const block = jobStorageSrc.match(
      /async getJobParts\([\s\S]+?\.orderBy\([\s\S]+?\}\s/m,
    );
    expect(block).toBeTruthy();
    expect(block![0]).toMatch(/itemDescription:\s*items\.description/);
  });
});

// ── Client types carry productDescription ─────────────────────────

describe("client types — productDescription threaded through every surface", () => {
  it("LineItemRow's DisplayLine declares productDescription as optional", () => {
    expect(rowSrc).toMatch(/productDescription\?:\s*string \| null/);
  });

  it("InvoiceDetailPage's lines type augments InvoiceLine with productDescription", () => {
    expect(invoicePageSrc).toMatch(
      /lines:\s*\(InvoiceLine & \{[\s\S]*?productDescription\?:\s*string \| null;[\s\S]*?\}\)\[\]/,
    );
  });

  it("QuoteDetailPage's lines type augments QuoteLine with productDescription", () => {
    expect(quotePageSrc).toMatch(
      /lines:\s*\(QuoteLine & \{[\s\S]*?productDescription\?:\s*string \| null;[\s\S]*?\}\)\[\]/,
    );
  });

  it("JobPartDisplayLine declares productDescription and the projection populates it", () => {
    expect(jobPageSrc).toMatch(/productDescription\?:\s*string \| null;/);
    // Job's wire field name is `itemDescription`; client remaps to
    // the canonical `productDescription` so the shared row sees the
    // same shape it sees on Invoice/Quote.
    expect(jobPageSrc).toMatch(/productDescription:\s*r\.itemDescription \?\? null/);
  });
});

// ── Row renderer — fallback chain ──────────────────────────────────

describe("LineItemRow secondary-slot fallback chain", () => {
  it("primary derives from productName ?? description (manual-line fallback unchanged)", () => {
    expect(rowSrc).toMatch(
      /const primary =\s*\(displayLine\.productName \?\? ""\)\.trim\(\) \|\| displayLine\.description/,
    );
  });

  it("the candidate array carries description FIRST, productDescription SECOND", () => {
    // Order matters — the line's own `description` column wins
    // when the user has typed a custom override; the catalog
    // description text is the secondary fallback for legacy rows.
    const block = rowSrc.match(
      /const candidates = \[[\s\S]+?\];/,
    );
    expect(block, "candidates array must be findable").toBeTruthy();
    const descIdx = block![0].indexOf("displayLine.description");
    const prodDescIdx = block![0].indexOf("displayLine.productDescription");
    expect(descIdx).toBeGreaterThan(-1);
    expect(prodDescIdx).toBeGreaterThan(-1);
    expect(descIdx).toBeLessThan(prodDescIdx);
  });

  it("secondary picks the first non-empty candidate that differs from primary (case-insensitive)", () => {
    expect(rowSrc).toMatch(
      /candidates\.find\(\s*\(c\)\s*=>\s*c\.length\s*>\s*0\s*&&\s*c\.toLowerCase\(\)\s*!==\s*primaryNorm/,
    );
  });

  it("manual lines (no productName) bypass the candidate scan entirely", () => {
    // The !!displayLine.productName ternary short-circuits the
    // .find() call and forces secondary = null. Manual lines stay
    // single-line.
    expect(rowSrc).toMatch(
      /!!displayLine\.productName\s*\?\s*candidates\.find/,
    );
    // The else branch yields null.
    expect(rowSrc).toMatch(/:\s*null/);
  });

  it("renders secondary block only when the resolved `secondary` is truthy", () => {
    expect(rowSrc).toMatch(/\{secondary && \(/);
    // Old `showSecondary` boolean is gone — it was the prior single-
    // source guard and would mask the new fallback chain if a
    // future refactor reintroduced it.
    expect(rowSrc).not.toMatch(/const showSecondary =/);
  });
});

// ── Behavior matrix (described in source comments) ─────────────────

describe("LineItemRow rendering — behavior matrix vs data states", () => {
  it("documents the rendering rationale alongside the code", () => {
    // Pin the JSX render-block doc so the architectural rationale
    // stays discoverable. Anchor on the JSX comment opener to
    // disambiguate from the JSDoc above the field declarations.
    const docBlock = rowSrc.match(
      /\{\/\*\s*2026-05-07 \(#3\)[\s\S]+?\*\/\}/,
    );
    expect(docBlock, "JSX doc block must be findable").toBeTruthy();
    const block = docBlock![0];
    expect(block).toMatch(/two-line label/i);
    // Phrase wraps across lines in the JSX comment — allow whitespace.
    expect(block).toMatch(/two-source\s+secondary fallback/i);
    expect(block).toMatch(/displayLine\.description/);
    expect(block).toMatch(/displayLine\.productDescription/);
  });
});
