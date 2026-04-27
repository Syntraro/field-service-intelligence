-- Default Scheduling Buffer (2026-04-26)
-- Tenant-level configuration: extends every newly created job/visit's
-- scheduled block by a fixed buffer while leaving the work duration
-- (durationMinutes / estimatedDurationMinutes) untouched. Buffer is
-- applied at the client's duration → scheduledEnd computation so that
-- conflict detection and find-next-available-slot honour the same
-- block size that gets persisted.
--
-- Range guard: 0..240 minutes. UI exposes 0/15/30/45/60/90/120; the
-- looser DB ceiling lets us add larger options later without another
-- migration. Default 0 keeps the feature off for existing tenants.
--
-- Run: npm run db:migrate:one -- migrations/2026_04_26_default_scheduling_buffer.sql

BEGIN;

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS default_scheduling_buffer_minutes INTEGER NOT NULL DEFAULT 0;

ALTER TABLE company_settings
  DROP CONSTRAINT IF EXISTS cs_default_scheduling_buffer_range;

ALTER TABLE company_settings
  ADD CONSTRAINT cs_default_scheduling_buffer_range
    CHECK (default_scheduling_buffer_minutes BETWEEN 0 AND 240);

COMMIT;
