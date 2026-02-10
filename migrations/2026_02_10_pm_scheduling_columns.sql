-- PM Scheduling Extension: Add PM-specific columns to recurring_job_templates
-- Run: psql "$DATABASE_URL" -f migrations/2026_02_10_pm_scheduling_columns.sql
--
-- Safe additive migration — all columns are nullable or have defaults.
-- Existing rows get default values; no data loss.

ALTER TABLE recurring_job_templates
  ADD COLUMN IF NOT EXISTS months_of_year INTEGER[],
  ADD COLUMN IF NOT EXISTS generation_mode TEXT NOT NULL DEFAULT 'phase',
  ADD COLUMN IF NOT EXISTS generation_day_of_month INTEGER,
  ADD COLUMN IF NOT EXISTS auto_schedule BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scheduled_time_local TEXT,
  ADD COLUMN IF NOT EXISTS include_location_pm_parts BOOLEAN NOT NULL DEFAULT false;

-- Validate constraints (informational, not enforced at DB level — app validates)
COMMENT ON COLUMN recurring_job_templates.months_of_year IS 'Array of months 1..12; NULL = no month restriction';
COMMENT ON COLUMN recurring_job_templates.generation_mode IS 'phase (default) | period_start | day_of_month';
COMMENT ON COLUMN recurring_job_templates.generation_day_of_month IS '1..31, required when generation_mode = day_of_month';
COMMENT ON COLUMN recurring_job_templates.auto_schedule IS 'false = unscheduled PM jobs; true = auto-schedule at scheduled_time_local';
COMMENT ON COLUMN recurring_job_templates.scheduled_time_local IS 'HH:MM 24h format, required when auto_schedule = true';
COMMENT ON COLUMN recurring_job_templates.include_location_pm_parts IS 'Copy location PM part templates into job_parts on generation';
