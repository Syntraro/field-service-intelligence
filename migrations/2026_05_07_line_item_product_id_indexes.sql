-- 2026-05-07: partial indexes on line-item product_id columns to make
-- the Pricebook picker's "most used" sort scale.
--
-- The /api/items?sort=most_used query aggregates COUNT(*) GROUP BY
-- product_id across invoice_lines, quote_lines, and job_parts. Job
-- parts already has `idx_job_parts_product` (partial, WHERE is_active
-- = true) from migrations/add_performance_indexes.sql; invoice_lines
-- and quote_lines have NO index on product_id, so the usage-count
-- subquery would full-table-scan both at every Pricebook open.
--
-- Indexes are partial (WHERE product_id IS NOT NULL) because manual
-- lines that don't reference a catalog item never participate in the
-- usage count and don't need to be indexed. Smaller index, cheaper
-- writes, identical query plan for the read path.
--
-- IF NOT EXISTS keeps the migration idempotent for re-runs.
--
-- Run with: npm run db:migrate:one -- migrations/2026_05_07_line_item_product_id_indexes.sql

CREATE INDEX IF NOT EXISTS idx_invoice_lines_product_id
  ON invoice_lines (product_id)
  WHERE product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quote_lines_product_id
  ON quote_lines (product_id)
  WHERE product_id IS NOT NULL;
