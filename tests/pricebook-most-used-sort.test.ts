/**
 * Pricebook picker — most-used sort contract tests (2026-05-07).
 *
 * Pins the end-to-end shape of the new `?sort=most_used` parameter:
 *
 *   • Server route accepts and validates the sort param to a safe enum.
 *   • Storage method extends to `(companyId, search?, sort?)`.
 *   • Storage's most_used branch runs a UNION subquery over the three
 *     line tables (tenant-scoped) and sorts items by usage count desc,
 *     name asc tiebreaker.
 *   • Pricebook picker requests `?sort=most_used&limit=200` only when
 *     search is empty; non-empty search keeps the existing `?q=…` shape.
 *   • Migration adds product_id indexes on invoice_lines + quote_lines.
 *   • Default behavior preserved for every other caller — no `sort`
 *     param means alphabetical (the route's pre-fix default).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");

const ROUTE_PATH = resolve(ROOT, "server/routes/items.ts");
const STORAGE_PATH = resolve(ROOT, "server/storage/items.ts");
const PICKER_PATH = resolve(
  ROOT,
  "client/src/components/line-items/PricebookPickerModal.tsx",
);
const MIGRATION_PATH = resolve(
  ROOT,
  "migrations/2026_05_07_line_item_product_id_indexes.sql",
);

const routeSrc = readFileSync(ROUTE_PATH, "utf-8");
const storageSrc = readFileSync(STORAGE_PATH, "utf-8");
const pickerSrc = readFileSync(PICKER_PATH, "utf-8");

// ── 1. Route accepts and safely validates the sort param ────────────

describe("/api/items GET — sort param", () => {
  it("parses `?sort=...` from req.query", () => {
    expect(routeSrc).toMatch(/const sortRaw = String\(\(req\.query as any\)\?\.sort \?\? ""\)\.trim\(\)/);
  });

  it("validates sort to the safe enum (`name` | `most_used`) — never raw user input", () => {
    // The validation MUST narrow the value to a literal union before
    // it reaches storage. An attacker passing `?sort=DROP TABLE` would
    // be neutralized to `"name"` (the safe default).
    expect(routeSrc).toMatch(
      /const sort:\s*"name"\s*\|\s*"most_used"\s*=\s*sortRaw === "most_used"\s*\?\s*"most_used"\s*:\s*"name"/,
    );
  });

  it("threads the validated sort into storage.getItems(companyId, q, sort)", () => {
    expect(routeSrc).toMatch(
      /storage\.getItems\(companyId,\s*q \|\| undefined,\s*sort\)/,
    );
  });
});

// ── 2. Storage signature + sort branch ──────────────────────────────

describe("ItemRepository.getItems — sort=most_used branch", () => {
  it("exports the ItemListSort type and accepts a third `sort` parameter", () => {
    expect(storageSrc).toMatch(
      /export type ItemListSort = "name" \| "most_used"/,
    );
    expect(storageSrc).toMatch(
      /async getItems\(\s*companyId:\s*string,\s*searchQuery\?:\s*string,\s*sort:\s*ItemListSort = "name",?\s*\):\s*Promise<Item\[\]>/,
    );
  });

  it("default sort is `name` — preserves alphabetical for every existing caller", () => {
    // Pin the default literal so a future refactor can't silently
    // flip the default sort and regress the catalog management UI
    // / line-item pickers / category page.
    expect(storageSrc).toMatch(/sort:\s*ItemListSort = "name"/);
    // The base query path still applies `.orderBy(items.name)`.
    expect(storageSrc).toMatch(/\.orderBy\(items\.name\)/);
    // Early-return short-circuits the most-used branch when sort is
    // anything other than "most_used".
    expect(storageSrc).toMatch(/if \(sort !== "most_used"\)\s*\{\s*return rows;\s*\}/);
  });

  it("most_used branch aggregates COUNT across invoice_lines + quote_lines + job_parts via UNION ALL", () => {
    // Pin the structural shape of the UNION subquery so a refactor
    // can't accidentally drop a table or break the tenant scope.
    expect(storageSrc).toMatch(/SELECT product_id FROM invoice_lines/);
    expect(storageSrc).toMatch(/SELECT product_id FROM quote_lines/);
    expect(storageSrc).toMatch(/SELECT product_id FROM job_parts/);
    expect(storageSrc).toMatch(/UNION ALL[\s\S]+?UNION ALL/);
    // GROUP BY product_id collapses three tables into one count.
    expect(storageSrc).toMatch(/GROUP BY product_id/);
  });

  it("usage subquery is tenant-scoped on every branch (defense in depth)", () => {
    // Each of the three SELECTs MUST carry `WHERE company_id = ?`
    // even though the outer items.where() also filters companyId.
    // Belt and suspenders so a future refactor can't drop the outer
    // filter and silently leak cross-tenant counts.
    const block = storageSrc.match(
      /SELECT product_id FROM invoice_lines[\s\S]+?WHERE company_id = \$\{companyId\}[\s\S]+?SELECT product_id FROM quote_lines[\s\S]+?WHERE company_id = \$\{companyId\}[\s\S]+?SELECT product_id FROM job_parts[\s\S]+?WHERE company_id = \$\{companyId\}/,
    );
    expect(block, "all three line-table subqueries must carry company_id filter").toBeTruthy();
  });

  it("usage subquery respects job_parts soft-delete (deleted_at IS NULL AND is_active = true)", () => {
    expect(storageSrc).toMatch(
      /SELECT product_id FROM job_parts[\s\S]+?deleted_at IS NULL[\s\S]+?is_active = true/,
    );
  });

  it("usage subquery skips manual lines (product_id IS NOT NULL on every branch)", () => {
    const block = storageSrc.match(
      /SELECT product_id FROM invoice_lines[\s\S]+?product_id IS NOT NULL[\s\S]+?SELECT product_id FROM quote_lines[\s\S]+?product_id IS NOT NULL[\s\S]+?SELECT product_id FROM job_parts[\s\S]+?product_id IS NOT NULL/,
    );
    expect(block, "manual lines (no productId) must be excluded everywhere").toBeTruthy();
  });

  it("ranks rows in memory: count DESC, name ASC tiebreaker", () => {
    // Pin the comparator shape so the secondary sort doesn't drift.
    // Items with zero usage end up at the bottom (count default 0)
    // and stay alphabetical among themselves.
    expect(storageSrc).toMatch(
      /if \(aCount !== bCount\) return bCount - aCount/,
    );
    expect(storageSrc).toMatch(
      /\(a\.name \?\? ""\)\.localeCompare\(b\.name \?\? ""\)/,
    );
    // The Map default-to-zero pattern is what puts unused items
    // last (rather than null/undefined comparison).
    expect(storageSrc).toMatch(/usageMap\.get\(a\.id\) \?\? 0/);
    expect(storageSrc).toMatch(/usageMap\.get\(b\.id\) \?\? 0/);
  });
});

// ── 3. Pricebook picker query shape ─────────────────────────────────

describe("PricebookPickerModal — uses sort=most_used on empty search only", () => {
  it("empty-search path requests `?sort=most_used&limit=200`", () => {
    expect(pickerSrc).toMatch(
      /const qs = trimmed[\s\S]+?\?q=\$\{encodeURIComponent\(trimmed\)\}&limit=200[\s\S]+?\?sort=most_used&limit=200/,
    );
  });

  it("non-empty search keeps the existing `?q=...&limit=200` shape (no sort override)", () => {
    // Search results don't pass `sort=most_used` — the brief says
    // "Search results can use normal relevance/name ordering."
    const block = pickerSrc.match(
      /const qs = trimmed[\s\S]+?\?q=\$\{encodeURIComponent\(trimmed\)\}&limit=200/,
    );
    expect(block).toBeTruthy();
    expect(block![0]).not.toMatch(/sort=/);
  });

  it("docstring documents the empty-vs-typed branching", () => {
    // Pin the rationale so a future refactor can't silently flip
    // the contract and have search results sort by usage too.
    expect(pickerSrc).toMatch(/Empty search/);
    expect(pickerSrc).toMatch(/most_used/);
    expect(pickerSrc).toMatch(/Non-empty search/);
  });
});

// ── 4. Migration adds the line-table indexes ────────────────────────

describe("migration — line-table product_id indexes for the most-used query", () => {
  it("migration file exists at the canonical path", () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  it("creates partial indexes on invoice_lines and quote_lines product_id", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf-8");
    // Both indexes use IF NOT EXISTS so re-runs are idempotent.
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_invoice_lines_product_id\s+ON invoice_lines \(product_id\)\s+WHERE product_id IS NOT NULL/,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_quote_lines_product_id\s+ON quote_lines \(product_id\)\s+WHERE product_id IS NOT NULL/,
    );
  });

  it("does NOT touch job_parts — its index already exists", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf-8");
    // The pre-existing `idx_job_parts_product` (from
    // migrations/add_performance_indexes.sql) covers the third leg
    // of the UNION. The new migration intentionally only adds the
    // two missing indexes.
    expect(sql).not.toMatch(/CREATE INDEX[^;]*job_parts/i);
  });
});
