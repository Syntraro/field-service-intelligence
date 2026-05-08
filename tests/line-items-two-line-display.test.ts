/**
 * Line-item two-line display contract — locks the schema-join +
 * row-renderer + per-surface wiring shipped on 2026-05-07.
 *
 * Goal: each line shows
 *   • Primary  = catalog item NAME (joined via productId)
 *   • Secondary = the line's description column, suppressed when
 *     equal to primary or when the line has no productId
 *
 * Implementation strategy: read-only enrichment via server LEFT JOIN
 * — no schema migration required. The line's `description` column
 * remains the canonical save/round-trip label; `productName` is a
 * computed-on-read field.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");

const ROW_PATH = resolve(ROOT, "client/src/components/line-items/LineItemRow.tsx");
const INVOICE_STORAGE = resolve(ROOT, "server/storage/invoices.ts");
const QUOTE_STORAGE = resolve(ROOT, "server/storage/quotes.ts");
const JOB_STORAGE = resolve(ROOT, "server/storage/jobs.ts");
const INVOICE_PAGE = resolve(ROOT, "client/src/pages/InvoiceDetailPage.tsx");
const QUOTE_PAGE = resolve(ROOT, "client/src/pages/QuoteDetailPage.tsx");
const JOB_PAGE = resolve(ROOT, "client/src/pages/JobDetailPage.tsx");

const rowSrc = readFileSync(ROW_PATH, "utf-8");
const invoiceStorageSrc = readFileSync(INVOICE_STORAGE, "utf-8");
const quoteStorageSrc = readFileSync(QUOTE_STORAGE, "utf-8");
const jobStorageSrc = readFileSync(JOB_STORAGE, "utf-8");
const invoicePageSrc = readFileSync(INVOICE_PAGE, "utf-8");
const quotePageSrc = readFileSync(QUOTE_PAGE, "utf-8");
const jobPageSrc = readFileSync(JOB_PAGE, "utf-8");

// ── 1. Server-side joins ─────────────────────────────────────────────

describe("server — line fetches LEFT JOIN items and surface productName / itemName", () => {
  it("getInvoiceLines joins items and returns productName per line", () => {
    const block = invoiceStorageSrc.match(
      /async getInvoiceLines\([\s\S]+?\}\s*\}/m,
    );
    expect(block, "getInvoiceLines must be findable").toBeTruthy();
    expect(block![0]).toMatch(/\.leftJoin\(items,\s*eq\(invoiceLines\.productId,\s*items\.id\)\)/);
    expect(block![0]).toMatch(/productName:\s*items\.name/);
    expect(block![0]).toMatch(/productName:\s*r\.productName/);
  });

  it("getQuoteLines joins items and returns productName + productDescription per line", () => {
    const block = quoteStorageSrc.match(
      /async getQuoteLines\([\s\S]+?\}\s*\}/m,
    );
    expect(block, "getQuoteLines must be findable").toBeTruthy();
    expect(block![0]).toMatch(/\.leftJoin\(items,\s*eq\(quoteLines\.productId,\s*items\.id\)\)/);
    expect(block![0]).toMatch(/productName:\s*items\.name/);
    expect(block![0]).toMatch(/productDescription:\s*items\.description/);
    expect(block![0]).toMatch(/productName:\s*r\.productName/);
    expect(block![0]).toMatch(/productDescription:\s*r\.productDescription/);
    // Return type extends QuoteLine with both joined fields.
    expect(quoteStorageSrc).toMatch(
      /Promise<\(QuoteLine & \{ productName:\s*string \| null;\s*productDescription:\s*string \| null \}\)\[\]>/,
    );
  });

  it("getInvoiceLines also surfaces productDescription for the secondary-slot fallback", () => {
    const block = invoiceStorageSrc.match(
      /async getInvoiceLines\([\s\S]+?\}\s*\}/m,
    );
    expect(block, "getInvoiceLines must be findable").toBeTruthy();
    expect(block![0]).toMatch(/productDescription:\s*items\.description/);
    expect(block![0]).toMatch(/productDescription:\s*r\.productDescription/);
  });

  it("getJobParts extends its existing items join with itemName", () => {
    const block = jobStorageSrc.match(
      /async getJobParts\([\s\S]+?\.orderBy\([\s\S]+?\}\s/m,
    );
    expect(block, "getJobParts must be findable").toBeTruthy();
    // Pre-existing itemType + itemDescription joins remain.
    expect(block![0]).toMatch(/itemType:\s*items\.type/);
    expect(block![0]).toMatch(/itemDescription:\s*items\.description/);
    // New addition.
    expect(block![0]).toMatch(/itemName:\s*items\.name/);
    // Return type advertises the new field.
    expect(jobStorageSrc).toMatch(
      /Promise<\(JobPart & \{ itemType:\s*string \| null;\s*itemName:\s*string \| null;\s*itemDescription:\s*string \| null \}\)\[\]>/,
    );
  });
});

// ── 2. Client display types extended ─────────────────────────────────

describe("client display types extended with productName / itemName", () => {
  it("LineItemRow's DisplayLine carries an optional productName", () => {
    expect(rowSrc).toMatch(/productName\?:\s*string \| null/);
  });

  it("InvoiceDetailPage's lines type augments InvoiceLine with productName + productDescription", () => {
    expect(invoicePageSrc).toMatch(
      /lines:\s*\(InvoiceLine & \{[\s\S]*?productName\?:\s*string \| null;[\s\S]*?productDescription\?:\s*string \| null;[\s\S]*?\}\)\[\]/,
    );
  });

  it("QuoteDetailPage's lines type augments QuoteLine with productName + productDescription", () => {
    expect(quotePageSrc).toMatch(
      /lines:\s*\(QuoteLine & \{[\s\S]*?productName\?:\s*string \| null;[\s\S]*?productDescription\?:\s*string \| null;[\s\S]*?\}\)\[\]/,
    );
  });

  it("JobPartDisplayLine carries productName + productDescription, fed from item* fields", () => {
    expect(jobPageSrc).toMatch(/productName\?:\s*string \| null;/);
    expect(jobPageSrc).toMatch(/productDescription\?:\s*string \| null;/);
    // Projection from server response: r.itemName → productName,
    // r.itemDescription → productDescription.
    expect(jobPageSrc).toMatch(/productName:\s*r\.itemName \?\? null/);
    expect(jobPageSrc).toMatch(/productDescription:\s*r\.itemDescription \?\? null/);
  });
});

// ── 3. resolveProduct prefers joined catalog name ──────────────────

describe("adapters — resolveProduct prefers the joined catalog name for the chip", () => {
  it("InvoiceDetailPage resolveProduct uses productName ?? description", () => {
    expect(invoicePageSrc).toMatch(
      /\(\(line as InvoiceLine & \{ productName\?:\s*string \| null \}\)\.productName \?\? line\.description\)/,
    );
  });

  it("QuoteDetailPage resolveProduct uses productName ?? description", () => {
    expect(quotePageSrc).toMatch(
      /\(\(line as QuoteLine & \{ productName\?:\s*string \| null \}\)\.productName \?\? line\.description\)/,
    );
  });

  it("JobDetailPage resolveProduct uses productName ?? description", () => {
    expect(jobPageSrc).toMatch(
      /name:\s*line\.productName \?\? line\.description \?\? "\(unnamed item\)"/,
    );
  });
});

// ── 4. Row renderer — primary + secondary with suppression ─────────

describe("LineItemRow — true two-line label with duplicate suppression", () => {
  it("computes primary from productName, falling back to description", () => {
    expect(rowSrc).toMatch(
      /const primary =\s*\(displayLine\.productName \?\? ""\)\.trim\(\) \|\| displayLine\.description/,
    );
  });

  it("renders secondary via two-source fallback chain (description, then productDescription)", () => {
    // 2026-05-07 (#3): secondary slot now picks the FIRST candidate
    // that's non-empty AND differs from primary (case-insensitive):
    //   1. line.description (user override / primary content of column)
    //   2. productDescription (catalog item description, joined)
    // Manual lines (no productName) bypass the chain via the
    // !!displayLine.productName guard and stay single-line.
    expect(rowSrc).toMatch(/const candidates = \[/);
    expect(rowSrc).toMatch(/\(displayLine\.description \?\? ""\)\.trim\(\)/);
    expect(rowSrc).toMatch(/\(displayLine\.productDescription \?\? ""\)\.trim\(\)/);
    expect(rowSrc).toMatch(
      /candidates\.find\(\s*\(c\)\s*=>\s*c\.length\s*>\s*0\s*&&\s*c\.toLowerCase\(\)\s*!==\s*primaryNorm/,
    );
    // Manual-line guard.
    expect(rowSrc).toMatch(/!!displayLine\.productName/);
  });

  it("primary line carries a stable testid for tests; secondary too", () => {
    expect(rowSrc).toMatch(/data-testid=\{`line-primary-\$\{displayLine\.id\}`\}/);
    expect(rowSrc).toMatch(/data-testid=\{`line-secondary-\$\{displayLine\.id\}`\}/);
  });

  it("secondary line uses muted typography (smaller + secondary tone)", () => {
    // text-[11px] + text-muted-foreground — visually subordinate to
    // the primary `text-xs font-medium text-slate-900`.
    expect(rowSrc).toMatch(/text-\[11px\] font-normal text-muted-foreground/);
  });

  it("manual lines (no productName) fall back to single-line display off description", () => {
    // When productName is null, the !!displayLine.productName guard
    // short-circuits the candidate scan and `secondary = null`.
    // Primary then renders displayLine.description directly (the
    // `(productName ?? "").trim() || description` fallback).
    const renderBlock = rowSrc.match(
      /const primary =[\s\S]+?return \(\s*<>[\s\S]+?<\/>/,
    );
    expect(renderBlock, "render closure must be findable").toBeTruthy();
    // Primary always renders.
    expect(renderBlock![0]).toMatch(/<div className="text-xs font-medium/);
    // Secondary is gated on the resolved `secondary` candidate
    // being non-null. Manual lines hit the `productName` guard and
    // produce `secondary = null` → block doesn't render.
    expect(renderBlock![0]).toMatch(/\{secondary && \(/);
  });
});

// ── 5. Save round-trip preserved ────────────────────────────────────

describe("save round-trip — description column remains the canonical label", () => {
  it("LineItemEditModal still saves description (the schema column) as-is", () => {
    // The two-line display is read-only enrichment. The modal's
    // form still edits and persists `description`. Future API joins
    // may add server-side columns, but for now `productName` is
    // computed; only `description` round-trips.
    const modalSrc = readFileSync(
      resolve(ROOT, "client/src/components/line-items/LineItemEditModal.tsx"),
      "utf-8",
    );
    expect(modalSrc).toMatch(/description:\s*finalDescription/);
    expect(modalSrc).toMatch(/onSave\(finalDraft\)/);
    // Modal does NOT try to persist `productName` — it's read-only
    // and resolved server-side.
    expect(modalSrc).not.toMatch(/productName:/);
  });

  it("save adapter payloads (invoice/quote/job) do NOT include productName", () => {
    // Adapters' addLine/updateLine push the canonical draft through
    // draftTo*LinePayload. None of those mappers touch productName.
    const mapperSrc = readFileSync(
      resolve(ROOT, "client/src/lib/entities/lineItemMapper.ts"),
      "utf-8",
    );
    const payloadFns = mapperSrc.match(
      /export function (draftToInvoiceLinePayload|draftToQuoteLinePayload|draftToJobPartPayload)[\s\S]+?\n\}/g,
    );
    expect(payloadFns, "payload mappers must exist").toBeTruthy();
    for (const fn of payloadFns!) {
      expect(fn).not.toMatch(/productName/);
    }
  });
});
