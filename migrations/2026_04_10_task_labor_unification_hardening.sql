-- Task Labor Hardening — Attribution Integrity Constraints
-- 2026-04-10: Prevent invalid attribution states on time_entries.
--
-- Rule: type='task_work' MUST have a non-null task_id.
-- This prevents orphaned task_work entries that cannot be traced back to a task.
--
-- Run: npm run db:migrate:one -- migrations/2026_04_10_task_labor_unification_hardening.sql
-- Renamed from task_labor_hardening → task_labor_unification_hardening to fix lexical sort order
-- (must run after 2026_04_10_task_labor_unification.sql which adds the task_id column)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_task_work_requires_task_id') THEN
    ALTER TABLE time_entries ADD CONSTRAINT time_entries_task_work_requires_task_id
      CHECK (type != 'task_work' OR task_id IS NOT NULL);
  END IF;
END $$;
