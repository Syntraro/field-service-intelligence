-- Payments ledger foundation (2026-04-14 Phase 1).
--
-- Adds the two columns required to represent refund/reversal rows as
-- peer events of a payment, attached to the payment they offset. No
-- CHECK constraints yet — those arrive in Phase 2 alongside the refund
-- and reversal creation paths so legitimate existing rows cannot be
-- retroactively invalidated.
--
-- Existing rows need no backfill: payment_type defaults to 'payment',
-- parent_payment_id defaults to NULL. Replay-safe.
--
-- Run: npm run db:migrate:one -- migrations/2026_04_14_payments_ledger_foundation.sql

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'payment';

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS parent_payment_id VARCHAR
    REFERENCES payments(id) ON DELETE RESTRICT;

-- Lookup index for Phase 2 refund sum / children queries.
-- Partial so only rows that actually carry a parent id are indexed.
CREATE INDEX IF NOT EXISTS payments_parent_payment_id_idx
  ON payments (parent_payment_id)
  WHERE parent_payment_id IS NOT NULL;
