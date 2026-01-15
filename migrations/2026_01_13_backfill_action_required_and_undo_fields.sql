-- Migration: Backfill action_required and undo close fields
-- This must run BEFORE adding CHECK constraints to prevent constraint violations
-- Date: 2026-01-13

-- Part A: Backfill action_required jobs missing required fields
-- For any job with status 'action_required' that has NULL action_required_reason
UPDATE jobs
SET
  action_required_reason = 'other',
  action_required_notes = COALESCE(action_required_notes, '') || E'\n(backfilled - reason was missing)',
  action_required_at = COALESCE(action_required_at, created_at, CURRENT_TIMESTAMP)
WHERE status = 'action_required'
  AND action_required_reason IS NULL;

-- Part B: Backfill undo close fields
-- For any job with closed_at but missing previous_status
UPDATE jobs
SET
  previous_status = COALESCE(previous_status, 'completed'),
  closed_by = COALESCE(closed_by, 'system-backfill')
WHERE closed_at IS NOT NULL
  AND previous_status IS NULL;

-- Verify counts (informational - will show in migration output)
DO $$
DECLARE
  action_required_missing INTEGER;
  undo_missing INTEGER;
BEGIN
  SELECT COUNT(*) INTO action_required_missing
  FROM jobs
  WHERE status = 'action_required' AND action_required_reason IS NULL;

  SELECT COUNT(*) INTO undo_missing
  FROM jobs
  WHERE closed_at IS NOT NULL AND previous_status IS NULL;

  RAISE NOTICE 'Remaining action_required jobs without reason: %', action_required_missing;
  RAISE NOTICE 'Remaining jobs with closed_at but no previous_status: %', undo_missing;
END $$;
