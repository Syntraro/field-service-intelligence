-- Migration: Backfill Live Map prerequisites (is_schedulable + scheduled_start)
-- Run: npm run db:migrate:one -- migrations/2026_03_05_live_map_backfills.sql
--
-- Root cause: Live Map /api/map/day returns 0 techs / 0 visits because:
--   1) users.is_schedulable is false/null for existing tech users
--   2) historical job_visits have scheduled_date set but scheduled_start is NULL
-- This migration repairs existing data. Safe to re-run (idempotent conditions).

BEGIN;

-- 1) Backfill is_schedulable for active, non-disabled users
UPDATE users
SET is_schedulable = TRUE
WHERE deleted_at IS NULL
  AND disabled = FALSE
  AND (is_schedulable IS NULL OR is_schedulable = FALSE);

-- 2) Backfill scheduled_start from scheduled_date where missing
UPDATE job_visits
SET scheduled_start = scheduled_date
WHERE is_active = TRUE
  AND scheduled_start IS NULL
  AND scheduled_date IS NOT NULL;

-- 3) Default estimated_duration_minutes to 60 where null or 0
UPDATE job_visits
SET estimated_duration_minutes = 60
WHERE is_active = TRUE
  AND (estimated_duration_minutes IS NULL OR estimated_duration_minutes = 0);

-- 4) Compute scheduled_end where start exists but end is NULL
UPDATE job_visits
SET scheduled_end = scheduled_start + INTERVAL '60 minutes'
WHERE is_active = TRUE
  AND scheduled_start IS NOT NULL
  AND scheduled_end IS NULL
  AND (estimated_duration_minutes IS NULL OR estimated_duration_minutes = 0 OR estimated_duration_minutes = 60);

COMMIT;
