-- Migration: Convert legacy job statuses (needs_parts, on_hold) to action_required
-- Date: 2026-01-13
--
-- This migration converts legacy hold statuses to the unified 'action_required' status
-- with appropriate reasons, so we can phase out legacy status support over time.

-- Track counts before migration
DO $$
DECLARE
  needs_parts_count INTEGER;
  on_hold_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO needs_parts_count FROM jobs WHERE status = 'needs_parts';
  SELECT COUNT(*) INTO on_hold_count FROM jobs WHERE status = 'on_hold';
  RAISE NOTICE 'Jobs with needs_parts status: %', needs_parts_count;
  RAISE NOTICE 'Jobs with on_hold status: %', on_hold_count;
END $$;

-- Part A: Migrate needs_parts -> action_required
-- Reason: 'needs_parts' (maps directly to the legacy status)
UPDATE jobs
SET
  status = 'action_required',
  action_required_reason = COALESCE(action_required_reason, 'needs_parts'),
  action_required_at = COALESCE(action_required_at, created_at, CURRENT_TIMESTAMP),
  action_required_notes = CASE
    WHEN action_required_notes IS NULL OR action_required_notes = ''
    THEN '(migrated from legacy needs_parts status)'
    ELSE action_required_notes || E'\n(migrated from legacy needs_parts status)'
  END,
  updated_at = CURRENT_TIMESTAMP
WHERE status = 'needs_parts';

-- Part B: Migrate on_hold -> action_required
-- Reason: 'other' (generic hold, no specific reason in legacy)
UPDATE jobs
SET
  status = 'action_required',
  action_required_reason = COALESCE(action_required_reason, 'other'),
  action_required_at = COALESCE(action_required_at, created_at, CURRENT_TIMESTAMP),
  action_required_notes = CASE
    WHEN action_required_notes IS NULL OR action_required_notes = ''
    THEN '(migrated from legacy on_hold status)'
    ELSE action_required_notes || E'\n(migrated from legacy on_hold status)'
  END,
  updated_at = CURRENT_TIMESTAMP
WHERE status = 'on_hold';

-- Part C: Insert audit trail events for migrated jobs
-- This ensures the timeline shows the migration occurred
INSERT INTO job_status_events (id, company_id, job_id, changed_by, from_status, to_status, note, meta, changed_at)
SELECT
  gen_random_uuid(),
  company_id,
  id,
  NULL, -- system migration, no user
  'needs_parts',
  'action_required',
  'System migration from legacy status',
  '{"migration": true, "legacyStatus": "needs_parts"}'::jsonb,
  CURRENT_TIMESTAMP
FROM jobs
WHERE action_required_notes LIKE '%migrated from legacy needs_parts%';

INSERT INTO job_status_events (id, company_id, job_id, changed_by, from_status, to_status, note, meta, changed_at)
SELECT
  gen_random_uuid(),
  company_id,
  id,
  NULL, -- system migration, no user
  'on_hold',
  'action_required',
  'System migration from legacy status',
  '{"migration": true, "legacyStatus": "on_hold"}'::jsonb,
  CURRENT_TIMESTAMP
FROM jobs
WHERE action_required_notes LIKE '%migrated from legacy on_hold%';

-- Verify no legacy statuses remain
DO $$
DECLARE
  remaining_legacy INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining_legacy
  FROM jobs
  WHERE status IN ('needs_parts', 'on_hold');

  IF remaining_legacy > 0 THEN
    RAISE EXCEPTION 'Migration failed: % jobs still have legacy statuses', remaining_legacy;
  ELSE
    RAISE NOTICE 'Migration complete: No jobs remain with legacy statuses';
  END IF;
END $$;
