-- Visit Attribution Extension
-- 2026-04-10: Add visitId to time_entries for visit-originated labor attribution.
--
-- Changes:
--   1. Add visit_id column with FK to job_visits.id (ON DELETE SET NULL)
--   2. Add index for company_id + visit_id
--   3. Extend type isolation: task_work MUST NOT have visit_id
--
-- Run: npm run db:migrate:one -- migrations/2026_04_10_visit_attribution.sql

-- Step 1: Add visit_id column
ALTER TABLE time_entries
  ADD COLUMN visit_id VARCHAR REFERENCES job_visits(id) ON DELETE SET NULL;

-- Step 2: Add index
CREATE INDEX time_entries_visit_idx ON time_entries(company_id, visit_id);

-- Step 3: Replace type isolation constraint with extended version.
-- Old: task_work↔task_id bidirectional only.
-- New: task_work↔task_id bidirectional + task_work MUST NOT have visit_id.
ALTER TABLE time_entries
  DROP CONSTRAINT IF EXISTS time_entries_type_task_isolation;

ALTER TABLE time_entries
  ADD CONSTRAINT time_entries_type_attribution_isolation
  CHECK (
    (type = 'task_work' AND task_id IS NOT NULL AND visit_id IS NULL)
    OR
    (type != 'task_work' AND task_id IS NULL)
  );
