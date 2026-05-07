/**
 * Quote line cost persistence source-pin tests (2026-05-06).
 *
 * Closes the gap that left saved quotes reading back `unitCost = 0`
 * even when the user picked a product with real cost during creation.
 * The fix added `quote_lines.unit_cost` (migration
 * `2026_05_06_quote_lines_unit_cost.sql`) and threaded the field
 * through the canonical line-item pipeline:
 *
 *   1. `quoteLines` Drizzle table has `unitCost` column.
 *   2. `updateQuoteLineSchema` accepts `unitCost`.
 *   3. `createQuoteSchema.lines` accepts `unitCost`.
 *   4. `InlineCreateQuoteLine` carries `unitCost`.
 *   5. `mirrorLineToInlineCreate` projects `unitCost` from the synthetic
 *      mirror into the create payload.
 *   6. `convert-to-job` propagates `unitCost` from quote_lines into the
 *      created job_parts row (job_parts.unit_cost already existed).
 *
 * These pins fail if a future refactor:
 *   - drops the migration file
 *   - removes `unitCost` from the `quoteLines` Drizzle definition
 *   - strips `unitCost` from any of the Zod schemas above
 *   - re-introduces a `mirrorLineToInlineCreate` projection that omits
 *     the cost field
 *   - reverts the quote-to-job loop to drop cost (which would silently
 *     reset margin to 100 % on the converted job, breaking the
 *     downstream invoice billable-preview hydration too)
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const migrationPath = resolve(
  __dirname,
  "../migrations/2026_05_06_quote_lines_unit_cost.sql",
);
const schemaSrc = readFileSync(
  resolve(__dirname, "../shared/schema.ts"),
  "utf-8",
);
const quoteRouteSrc = readFileSync(
  resolve(__dirname, "../server/routes/quotes.ts"),
  "utf-8",
);
const draftQuoteAdapterSrc = readFileSync(
  resolve(
    __dirname,
    "../client/src/components/quotes/draftQuoteLineItemsAdapter.ts",
  ),
  "utf-8",
);
const createQuotePageSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/CreateQuotePage.tsx"),
  "utf-8",
);
const lineItemMapperSrc = readFileSync(
  resolve(__dirname, "../client/src/lib/entities/lineItemMapper.ts"),
  "utf-8",
);

// ── Migration ───────────────────────────────────────────────────────

describe("Migration — quote_lines.unit_cost", () => {
  it("the migration file exists on disk", () => {
    expect(existsSync(migrationPath)).toBe(true);
  });

  it("adds the column with the canonical numeric(12,2) shape (matches invoice_lines + job_parts)", () => {
    const sql = readFileSync(migrationPath, "utf-8");
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+quote_lines[\s\S]*?ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+unit_cost\s+numeric\(12\s*,\s*2\)/i,
    );
  });

  it("is idempotent (uses IF NOT EXISTS — safe to re-run)", () => {
    const sql = readFileSync(migrationPath, "utf-8");
    expect(sql).toMatch(/IF\s+NOT\s+EXISTS/i);
  });
});

// ── Drizzle schema ──────────────────────────────────────────────────

describe("shared/schema.ts — quoteLines.unitCost", () => {
  it("declares unitCost on the quoteLines table with the canonical numeric(12,2) shape", () => {
    expect(schemaSrc).toMatch(
      /export\s+const\s+quoteLines\s*=\s*pgTable\(\s*"quote_lines"[\s\S]*?unitCost:\s*numeric\(\s*"unit_cost"\s*,\s*\{\s*precision:\s*12\s*,\s*scale:\s*2\s*\}[\s\S]*?\}\)/,
    );
  });

  it("updateQuoteLineSchema accepts unitCost (nullable, optional)", () => {
    expect(schemaSrc).toMatch(
      /export\s+const\s+updateQuoteLineSchema\s*=\s*z\.object\(\{[\s\S]*?unitCost:\s*z\.string\(\)\.nullable\(\)\.optional\(\)/,
    );
  });
});

// ── Server route Zod ────────────────────────────────────────────────

describe("server/routes/quotes.ts — createQuoteSchema.lines", () => {
  it("accepts unitCost on each inline line in POST /api/quotes", () => {
    expect(quoteRouteSrc).toMatch(
      /lines:\s*z\.array\(z\.object\(\{[\s\S]*?unitCost:\s*z\.string\(\)[\s\S]*?\.nullable\(\)\.optional\(\)/,
    );
  });
});

// ── Quote → Job conversion preserves cost ───────────────────────────

describe("server/routes/quotes.ts — convert-to-job preserves unitCost", () => {
  it("the quote-line → job-part loop carries unitCost into createJobPart", () => {
    expect(quoteRouteSrc).toMatch(
      /createJobPart\([\s\S]*?unitCost:\s*\(line[\s\S]*?\)\.unitCost[\s\S]*?\}\)/,
    );
  });

  it("the loop still passes the existing fields (description / quantity / unitPrice / productId)", () => {
    // Defensive: ensure the cost addition didn't drop another column.
    expect(quoteRouteSrc).toMatch(/description:\s*line\.description/);
    expect(quoteRouteSrc).toMatch(/quantity:\s*line\.quantity/);
    expect(quoteRouteSrc).toMatch(/unitPrice:\s*line\.unitPrice/);
    expect(quoteRouteSrc).toMatch(/productId:\s*line\.productId/);
  });
});

// ── Client wire — InlineCreateQuoteLine + mirror projection ─────────

describe("draftQuoteLineItemsAdapter — wire shape carries unitCost", () => {
  it("InlineCreateQuoteLine declares unitCost (nullable, optional)", () => {
    expect(draftQuoteAdapterSrc).toMatch(
      /export\s+interface\s+InlineCreateQuoteLine\s*\{[\s\S]*?unitCost\?:\s*string\s*\|\s*null;/,
    );
  });

  it("mirrorLineToInlineCreate projects unitCost from the mirror into the payload", () => {
    expect(draftQuoteAdapterSrc).toMatch(
      /export\s+function\s+mirrorLineToInlineCreate\([\s\S]*?return\s*\{[\s\S]*?unitCost:\s*cost/,
    );
  });
});

// ── Create page — synthetic mirror still carries draft.unitCost ─────

describe("CreateQuotePage — synthetic mirror preserves unitCost end-to-end", () => {
  it("makeMirrorLine accepts unitCost and persists it on the synthetic line", () => {
    expect(createQuotePageSrc).toMatch(
      /function\s+makeMirrorLine\(args:\s*\{[\s\S]*?unitCost:\s*string\s*\|\s*null;[\s\S]*?\}\)/,
    );
    expect(createQuotePageSrc).toMatch(/unitCost:\s*args\.unitCost/);
  });

  it("the onCommit reconciliation passes entry.draft.unitCost through (both new + existing rows)", () => {
    const matches = createQuotePageSrc.match(
      /unitCost:\s*entry\.draft\.unitCost\s*\|\|\s*null/g,
    );
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

// ── Detail-page hydration unchanged (still uses canonical mapper) ───

describe("Detail-page hydration — unitCost flows through hydrateDraft", () => {
  it("toCanonicalPayload (the mapper that backs draftToQuoteLinePayload) carries unitCost", () => {
    // Source: client/src/lib/entities/lineItemMapper.ts:271-285.
    expect(lineItemMapperSrc).toMatch(
      /function\s+toCanonicalPayload\(draft:\s*LineItemDraft\)[\s\S]*?\{[\s\S]*?unitCost:\s*draft\.unitCost/,
    );
  });

  it("hydrateDraft reads row.unitCost (with the canonical zero default)", () => {
    expect(lineItemMapperSrc).toMatch(
      /unitCost:\s*toMoneyString\(row\.unitCost[\s\S]*?ZERO/,
    );
  });
});
