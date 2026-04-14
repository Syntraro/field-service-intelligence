-- 2026_04_14_invoices_show_job_description.sql
-- Adds the client-visibility toggle for the work-description block on
-- client-facing invoice surfaces (PDF + portal). Default true preserves
-- existing behavior for every existing invoice.
--
-- Run instructions:
--   npm run db:migrate:one -- migrations/2026_04_14_invoices_show_job_description.sql
--
-- Rollback:
--   BEGIN;
--     ALTER TABLE invoices DROP COLUMN IF EXISTS show_job_description;
--   COMMIT;

BEGIN;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS show_job_description boolean NOT NULL DEFAULT true;

COMMIT;
