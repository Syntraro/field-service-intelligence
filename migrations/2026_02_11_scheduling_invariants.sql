-- Migration: 2026_02_11_scheduling_invariants.sql
-- Purpose: Add explicit CHECK constraint enforcing that is_all_day=true
--          requires scheduled_start to be NOT NULL.
--
-- Invariant: A job cannot be marked "all day" without a scheduled date.
-- This was already indirectly enforced by the midnight check constraint,
-- but an explicit constraint is clearer and produces a better error message.
--
-- Existing constraint #2 (scheduled_end requires scheduled_start) already
-- exists as jobs_scheduled_end_requires_start_check — no action needed.
--
-- Pre-check: 0 violating rows confirmed before creation.
--
-- Run: psql "$DATABASE_URL" -f migrations/2026_02_11_scheduling_invariants.sql

-- Constraint 1: is_all_day=true requires scheduled_start IS NOT NULL
-- Equivalent to: scheduled_start IS NOT NULL OR is_all_day = false (or is_all_day IS NULL)
ALTER TABLE jobs
  ADD CONSTRAINT jobs_allday_requires_start_check
  CHECK (scheduled_start IS NOT NULL OR is_all_day IS DISTINCT FROM TRUE);
