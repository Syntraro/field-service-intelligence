-- Migration: Add requires_invoicing job status and migrate legacy completed jobs
-- Date: 2026-01-12
--
-- CONTEXT:
-- The "completed" status was overloaded to mean both:
--   1. "Job closed, needs invoice" (via "Close invoice later" action)
--   2. Potentially "Job truly done" (though this was rarely used)
--
-- This migration:
--   1. Adds "requires_invoicing" as a new explicit status
--   2. Migrates ALL "completed" jobs to "requires_invoicing" since the UI
--      only ever set "completed" via "Close invoice later"
--   3. Keeps "completed" in the schema for backward compatibility
--
-- NOTE: This is a data migration. The schema already supports the new status
-- since job.status is a TEXT column (not an enum type in PostgreSQL).
--
-- ROLLBACK: UPDATE jobs SET status = 'completed' WHERE status = 'requires_invoicing';

-- Migrate all jobs with status "completed" to "requires_invoicing"
-- This is safe because:
--   - The UI only set "completed" via "Close invoice later" action
--   - The intent was always "needs invoicing"
--   - Jobs that are truly done (invoiced) already have status "invoiced"
UPDATE jobs
SET
  status = 'requires_invoicing',
  updated_at = CURRENT_TIMESTAMP
WHERE status = 'completed'
  AND deleted_at IS NULL;

-- Log the migration result
DO $$
DECLARE
  migrated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO migrated_count
  FROM jobs
  WHERE status = 'requires_invoicing';

  RAISE NOTICE 'Migrated % jobs from "completed" to "requires_invoicing"', migrated_count;
END $$;
