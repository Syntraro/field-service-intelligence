-- 2026_04_13_email_deliveries_cc.sql
-- Commit C: per-send CC list support on the shared send modal (invoice /
-- quote / job). CC is recorded alongside the existing `recipients_json`
-- so delivery history / resend tooling can reconstruct exactly who the
-- mail went to.
--
-- Run instructions:
--   npm run db:migrate:one -- migrations/2026_04_13_email_deliveries_cc.sql
--
-- Rollback:
--   BEGIN;
--     ALTER TABLE email_deliveries DROP COLUMN IF EXISTS cc_json;
--   COMMIT;

BEGIN;

ALTER TABLE email_deliveries
  ADD COLUMN IF NOT EXISTS cc_json jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
