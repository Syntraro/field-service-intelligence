-- Migration: Add structured visit outcome columns to job_visits
-- Phase 1 of dispatch-calendar architecture refactor
-- Date: 2026-03-06
--
-- Adds structured columns for visit completion outcomes that were previously
-- stored as text tags in visit_notes (e.g., "[OUTCOME: needs_parts] description").
-- Legacy note behavior is preserved — these columns become the authoritative source.
--
-- Run: npm run db:migrate:one -- migrations/2026_03_06_visit_outcome_columns.sql

-- Add structured outcome columns
ALTER TABLE job_visits ADD COLUMN IF NOT EXISTS outcome text;
ALTER TABLE job_visits ADD COLUMN IF NOT EXISTS outcome_note text;
ALTER TABLE job_visits ADD COLUMN IF NOT EXISTS completed_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE job_visits ADD COLUMN IF NOT EXISTS completed_at timestamp;
ALTER TABLE job_visits ADD COLUMN IF NOT EXISTS is_follow_up_needed boolean NOT NULL DEFAULT false;

-- Index for querying visits needing follow-up (dispatch board / unscheduled panel)
CREATE INDEX IF NOT EXISTS idx_job_visits_follow_up
  ON job_visits (company_id, is_follow_up_needed)
  WHERE is_follow_up_needed = true AND is_active = true;

-- Index for querying visits by outcome (office attention items)
CREATE INDEX IF NOT EXISTS idx_job_visits_outcome
  ON job_visits (company_id, outcome)
  WHERE outcome IS NOT NULL;

-- Backfill existing [OUTCOME: ...] tags from visit_notes into structured columns
-- Pattern: [OUTCOME: completed], [OUTCOME: needs_parts], [OUTCOME: needs_followup]
UPDATE job_visits
SET outcome = 'completed',
    is_follow_up_needed = false
WHERE visit_notes LIKE '%[OUTCOME: completed]%'
  AND outcome IS NULL;

UPDATE job_visits
SET outcome = 'needs_parts',
    is_follow_up_needed = true
WHERE visit_notes LIKE '%[OUTCOME: needs_parts]%'
  AND outcome IS NULL;

UPDATE job_visits
SET outcome = 'needs_followup',
    is_follow_up_needed = true
WHERE visit_notes LIKE '%[OUTCOME: needs_followup]%'
  AND outcome IS NULL;

-- Extract outcome notes (text after the [OUTCOME: ...] tag, before the next [ or newline)
-- This is best-effort; complex notes may need manual review
UPDATE job_visits
SET outcome_note = TRIM(SUBSTRING(
  visit_notes FROM '\[OUTCOME: [a-z_]+\]\s*([^\n\[]+)'
))
WHERE outcome IS NOT NULL
  AND outcome_note IS NULL
  AND visit_notes ~ '\[OUTCOME: [a-z_]+\]\s*[^\n\[]';

-- Extract completed_by_user_id from [COMPLETED_BY: uuid] tag
UPDATE job_visits
SET completed_by_user_id = TRIM(SUBSTRING(
  visit_notes FROM '\[COMPLETED_BY: ([0-9a-f\-]{36})\]'
))
WHERE outcome IS NOT NULL
  AND completed_by_user_id IS NULL
  AND visit_notes ~ '\[COMPLETED_BY: [0-9a-f\-]{36}\]';

-- Set completed_at from checked_out_at for visits that have an outcome but no completed_at
UPDATE job_visits
SET completed_at = checked_out_at
WHERE outcome IS NOT NULL
  AND completed_at IS NULL
  AND checked_out_at IS NOT NULL;
