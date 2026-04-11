-- Type Isolation Constraint — Bidirectional type↔attribution enforcement
-- 2026-04-10: Replaces one-way constraint with full bidirectional rule.
--
-- Rule:
--   task_work MUST have task_id (no orphaned task entries)
--   non-task_work MUST NOT have task_id (no hybrid/corrupt entries)
--
-- This is a superset of the previous constraint — drop old, add new.
--
-- Run: npm run db:migrate:one -- migrations/2026_04_10_type_isolation_constraint.sql

-- Drop the one-way constraint from the hardening migration
ALTER TABLE time_entries
  DROP CONSTRAINT IF EXISTS time_entries_task_work_requires_task_id;

-- Add bidirectional constraint
ALTER TABLE time_entries
  ADD CONSTRAINT time_entries_type_task_isolation
  CHECK (
    (type = 'task_work' AND task_id IS NOT NULL)
    OR
    (type != 'task_work' AND task_id IS NULL)
  );
