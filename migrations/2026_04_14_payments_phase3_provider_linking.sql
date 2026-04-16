-- Payments Phase 3 (2026-04-14): provider-linked immutability + Stripe readiness.
--
-- Adds two future-facing columns so the payments ledger can distinguish
-- provider-owned rows (QBO today, Stripe next) from manual entries at
-- the DB level. All existing rows default to provider_source='manual';
-- the idempotent backfill below updates existing QBO-synced rows to
-- provider_source='qbo' for canonical consistency. Replay-safe.
--
-- Run: npm run db:migrate:one -- migrations/2026_04_14_payments_phase3_provider_linking.sql

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS provider_source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS provider_event_id TEXT;

-- Enum enforcement on provider_source.
DO $$
BEGIN
  ALTER TABLE payments
    ADD CONSTRAINT payments_provider_source_chk
    CHECK (provider_source IN ('manual', 'qbo', 'stripe'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Idempotent backfill: any existing row already synced to QBO gets
-- provider_source='qbo'. The WHERE clause makes this a no-op on replay.
UPDATE payments
  SET provider_source = 'qbo'
  WHERE qbo_payment_id IS NOT NULL AND provider_source = 'manual';

-- Future-facing webhook-replay guard. When Stripe (or any future
-- provider) delivers the same event twice, the partial UNIQUE below
-- rejects the duplicate insert at the DB. No-op for today's rows
-- because provider_event_id defaults to NULL.
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_event_id_uq
  ON payments (company_id, provider_source, provider_event_id)
  WHERE provider_event_id IS NOT NULL;
