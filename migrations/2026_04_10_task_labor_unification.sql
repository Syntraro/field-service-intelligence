-- Task Labor Unification Migration
-- 2026-04-10: Move task timing from tasks table to canonical time_entries.
--
-- Changes:
--   1. Add task_id column + index to time_entries
--   2. Add 'task_work' to valid time entry types (app-level enum, no DB constraint)
--   3. Add is_billable column to tasks
--   4. Drop legacy timing columns from tasks (checked_in_at, checked_out_at, actual_duration_minutes)
--
-- Run: npm run db:migrate:one -- migrations/2026_04_10_task_labor_unification.sql
-- Prerequisites: Database has been wiped (no legacy data to migrate)

-- Step 1: Add task_id to time_entries
ALTER TABLE time_entries
  ADD COLUMN task_id VARCHAR REFERENCES tasks(id) ON DELETE SET NULL;

CREATE INDEX time_entries_task_idx ON time_entries(company_id, task_id);

-- Step 2: Add is_billable to tasks (default false — server applies jobId-based default on create)
ALTER TABLE tasks
  ADD COLUMN is_billable BOOLEAN NOT NULL DEFAULT false;

-- Step 3: Drop legacy timing columns from tasks
ALTER TABLE tasks
  DROP COLUMN IF EXISTS checked_in_at,
  DROP COLUMN IF EXISTS checked_out_at,
  DROP COLUMN IF EXISTS actual_duration_minutes;
