-- Migration: Normalize job status to 4-value lifecycle model
-- Date: 2026-01-26
--
-- This migration normalizes the job status column from 12+ values to exactly 4 lifecycle values:
-- - "open"      - Active job that can be worked on
-- - "completed" - Work finished (may need invoicing)
-- - "invoiced"  - Invoice created (locked for billing)
-- - "archived"  - Historical archive (includes canceled jobs)
--
-- Workflow states (in_progress, on_hold, etc.) are moved to a new open_sub_status column.
-- Assignment and scheduling are derived from fields (not stored in status).
--
-- EXECUTION: Run without transaction wrapping (standard mode)
-- psql "$DATABASE_URL" -f migrations/2026_01_26_normalize_job_status.sql

-- Step 1: Add open_sub_status column
-- =============================================================================
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS open_sub_status TEXT;

COMMENT ON COLUMN jobs.open_sub_status IS
  'Workflow sub-status when status=open: in_progress, on_hold, on_route, needs_review. NULL when status != open.';

-- Step 2: Populate open_sub_status from legacy status values
-- =============================================================================
-- Map "in_progress" status to open + open_sub_status='in_progress'
UPDATE jobs
SET open_sub_status = 'in_progress'
WHERE status = 'in_progress' AND open_sub_status IS NULL;

-- Map "on_hold" status to open + open_sub_status='on_hold'
UPDATE jobs
SET open_sub_status = 'on_hold'
WHERE status = 'on_hold' AND open_sub_status IS NULL;

-- Step 3: Normalize status values to 4 canonical values
-- =============================================================================

-- Map legacy values to "open"
-- These are now derived states (scheduled, assigned) or workflow sub-statuses
UPDATE jobs SET status = 'open'
WHERE status IN ('assigned', 'unscheduled', 'scheduled', 'in_progress', 'on_hold');

-- Map "requires_invoicing" to "completed"
UPDATE jobs SET status = 'completed'
WHERE status = 'requires_invoicing';

-- Map terminal states to "archived"
UPDATE jobs SET status = 'archived'
WHERE status IN ('closed', 'canceled', 'cancelled');

-- Step 4: Validate no invalid status values remain
-- =============================================================================
DO $$
DECLARE
  invalid_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_count
  FROM jobs
  WHERE status NOT IN ('open', 'completed', 'invoiced', 'archived');

  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'Migration validation failed: % jobs have invalid status values. Run SELECT DISTINCT status FROM jobs to investigate.', invalid_count;
  END IF;

  RAISE NOTICE 'Validation passed: All jobs have valid status values.';
END $$;

-- Step 5: Drop old CHECK constraint and create new ones
-- =============================================================================
-- Drop old constraint (may not exist in all environments)
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_hold_reason_check;

-- New constraint: openSubStatus = 'on_hold' requires holdReason
ALTER TABLE jobs ADD CONSTRAINT jobs_hold_reason_check
CHECK (open_sub_status <> 'on_hold' OR hold_reason IS NOT NULL);

-- New constraint: openSubStatus must be NULL when status != 'open'
ALTER TABLE jobs ADD CONSTRAINT jobs_open_sub_status_invariant_check
CHECK (status = 'open' OR open_sub_status IS NULL);

-- Step 6: Set default for status column to 'open' (was 'unscheduled')
-- =============================================================================
ALTER TABLE jobs ALTER COLUMN status SET DEFAULT 'open';

-- Step 7: Create index for open_sub_status queries
-- =============================================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS jobs_open_sub_status_idx
ON jobs (company_id, open_sub_status)
WHERE open_sub_status IS NOT NULL;

-- Step 8: Output summary
-- =============================================================================
DO $$
DECLARE
  open_count INTEGER;
  completed_count INTEGER;
  invoiced_count INTEGER;
  archived_count INTEGER;
  in_progress_count INTEGER;
  on_hold_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO open_count FROM jobs WHERE status = 'open';
  SELECT COUNT(*) INTO completed_count FROM jobs WHERE status = 'completed';
  SELECT COUNT(*) INTO invoiced_count FROM jobs WHERE status = 'invoiced';
  SELECT COUNT(*) INTO archived_count FROM jobs WHERE status = 'archived';
  SELECT COUNT(*) INTO in_progress_count FROM jobs WHERE open_sub_status = 'in_progress';
  SELECT COUNT(*) INTO on_hold_count FROM jobs WHERE open_sub_status = 'on_hold';

  RAISE NOTICE '';
  RAISE NOTICE '=== Job Status Migration Summary ===';
  RAISE NOTICE 'Status counts after migration:';
  RAISE NOTICE '  open:      %', open_count;
  RAISE NOTICE '  completed: %', completed_count;
  RAISE NOTICE '  invoiced:  %', invoiced_count;
  RAISE NOTICE '  archived:  %', archived_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Open sub-status counts:';
  RAISE NOTICE '  in_progress: %', in_progress_count;
  RAISE NOTICE '  on_hold:     %', on_hold_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Migration completed successfully.';
END $$;
