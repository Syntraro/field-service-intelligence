-- Migration: Rename status_default to open_sub_status_default
-- Phase 2 Step 6: All generated jobs now have status='open'.
-- The template only controls the optional openSubStatus.
--
-- Run: psql "$DATABASE_URL" -f migrations/2026_01_27_rename_status_default_to_open_sub_status_default.sql

-- Step 1: Rename the column
ALTER TABLE recurring_job_templates
  RENAME COLUMN status_default TO open_sub_status_default;

-- Step 2: Convert "open" values to NULL (no sub-status means normal backlog)
-- "on_hold" remains as-is since it's a valid openSubStatus
UPDATE recurring_job_templates
  SET open_sub_status_default = NULL
  WHERE open_sub_status_default = 'open';

-- Step 3: Remove the NOT NULL constraint (sub-status is optional)
ALTER TABLE recurring_job_templates
  ALTER COLUMN open_sub_status_default DROP NOT NULL;

-- Step 4: Update the default value to NULL instead of 'open'
ALTER TABLE recurring_job_templates
  ALTER COLUMN open_sub_status_default SET DEFAULT NULL;

-- Verification
SELECT
  id,
  title,
  open_sub_status_default,
  hold_reason
FROM recurring_job_templates
LIMIT 10;
