-- Add dispatch_order to job_visits for Board view card positioning.
-- NULL = unset (falls back to scheduledStart ordering in the adapter).
-- No backfill — existing rows stay NULL.
-- Run: npm run db:migrate:one -- migrations/add_dispatch_order_to_job_visits.sql

ALTER TABLE job_visits
  ADD COLUMN IF NOT EXISTS dispatch_order integer;
