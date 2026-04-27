-- 2026-04-26: Quotes permanent-delete migration
--
-- Goal: bring quotes in line with the invoice permanent-delete model
-- adopted on 2026-04-09 (see shared/schema.ts:1606,1688). Quotes were the
-- last lifecycle entity in the invoice/payment/quote audit (2026-04-25)
-- still on a soft-delete model (`is_active` + `deleted_at`), creating
-- asymmetry that confused callers and required `eq(quotes.is_active, true)`
-- filters in storage/quotes.ts, storage/dashboard.ts, storage/quoteTemplates.ts,
-- and the backfill script. After this migration, quotes use a hard delete
-- gated by status (only `draft`, non-converted) — same constraint shape as
-- invoices.
--
-- Run command:
--   npm run db:migrate:one -- migrations/2026_04_26_quotes_permanent_delete.sql
--
-- Order:
--   1. Snapshot any existing soft-deleted rows into a one-shot archive table
--      so the migration is reversible if a soft-deleted quote turns out to
--      be referenced by a downstream report or audit pull.
--   2. Hard-delete the soft-deleted rows. quote_lines + quote_notes will
--      cascade-delete via their FK on quotes.id.
--   3. Drop the `is_active` and `deleted_at` columns. The application code
--      no longer references them after this migration ships.

BEGIN;

-- 1) Archive any soft-deleted quotes (one-shot table; safe to drop later
--    once reports confirm no consumer needs them).
CREATE TABLE IF NOT EXISTS _archive_quotes_isactive_false_2026_04_26 AS
  SELECT * FROM quotes WHERE is_active = false;

-- 2) Permanent delete of soft-deleted rows. Cascade-deletes quote_lines
--    and quote_notes via their FK on quote_id.
DELETE FROM quotes WHERE is_active = false;

-- 3) Drop the soft-delete columns. After this point, any code path still
--    referencing quotes.is_active or quotes.deleted_at will fail to load.
ALTER TABLE quotes DROP COLUMN IF EXISTS is_active;
ALTER TABLE quotes DROP COLUMN IF EXISTS deleted_at;

COMMIT;
