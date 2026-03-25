-- 2026-03-18: Harden job_visits completion invariants
-- Ensures all completed visits have required outcome and timestamp fields.
-- Must run AFTER backfill (below) to avoid constraint violations on historical data.

-- Step 1: Backfill historical completed visits missing outcome fields
-- Timestamp priority: checked_out_at (actual checkout) → updated_at (last modification)
-- created_at is NOT used — it is the visit creation time, not a terminal timestamp.
UPDATE job_visits
SET outcome = 'completed',
    is_follow_up_needed = false,
    completed_at = COALESCE(checked_out_at, updated_at)
WHERE status = 'completed'
  AND outcome IS NULL;

-- Step 2: Fix logical contradiction (outcome=completed but follow-up needed)
UPDATE job_visits
SET is_follow_up_needed = false
WHERE outcome = 'completed'
  AND is_follow_up_needed = true;

-- Step 3: Add CHECK constraints
ALTER TABLE job_visits
  ADD CONSTRAINT job_visits_completion_outcome_check
    CHECK (status != 'completed' OR outcome IS NOT NULL);

ALTER TABLE job_visits
  ADD CONSTRAINT job_visits_completion_timestamp_check
    CHECK (status != 'completed' OR completed_at IS NOT NULL);

ALTER TABLE job_visits
  ADD CONSTRAINT job_visits_followup_consistency_check
    CHECK (NOT (outcome = 'completed' AND is_follow_up_needed = true));

ALTER TABLE job_visits
  ADD CONSTRAINT job_visits_scheduled_end_requires_start_check
    CHECK (scheduled_end IS NULL OR scheduled_start IS NOT NULL);
