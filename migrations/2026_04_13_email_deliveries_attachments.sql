-- 2026_04_13_email_deliveries_attachments.sql
-- Follow-up to Commit C: persist outbound attachment metadata on every
-- delivery row so history / debugging can see exactly what was sent
-- alongside subject + body. Metadata only — NEVER the file bytes.
--
-- Run instructions:
--   npm run db:migrate:one -- migrations/2026_04_13_email_deliveries_attachments.sql
--
-- Rollback:
--   BEGIN;
--     ALTER TABLE email_deliveries DROP COLUMN IF EXISTS attachments_json;
--   COMMIT;

BEGIN;

ALTER TABLE email_deliveries
  ADD COLUMN IF NOT EXISTS attachments_json jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
