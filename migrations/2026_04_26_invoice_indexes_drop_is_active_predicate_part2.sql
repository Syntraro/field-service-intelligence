-- ============================================================================
-- Invoice indexes — drop stale `is_active = true` predicate (part 2)
-- Migration: 2026_04_26_invoice_indexes_drop_is_active_predicate_part2
-- ============================================================================
--
-- Companion to `2026_04_26_invoice_indexes_drop_is_active_predicate.sql`.
-- The earlier migration fixed the two invoice indexes the original audit
-- explicitly named (`idx_invoices_company_status`, `idx_invoices_location_id`).
-- A grep against the migration history surfaced two MORE invoice indexes in
-- the same historical `migrations/0001_critical_indexes.sql` with the same
-- broken `WHERE is_active = true` predicate. This migration cleans them up:
--
--     -- 0001_critical_indexes.sql:107-110
--     CREATE INDEX idx_invoices_pending
--       ON invoices(company_id, issue_date)
--       WHERE status NOT IN ('paid', 'void')
--         AND is_active = true;
--
--     -- 0001_critical_indexes.sql:119-122
--     CREATE INDEX idx_invoices_list_covering
--       ON invoices(company_id, status, issue_date)
--       INCLUDE (invoice_number, total, location_id)
--       WHERE is_active = true;
--
-- The `invoices.is_active` column was dropped by
-- `migrations/2026_04_09_invoice_permanent_delete.sql:50` when invoices
-- moved to the permanent-delete model. Same fresh-rebuild and orphan-state
-- considerations as part 1.
--
-- ── DELIBERATE PREDICATE CORRECTION ────────────────────────────────────────
--
-- The historical `idx_invoices_pending` predicate referenced the literal
-- status value `'void'`, but the canonical `invoiceStatusEnum`
-- (`shared/schema.ts:1516`) uses `'voided'`. PostgreSQL never validates
-- string literals in a partial-index predicate against the application
-- enum, so the historical index has been silently over-inclusive — it has
-- only excluded `'paid'` rows; it has NOT excluded `'voided'` rows.
--
-- Per the brief's instruction to recreate "equivalent indexes using current
-- invoice schema only", this migration uses the canonical `'voided'` value.
-- Net effect: the new `idx_invoices_pending` correctly excludes both
-- terminal states (paid + voided) and is therefore smaller and more
-- selective than the historical one. Queries that filter
-- `WHERE status NOT IN ('paid', 'voided')` continue to use the index
-- transparently; no read-path code change is required.
--
-- ── COVERING INDEX SIMPLIFICATION ──────────────────────────────────────────
--
-- `idx_invoices_list_covering`'s only predicate was `WHERE is_active = true`.
-- After removing it, the index has no partial predicate, so the new index
-- is a full covering index over `(company_id, status, issue_date)` with
-- INCLUDE columns. This is the correct equivalent — the original partial
-- predicate became meaningless when the column was dropped.
--
-- Historical migrations are NOT edited (per project convention — historical
-- files are immutable). The earlier part-1 forward-fix migration
-- (`2026_04_26_invoice_indexes_drop_is_active_predicate.sql`) is also NOT
-- edited; this is a stand-alone companion file.
--
-- Note (out of scope): `migrations/add_performance_indexes.sql:58-60`
-- contains a duplicate historical definition of
-- `idx_invoices_company_status` with the same broken predicate. It is
-- intentionally left untouched here — historical migrations are immutable
-- and the index name overlap with `0001_critical_indexes.sql` makes the
-- statement a no-op via `IF NOT EXISTS` after part-1 ran. Documented for
-- the record.

DROP INDEX CONCURRENTLY IF EXISTS idx_invoices_pending;
DROP INDEX CONCURRENTLY IF EXISTS idx_invoices_list_covering;

-- Partial index: pending invoices (non-terminal status).
-- Replaces the historical partial-predicate version that filtered on the
-- now-dropped `is_active` column AND the non-canonical status string
-- 'void'. New predicate uses the current canonical 'voided' enum value.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_pending
  ON invoices(company_id, issue_date)
  WHERE status NOT IN ('paid', 'voided');

-- Covering index: invoice list.
-- The historical version was a partial covering index gated on the
-- now-dropped `is_active` column. The equivalent on the current schema
-- is a full covering index — no partial predicate.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_list_covering
  ON invoices(company_id, status, issue_date)
  INCLUDE (invoice_number, total, location_id);

ANALYZE invoices;
