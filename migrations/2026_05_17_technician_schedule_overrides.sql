-- =====================================================================
-- Migration: 2026-05-17 — technician_schedule_overrides
-- =====================================================================
-- Date-specific Working / Not Working overrides for individual
-- technicians (Phase 2, Team Schedule). A manager can mark a
-- specific calendar date as working or not-working, independent of
-- the technician's standard weekly schedule (working_hours).
--
-- Effective schedule precedence (highest → lowest):
--   1. Approved time off (technician_time_off)     → always not-working
--   2. Date override (this table)                  → is_working value
--   3. Weekly default (working_hours.is_working)   → day-of-week setting
--   4. Company default (business_hours)            → fallback
--
-- Why DATE not TIMESTAMPTZ
-- ------------------------
-- Overrides are calendar-day semantic ("this tech works / doesn't
-- work on May 20"). DATE avoids timezone ambiguity that
-- TIMESTAMPTZ introduces (a UTC midnight is the previous day in
-- timezones west of UTC). Comparison with other DATE columns (e.g.
-- in reports) is direct and unambiguous.
--
-- Uniqueness
-- ----------
-- Only one ACTIVE override is allowed per (company, tech, date).
-- Archived rows are exempt so the full history is preserved.
-- The partial unique index below enforces this at the DB level;
-- the storage layer's upsertOverride() enforces it at the
-- application level before any insert.
--
-- Schema
-- ------
--   id                   varchar PK (uuid)
--   company_id           FK companies(id) ON DELETE CASCADE — tenant.
--   technician_user_id   FK users(id) ON DELETE CASCADE — the tech.
--   override_date        date — the specific calendar date.
--   is_working           boolean — true = working, false = not working.
--   note                 text NULL — optional free-form explanation.
--   created_by_user_id   FK users(id) — audit trail.
--   created_at           timestamptz — insert time.
--   archived_at          timestamptz NULL — soft-delete marker.
--
-- Indexes
-- -------
--   idx_tech_schedule_overrides_tenant_tech_date
--     (company_id, technician_user_id, override_date) WHERE archived_at IS NULL
--     — primary lookup index for the effective-schedule computation.
--   idx_tech_schedule_overrides_unique_active
--     UNIQUE (company_id, technician_user_id, override_date)
--     WHERE archived_at IS NULL
--     — prevents duplicate active overrides for the same date.
--
-- Run with
-- --------
--   npm run db:migrate:one -- migrations/2026_05_17_technician_schedule_overrides.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS technician_schedule_overrides (
  id                  varchar       PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          varchar       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  technician_user_id  varchar       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  override_date       date          NOT NULL,
  is_working          boolean       NOT NULL,
  note                text,
  created_by_user_id  varchar       NOT NULL REFERENCES users(id),
  created_at          timestamptz   NOT NULL DEFAULT NOW(),
  archived_at         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_tech_schedule_overrides_tenant_tech_date
  ON technician_schedule_overrides(company_id, technician_user_id, override_date)
  WHERE archived_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tech_schedule_overrides_unique_active
  ON technician_schedule_overrides(company_id, technician_user_id, override_date)
  WHERE archived_at IS NULL;
