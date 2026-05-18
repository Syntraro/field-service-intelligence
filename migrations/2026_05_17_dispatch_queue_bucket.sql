-- Migration: Add dispatch_queue_bucket to job_visits
-- Run: npm run db:migrate:one -- migrations/2026_05_17_dispatch_queue_bucket.sql
--
-- Adds a nullable text column for dispatch staging organisation.
-- Allowed values: urgent | today | on_hold | less_urgent
-- NULL is treated as 'today' at the application layer (normalised in the
-- mapper, never stored as a fallback string).
-- This is NOT a visit lifecycle status — it is a dispatcher-only
-- organisational field and must never be exposed to technicians.

ALTER TABLE job_visits
  ADD COLUMN IF NOT EXISTS dispatch_queue_bucket text;
