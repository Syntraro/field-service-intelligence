-- 2026-03-18: Migrate legacy needs_review rows to canonical on_hold
--
-- Context: needs_review is a dead ghost substatus — no live code path produces it.
-- It was the normalized replacement for the old 'action_required' status.
-- All live operational queries now use on_hold only.
-- Legacy rows with needs_review are excluded from operational queues until migrated.
--
-- Prerequisites: 2026_03_18_backfill_canonical_hold_fields.sql must have run first
-- (backfills onHoldAt, holdReason, holdNotes from deprecated actionRequired* columns).
--
-- Safety: Only targets rows WHERE status='open' (the openSubStatus invariant check
-- enforces openSubStatus=NULL for non-open jobs, so no terminal jobs can have needs_review).
-- The holdReasonCheck requires holdReason IS NOT NULL when openSubStatus='on_hold',
-- so we set holdReason='other' as fallback for any row missing it.

-- Step 1: Ensure holdReason is set for all needs_review rows (required by CHECK constraint)
UPDATE jobs
SET hold_reason = 'other'
WHERE open_sub_status = 'needs_review'
  AND status = 'open'
  AND hold_reason IS NULL;

-- Step 2: Ensure onHoldAt is set (needed for aging display)
UPDATE jobs
SET on_hold_at = COALESCE(on_hold_at, updated_at)
WHERE open_sub_status = 'needs_review'
  AND status = 'open'
  AND on_hold_at IS NULL;

-- Step 3: Migrate open_sub_status from needs_review to on_hold
UPDATE jobs
SET open_sub_status = 'on_hold',
    updated_at = NOW()
WHERE open_sub_status = 'needs_review'
  AND status = 'open';

-- Verification query (run manually after migration):
-- SELECT count(*) FROM jobs WHERE open_sub_status = 'needs_review';
-- Expected: 0
