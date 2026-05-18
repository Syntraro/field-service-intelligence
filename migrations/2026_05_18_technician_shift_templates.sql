-- =====================================================================
-- Migration: 2026-05-18 — technician_shift_templates
-- =====================================================================
-- Reusable shift template definitions for Technician Shift Management
-- Phase 1. Templates describe a named shift pattern (type, times,
-- recurrence rule, color) that can be referenced when creating actual
-- technician_shifts rows.
--
-- Depends on:
--   migrations/2026_05_18_shift_enums.sql  (shift_type, shift_subtype)
--
-- Key constraints:
--   shift_templates_subtype_invariant
--     — 'unavailable' shifts must have a subtype; all other types must
--       have subtype = NULL. Mirrors the same invariant on technician_shifts.
--   shift_templates_times_paired
--     — time_of_day_start and time_of_day_end must both be present or
--       both be NULL. A template with only one time side is invalid.
--
-- Soft-delete:
--   archived_at IS NULL marks live templates. Archived templates are
--   preserved for historical reference (existing shifts still reference
--   the template_id row).
--
-- Schema
-- ------
--   id                  varchar PK (uuid)
--   company_id          FK companies(id) ON DELETE CASCADE — tenant root
--   name                text NOT NULL — human label for the template
--   shift_type          shift_type NOT NULL — normal | on_call | unavailable
--   shift_subtype       shift_subtype NULL — required when type = unavailable
--   label               text NULL — short display override (e.g. "PTO")
--   color               text NULL — hex colour for calendar rendering
--   time_of_day_start   text NULL — wall-clock start "HH:MM"
--   time_of_day_end     text NULL — wall-clock end   "HH:MM"
--   recurrence_rule     text NULL — RRULE string (FREQ=WEEKLY;…)
--   is_active           boolean NOT NULL DEFAULT TRUE
--   created_by_user_id  varchar NULL FK users(id) — audit; nullable for system
--   created_at          timestamptz NOT NULL DEFAULT NOW()
--   updated_at          timestamptz NULL
--   archived_at         timestamptz NULL — soft-delete marker
--
-- Indexes
-- -------
--   idx_shift_templates_company
--     (company_id) WHERE archived_at IS NULL
--     — primary listing index for GET /api/shift-management
--
-- Run with
-- --------
--   npm run db:migrate:one -- migrations/2026_05_18_technician_shift_templates.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS technician_shift_templates (
  id                  varchar       PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          varchar       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                text          NOT NULL,
  shift_type          shift_type    NOT NULL,
  shift_subtype       shift_subtype,
  label               text,
  color               text,
  time_of_day_start   text,
  time_of_day_end     text,
  recurrence_rule     text,
  is_active           boolean       NOT NULL DEFAULT TRUE,
  created_by_user_id  varchar       REFERENCES users(id),
  created_at          timestamptz   NOT NULL DEFAULT NOW(),
  updated_at          timestamptz,
  archived_at         timestamptz,

  CONSTRAINT shift_templates_subtype_invariant CHECK (
    (shift_type = 'unavailable' AND shift_subtype IS NOT NULL)
    OR
    (shift_type != 'unavailable' AND shift_subtype IS NULL)
  ),

  CONSTRAINT shift_templates_times_paired CHECK (
    (time_of_day_start IS NULL) = (time_of_day_end IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_shift_templates_company
  ON technician_shift_templates(company_id)
  WHERE archived_at IS NULL;
