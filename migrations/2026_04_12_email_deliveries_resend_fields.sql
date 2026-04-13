-- 2026_04_12_email_deliveries_resend_fields.sql
-- Phase 15/17 — adds resend-lineage fields to email_deliveries so the UI
-- can surface a one-time "Resend" affordance on failed/bounced rows and
-- the backend can later enforce the one-retry policy (Phase 17).
--
-- Run:
--   npm run db:migrate:one -- migrations/2026_04_12_email_deliveries_resend_fields.sql
--
-- Rollback:
--   ALTER TABLE email_deliveries
--     DROP COLUMN IF EXISTS resend_count,
--     DROP COLUMN IF EXISTS retried_from_delivery_id;

BEGIN;

ALTER TABLE email_deliveries
  ADD COLUMN IF NOT EXISTS resend_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retried_from_delivery_id varchar
    REFERENCES email_deliveries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_email_deliveries_retried_from
  ON email_deliveries (retried_from_delivery_id);

COMMIT;
