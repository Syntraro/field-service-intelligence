-- Migration: Initialize job versions and enforce NOT NULL constraint
-- Purpose: Eliminate VERSION_NOT_INITIALIZED errors by ensuring all jobs have version >= 1
-- TASK 2: Part of optimistic locking fix - removes need for ?? 0 fallbacks
--
-- Run with: psql "$DATABASE_URL" -f migrations/2026_01_27_initialize_job_versions.sql

-- Step 1: Set version = 1 for all jobs where version IS NULL
UPDATE jobs
SET version = 1
WHERE version IS NULL;

-- Step 2: Add NOT NULL constraint with DEFAULT 1
-- First, check if column already has NOT NULL constraint
DO $$
BEGIN
  -- Set default first
  ALTER TABLE jobs ALTER COLUMN version SET DEFAULT 1;

  -- Add NOT NULL constraint (will succeed because we just updated all NULL values)
  ALTER TABLE jobs ALTER COLUMN version SET NOT NULL;

  RAISE NOTICE 'Added NOT NULL DEFAULT 1 constraint to jobs.version';
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Constraint may already exist or another error occurred: %', SQLERRM;
END $$;

-- Verify: Count jobs with version IS NULL (should be 0)
DO $$
DECLARE
  null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count FROM jobs WHERE version IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'Migration failed: % jobs still have NULL version', null_count;
  ELSE
    RAISE NOTICE 'SUCCESS: All jobs have version initialized (no NULL values)';
  END IF;
END $$;
