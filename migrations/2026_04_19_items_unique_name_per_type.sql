-- 2026-04-19 Catalog hardening — company-scoped, type-aware, case-insensitive
-- uniqueness on `items` (the canonical product/service catalog).
--
-- Background:
--   `items` had no uniqueness on (company_id, name). Concurrent tabs and
--   repeat-submit flows could (and historically did) race past the
--   client-side dedupe guard in QuickAddProductCell + the server-side
--   dedupe in productImport, producing twin catalog rows. The matching
--   `ItemRepository.createOrGet` helper lands in the same release as
--   this migration; this index is the safety net (the helper is the
--   primary dedupe).
--
-- Natural key:
--   (company_id, type, lower(name)) — the user requirement explicitly
--   preserves product-vs-service distinctions, so a "Filter" service
--   and a "Filter" product can coexist, but two products both named
--   "filter" / "FILTER" cannot. This matches the lookup `createOrGet`
--   performs.
--
-- Scope:
--   `WHERE deleted_at IS NULL AND is_active = true` — soft-archived rows
--   keep their names (history is preserved) and don't block creation.
--   `createOrGet` reactivates a soft-deleted match rather than producing
--   a duplicate, so the partial scope is consistent with the helper.
--
-- Live duplicate scan against this DB returned 0 groups across all
-- tenants — safe to ship the index in this same migration without a
-- separate consolidation pass. If a future environment fails this
-- migration, run the detection query in the CHANGELOG entry first and
-- consolidate before re-applying.
--
-- Run via: npm run db:migrate (uses CONCURRENTLY → migration runner
-- dispatches statements outside the implicit transaction block).

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS items_company_type_name_lower_active_uq
  ON items (company_id, type, lower(name))
  WHERE deleted_at IS NULL AND is_active = true;
