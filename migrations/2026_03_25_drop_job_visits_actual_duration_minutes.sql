-- Labor unification: drop deprecated actualDurationMinutes from job_visits
-- This column is no longer written or read in the visit/labor domain.
-- Labor duration is now derived exclusively from the time_entries table.
-- NOTE: The tasks table has its own actualDurationMinutes column — this migration only affects job_visits.
-- Run: npm run db:migrate:one -- migrations/2026_03_25_drop_job_visits_actual_duration_minutes.sql

ALTER TABLE job_visits DROP COLUMN IF EXISTS actual_duration_minutes;
