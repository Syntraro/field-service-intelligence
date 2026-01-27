-- Migration: Rename estimated_duration_minutes to duration_minutes
-- Purpose: Canonicalize duration field - single source of truth for scheduled job duration
--
-- This is a column RENAME, not adding a new column.
-- The "estimated" prefix was misleading - this IS the scheduled duration.
--
-- Run with: psql "$DATABASE_URL" -f migrations/2026_01_27_rename_estimated_to_duration_minutes.sql

-- Rename the column
ALTER TABLE jobs
  RENAME COLUMN estimated_duration_minutes TO duration_minutes;

-- Add comment to clarify purpose
COMMENT ON COLUMN jobs.duration_minutes IS 'Scheduled job duration in minutes. Used to compute effectiveEnd when scheduledEnd is null.';

-- Verify
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'jobs' AND column_name IN ('duration_minutes', 'estimated_duration_minutes');
