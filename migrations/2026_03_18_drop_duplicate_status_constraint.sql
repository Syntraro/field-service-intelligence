-- 2026-03-18: Drop redundant duplicate CHECK constraint on jobs.status.
--
-- Two identical constraints exist:
--   jobs_status_check:           CHECK (status IN ('open','completed','invoiced','archived'))
--   jobs_status_lifecycle_check: CHECK (status IN ('open','completed','invoiced','archived'))
--
-- Keeping jobs_status_check (canonical name).
-- Dropping jobs_status_lifecycle_check (redundant duplicate from earlier migration).
--
-- Run: psql "$DATABASE_URL" -f migrations/2026_03_18_drop_duplicate_status_constraint.sql

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_lifecycle_check;
