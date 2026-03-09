-- PM Phase 3: Add service window fields to recurring_job_templates
-- Run: npm run db:migrate:one -- migrations/2026_03_09_pm_service_windows.sql
--
-- Service windows define the acceptable date range around the ideal PM date.
-- serviceWindowDaysBefore: how many days before the ideal date is acceptable (default 7)
-- serviceWindowDaysAfter: how many days after the ideal date is acceptable (default 14)

ALTER TABLE recurring_job_templates
  ADD COLUMN IF NOT EXISTS service_window_days_before integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS service_window_days_after integer NOT NULL DEFAULT 14;

-- Add a comment for documentation
COMMENT ON COLUMN recurring_job_templates.service_window_days_before IS 'Days before ideal PM date that service is acceptable';
COMMENT ON COLUMN recurring_job_templates.service_window_days_after IS 'Days after ideal PM date that service is acceptable';
