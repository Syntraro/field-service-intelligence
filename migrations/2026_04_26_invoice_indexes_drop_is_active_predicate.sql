-- ============================================================================
-- Invoice indexes — drop stale `is_active = true` predicate (forward-fix)
-- Migration: 2026_04_26_invoice_indexes_drop_is_active_predicate
-- ============================================================================
--
-- The historical `migrations/0001_critical_indexes.sql` (lines 19-25) created
-- two indexes on `invoices` with a partial predicate `WHERE is_active = true`:
--
--     CREATE INDEX idx_invoices_company_status ON invoices(company_id, status)
--       WHERE is_active = true;
--     CREATE INDEX idx_invoices_location_id    ON invoices(location_id)
--       WHERE is_active = true;
--
-- The `invoices.is_active` column was subsequently dropped by
-- `migrations/2026_04_09_invoice_permanent_delete.sql:50` when the invoice
-- model moved to permanent-delete. On any database that has already passed
-- through both migrations, the index structure remains; PostgreSQL keeps the
-- index in place when the column it referenced is dropped (the predicate is
-- effectively orphaned). On a FRESH rebuild that replays the migration
-- history end-to-end, however, `CREATE INDEX ... WHERE is_active = true`
-- would fail because the column no longer exists at the point 0001 runs.
--
-- This migration is the forward-fix:
--   1. DROP both indexes if they exist (the broken-predicate version).
--   2. CREATE equivalent indexes on the current canonical schema, without
--      any `is_active` predicate.
--
-- Historical migrations are NOT edited (per project convention — historical
-- files are immutable). Runtime code is NOT changed. No other indexes are
-- touched.
--
-- Note (audit follow-up): `0001_critical_indexes.sql` also has two more
-- invoice indexes with the same `WHERE is_active = true` predicate —
-- `idx_invoices_pending` (lines 107-110) and `idx_invoices_list_covering`
-- (lines 119-122). They share the same fresh-rebuild risk and are
-- intentionally OUT OF SCOPE for this migration; address them in a
-- separate follow-up forward-fix migration.
--
-- CONCURRENTLY semantics: both DROP INDEX CONCURRENTLY and CREATE INDEX
-- CONCURRENTLY require running outside a transaction. This file matches
-- `0001_critical_indexes.sql`'s pattern (no BEGIN/COMMIT block) so the
-- migration runner executes each statement in autocommit.

DROP INDEX CONCURRENTLY IF EXISTS idx_invoices_company_status;
DROP INDEX CONCURRENTLY IF EXISTS idx_invoices_location_id;

-- Invoices: Company + Status (Invoice Lists) — no `is_active` predicate.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_company_status
  ON invoices(company_id, status);

-- Invoices: Location lookup (prevents N+1) — no `is_active` predicate.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_location_id
  ON invoices(location_id);

ANALYZE invoices;
