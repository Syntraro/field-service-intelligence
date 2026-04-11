-- Task Labor Hardening — Attribution Integrity Constraints
-- 2026-04-10: Prevent invalid attribution states on time_entries.
--
-- Rule: type='task_work' MUST have a non-null task_id.
-- This prevents orphaned task_work entries that cannot be traced back to a task.
--
-- Run: npm run db:migrate:one -- migrations/2026_04_10_task_labor_hardening.sql

ALTER TABLE time_entries
  ADD CONSTRAINT time_entries_task_work_requires_task_id
  CHECK (type != 'task_work' OR task_id IS NOT NULL);
