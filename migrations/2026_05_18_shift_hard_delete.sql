-- =====================================================================
-- Migration: 2026-05-18 — shift hard-delete cleanup
-- =====================================================================
-- Removes archived_at columns from technician_shift_templates and
-- technician_shifts and rebuilds partial indexes that referenced it.
--
-- Background: the initial Phase 1 migration used soft-delete (archived_at).
-- The app uses hard delete everywhere. This migration aligns shift tables
-- with the app's canonical deletion model.
--
-- Steps:
--   1. Drop partial indexes that include archived_at IS NULL in WHERE.
--   2. Drop archived_at columns from both tables.
--   3. Recreate the indexes without the archived_at predicate.
--   4. Recreate the UNIQUE exception index without archived_at predicate.
--
-- Run with
-- --------
--   npm run db:migrate:one -- migrations/2026_05_18_shift_hard_delete.sql
-- =====================================================================

-- 1. Drop indexes that include archived_at in their WHERE clause.
DROP INDEX IF EXISTS idx_shift_templates_company;
DROP INDEX IF EXISTS idx_tech_shifts_range;
DROP INDEX IF EXISTS idx_tech_shifts_exceptions;
DROP INDEX IF EXISTS idx_tech_shifts_oncall;
DROP INDEX IF EXISTS idx_tech_shifts_unavailable;
DROP INDEX IF EXISTS idx_tech_shifts_exception_unique;

-- 2. Drop archived_at columns.
ALTER TABLE technician_shift_templates DROP COLUMN IF EXISTS archived_at;
ALTER TABLE technician_shifts DROP COLUMN IF EXISTS archived_at;

-- 3. Recreate indexes without archived_at predicates.

CREATE INDEX IF NOT EXISTS idx_shift_templates_company
  ON technician_shift_templates(company_id);

CREATE INDEX IF NOT EXISTS idx_tech_shifts_range
  ON technician_shifts(company_id, technician_user_id, starts_at, ends_at)
  WHERE recurrence_parent_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_tech_shifts_exceptions
  ON technician_shifts(recurrence_parent_id, occurrence_date)
  WHERE recurrence_parent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tech_shifts_oncall
  ON technician_shifts(company_id, starts_at, ends_at)
  WHERE shift_type = 'on_call'
    AND recurrence_parent_id IS NULL
    AND is_cancelled = FALSE;

CREATE INDEX IF NOT EXISTS idx_tech_shifts_unavailable
  ON technician_shifts(company_id, technician_user_id, starts_at, ends_at)
  WHERE shift_type = 'unavailable'
    AND is_cancelled = FALSE;

-- 4. Unique constraint: one exception per (base shift, occurrence date).
CREATE UNIQUE INDEX IF NOT EXISTS idx_tech_shifts_exception_unique
  ON technician_shifts(recurrence_parent_id, occurrence_date)
  WHERE recurrence_parent_id IS NOT NULL;
