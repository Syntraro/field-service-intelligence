-- Migration: Add estimated_duration_minutes column to jobs table
-- Purpose: Supports effectiveEnd calculation for overdue detection
-- Phase 2 Step 5: effectiveEnd = scheduledEnd || scheduledStart + estimatedDurationMinutes || scheduledStart
--
-- Run with: psql "$DATABASE_URL" -f migrations/2026_01_27_add_estimated_duration_minutes.sql

-- Add column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'jobs' AND column_name = 'estimated_duration_minutes'
  ) THEN
    ALTER TABLE jobs ADD COLUMN estimated_duration_minutes INTEGER;
    RAISE NOTICE 'Added estimated_duration_minutes column to jobs table';
  ELSE
    RAISE NOTICE 'Column estimated_duration_minutes already exists';
  END IF;
END $$;

-- Add helpful comment
COMMENT ON COLUMN jobs.estimated_duration_minutes IS 'Estimated job duration in minutes. Used to calculate effectiveEnd for overdue detection when scheduledEnd is not set.';
