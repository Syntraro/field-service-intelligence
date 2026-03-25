-- 2026-03-18: Backfill canonical hold fields from deprecated actionRequired* columns
-- Only fills canonical fields where they are NULL and deprecated fields have data.
-- Does NOT overwrite existing canonical values.

-- Step 1: Backfill onHoldAt from actionRequiredAt
UPDATE jobs
SET on_hold_at = action_required_at
WHERE on_hold_at IS NULL
  AND action_required_at IS NOT NULL
  AND open_sub_status IN ('on_hold', 'needs_review');

-- Step 2: Backfill holdReason from actionRequiredReason
-- Map legacy reason strings to canonical holdReason enum values
UPDATE jobs
SET hold_reason = CASE
  WHEN action_required_reason ILIKE '%part%' THEN 'parts'
  WHEN action_required_reason ILIKE '%customer%' THEN 'customer'
  WHEN action_required_reason ILIKE '%access%' THEN 'access'
  WHEN action_required_reason ILIKE '%approv%' THEN 'approval'
  WHEN action_required_reason ILIKE '%weather%' THEN 'weather'
  ELSE 'other'
END
WHERE hold_reason IS NULL
  AND action_required_reason IS NOT NULL
  AND open_sub_status IN ('on_hold', 'needs_review');

-- Step 3: Backfill holdNotes from actionRequiredNotes
UPDATE jobs
SET hold_notes = action_required_notes
WHERE hold_notes IS NULL
  AND action_required_notes IS NOT NULL
  AND open_sub_status IN ('on_hold', 'needs_review');

-- Step 4: Report (for manual verification after running)
-- SELECT count(*) as remaining_deprecated_only
-- FROM jobs
-- WHERE action_required_at IS NOT NULL
--   AND on_hold_at IS NULL;
-- Expected: 0 rows (all migrated)
