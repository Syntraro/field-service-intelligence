-- =====================================================================
-- Migration: 2026-05-18 — technician_shifts
-- =====================================================================
-- Single canonical availability source for all technician scheduling.
-- Stores one-off shifts, recurring shift base rows, and exception
-- (edit/cancel) rows for specific recurring occurrences.
--
-- Depends on:
--   migrations/2026_05_18_shift_enums.sql           (shift_type, shift_subtype)
--   migrations/2026_05_18_technician_shift_templates.sql
--
-- Row semantics
-- -------------
--   One-off shift:   recurrence_rule IS NULL AND recurrence_parent_id IS NULL
--   Recurring base:  recurrence_rule IS NOT NULL AND recurrence_parent_id IS NULL
--   Exception row:   recurrence_parent_id IS NOT NULL (edit or cancel of one occurrence)
--
-- Exception rows are child rows of a recurring base. When the engine
-- expands a base shift's RRULE, it checks for exception rows matching
-- (recurrence_parent_id, occurrence_date):
--   • is_cancelled = TRUE  → occurrence is dropped from the expansion
--   • is_cancelled = FALSE → exception's starts_at/ends_at override the
--     expanded occurrence's computed UTC bounds
--
-- The self-referential FK (recurrence_parent_id → id) has ON DELETE CASCADE
-- so archiving or hard-deleting a base row removes its exceptions automatically.
--
-- Constraints
-- -----------
--   tech_shifts_ends_after_starts
--     — ends_at must be strictly after starts_at. Applied to both
--       one-off and exception rows; base rows for open-ended recurring
--       shifts still need a valid anchor range.
--   tech_shifts_subtype_invariant
--     — 'unavailable' shifts must have shift_subtype; others must be NULL.
--   tech_shifts_exception_fields
--     — recurrence_parent_id and occurrence_date must both be NULL or
--       both be non-NULL (exception rows require both; base rows have neither).
--   tech_shifts_recurrence_not_on_exception
--     — recurrence_rule must be NULL when recurrence_parent_id is not NULL.
--       Exception rows inherit their recurrence context from the base.
--   tech_shifts_times_paired
--     — time_of_day_start and time_of_day_end must be paired.
--   tech_shifts_allday_no_times
--     — all_day = TRUE means time_of_day_start must be NULL (all-day
--       shifts don't have wall-clock times).
--
-- Indexes
-- -------
--   idx_tech_shifts_range
--     (company_id, technician_user_id, starts_at, ends_at)
--     WHERE recurrence_parent_id IS NULL AND archived_at IS NULL
--     — primary lookup for listBaseShiftsInWindow. Covers both one-off
--       and recurring base rows in a single index scan.
--   idx_tech_shifts_exceptions
--     (recurrence_parent_id, occurrence_date)
--     WHERE recurrence_parent_id IS NOT NULL AND archived_at IS NULL
--     — fast lookup for listExceptionsForBases given a set of base IDs.
--   idx_tech_shifts_oncall
--     (company_id, starts_at, ends_at)
--     WHERE shift_type='on_call' AND recurrence_parent_id IS NULL
--       AND is_cancelled=FALSE AND archived_at IS NULL
--     — resolveOnCallCoverage queries across all technicians.
--   idx_tech_shifts_unavailable
--     (company_id, technician_user_id, starts_at, ends_at)
--     WHERE shift_type='unavailable' AND is_cancelled=FALSE AND archived_at IS NULL
--     — resolveTimeOffBlocks fast path.
--   idx_tech_shifts_exception_unique  (UNIQUE)
--     (recurrence_parent_id, occurrence_date)
--     WHERE recurrence_parent_id IS NOT NULL AND archived_at IS NULL
--     — enforces one active exception per (base, date) pair.
--
-- Run with
-- --------
--   npm run db:migrate:one -- migrations/2026_05_18_technician_shifts.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS technician_shifts (
  id                     varchar       PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             varchar       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  technician_user_id     varchar       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id            varchar       REFERENCES technician_shift_templates(id),

  shift_type             shift_type    NOT NULL,
  shift_subtype          shift_subtype,
  label                  text,
  color                  text,

  starts_at              timestamptz   NOT NULL,
  ends_at                timestamptz   NOT NULL,
  all_day                boolean       NOT NULL DEFAULT FALSE,

  -- Wall-clock times for DST-safe recurrence expansion.
  -- NULL for all-day shifts and one-off shifts without time metadata.
  time_of_day_start      text,
  time_of_day_end        text,

  recurrence_rule        text,
  recurrence_end_date    date,

  -- Self-referential FK: exception rows reference the recurring base.
  -- ON DELETE CASCADE ensures exceptions are removed with the base.
  recurrence_parent_id   varchar       REFERENCES technician_shifts(id) ON DELETE CASCADE,
  occurrence_date        date,

  is_cancelled           boolean       NOT NULL DEFAULT FALSE,
  note                   text,

  created_by_user_id     varchar       REFERENCES users(id),
  created_at             timestamptz   NOT NULL DEFAULT NOW(),
  updated_at             timestamptz,
  archived_at            timestamptz,

  CONSTRAINT tech_shifts_ends_after_starts CHECK (
    ends_at > starts_at
  ),

  CONSTRAINT tech_shifts_subtype_invariant CHECK (
    (shift_type = 'unavailable' AND shift_subtype IS NOT NULL)
    OR
    (shift_type != 'unavailable' AND shift_subtype IS NULL)
  ),

  CONSTRAINT tech_shifts_exception_fields CHECK (
    (recurrence_parent_id IS NULL) = (occurrence_date IS NULL)
  ),

  CONSTRAINT tech_shifts_recurrence_not_on_exception CHECK (
    NOT (recurrence_parent_id IS NOT NULL AND recurrence_rule IS NOT NULL)
  ),

  CONSTRAINT tech_shifts_times_paired CHECK (
    (time_of_day_start IS NULL) = (time_of_day_end IS NULL)
  ),

  CONSTRAINT tech_shifts_allday_no_times CHECK (
    NOT (all_day = TRUE AND time_of_day_start IS NOT NULL)
  )
);

-- Primary range lookup: base shifts (one-off + recurring) in a time window.
CREATE INDEX IF NOT EXISTS idx_tech_shifts_range
  ON technician_shifts(company_id, technician_user_id, starts_at, ends_at)
  WHERE recurrence_parent_id IS NULL AND archived_at IS NULL;

-- Exception lookup by parent shift IDs and occurrence date.
CREATE INDEX IF NOT EXISTS idx_tech_shifts_exceptions
  ON technician_shifts(recurrence_parent_id, occurrence_date)
  WHERE recurrence_parent_id IS NOT NULL AND archived_at IS NULL;

-- On-call coverage queries (all technicians in window).
CREATE INDEX IF NOT EXISTS idx_tech_shifts_oncall
  ON technician_shifts(company_id, starts_at, ends_at)
  WHERE shift_type = 'on_call'
    AND recurrence_parent_id IS NULL
    AND is_cancelled = FALSE
    AND archived_at IS NULL;

-- Unavailable (time-off) fast path.
CREATE INDEX IF NOT EXISTS idx_tech_shifts_unavailable
  ON technician_shifts(company_id, technician_user_id, starts_at, ends_at)
  WHERE shift_type = 'unavailable'
    AND is_cancelled = FALSE
    AND archived_at IS NULL;

-- One active exception per (base shift, occurrence date).
CREATE UNIQUE INDEX IF NOT EXISTS idx_tech_shifts_exception_unique
  ON technician_shifts(recurrence_parent_id, occurrence_date)
  WHERE recurrence_parent_id IS NOT NULL AND archived_at IS NULL;
