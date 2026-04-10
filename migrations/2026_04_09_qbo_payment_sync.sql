-- 2026_04_09_qbo_payment_sync.sql
-- Adds outbound QuickBooks payment sync infrastructure (Phase 1: foundations).
--
-- Run instructions:
--   npm run db:migrate:one -- migrations/2026_04_09_qbo_payment_sync.sql
--
-- This migration is fully additive and contains no data backfill:
--   1. Adds 5 QBO sync fields to the payments table (nullable except qbo_sync_status,
--      which gets a NOT NULL default of 'NOT_SYNCED' matching the convention used
--      on customer_companies, items, and invoices).
--   2. Adds 1 boolean toggle (qbo_payment_sync_enabled) to the companies table,
--      defaulting to false. Existing companies retain the current behavior of
--      payments-stay-local. The toggle gates BOTH automatic post-write sync AND
--      manual retry — disabled means no payment sync at all.
--   3. Adds 1 nullable foreign-key column (payment_id) to qbo_sync_events so
--      outbound payment events have proper entity correlation. Existing inbound
--      payment events used invoice_id; this is the canonical column for new
--      outbound events.
--   4. Adds a partial unique index payments(company_id, qbo_payment_id) WHERE
--      qbo_payment_id IS NOT NULL for idempotency. This prevents two local
--      payment rows from being tied to the same QBO Payment id within a tenant.
--
-- TS enum extensions (qboSyncEventTypeEnum, qboQueueEntityTypeEnum) are NOT
-- DB-enforced — those columns are plain `text` with comment-only constraints.
-- The enum changes live in shared/schema.ts only; no DB migration needed.
--
-- No existing functionality is affected. Rollback drops the columns and index.

BEGIN;

-- 1. Add QBO sync fields to the payments table.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS qbo_payment_id text,
  ADD COLUMN IF NOT EXISTS qbo_sync_token text,
  ADD COLUMN IF NOT EXISTS qbo_sync_status text NOT NULL DEFAULT 'NOT_SYNCED',
  ADD COLUMN IF NOT EXISTS qbo_sync_error text,
  ADD COLUMN IF NOT EXISTS qbo_last_synced_at timestamp;

-- 2. Add the company-level payment sync toggle.
-- Default false so existing companies are not opted in automatically.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS qbo_payment_sync_enabled boolean NOT NULL DEFAULT false;

-- 3. Add payment_id reference column to qbo_sync_events for outbound payment audit.
-- ON DELETE SET NULL matches the existing pattern (customer_company_id, etc.).
ALTER TABLE qbo_sync_events
  ADD COLUMN IF NOT EXISTS payment_id varchar
  REFERENCES payments(id) ON DELETE SET NULL;

-- 4. Partial unique index for QBO payment idempotency.
-- A given company can have at most one local payment row tied to a given
-- QBO payment id. Only enforced for rows that already have a qbo_payment_id
-- (NULL rows are unconstrained, so existing local-only payments are unaffected).
CREATE UNIQUE INDEX IF NOT EXISTS payments_company_qbo_payment_id_unique
  ON payments (company_id, qbo_payment_id)
  WHERE qbo_payment_id IS NOT NULL;

COMMIT;
