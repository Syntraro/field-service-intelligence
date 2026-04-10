-- 2026_04_10_job_visits_previous_status.sql
-- Adds job_visits.previous_status to support the Cancel Start "restore to
-- correct prior state" patch (2026-04-10).
--
-- Run instructions:
--   npm run db:migrate:one -- migrations/2026_04_10_job_visits_previous_status.sql
--
-- Background:
--   The first cut of cancelVisitStart always restored visits from
--   in_progress / on_site → en_route. That is the wrong restore target when
--   the tech tapped Start Job directly from `scheduled` (skipping the route
--   step). The patch reads the actual prior state instead of guessing.
--
--   To know the actual prior state, jobLifecycleOrchestrator.startVisit now
--   captures `existing.status` into this column at transition time, and
--   cancelVisitStart restores from it. After a successful cancel the column
--   is cleared. After a successful complete the column is cleared.
--
-- Schema impact:
--   - Single nullable text column on job_visits.
--   - No data backfill required: existing visits leave the column NULL, and
--     cancelVisitStart falls back to "en_route" when previous_status is NULL
--     (matches the pre-patch behavior, so existing in-flight visits do not
--     break).
--
-- Rollback: ALTER TABLE job_visits DROP COLUMN previous_status;

BEGIN;

ALTER TABLE job_visits
  ADD COLUMN IF NOT EXISTS previous_status text;

COMMIT;
