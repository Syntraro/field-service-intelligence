-- Migration: drop job_visits.assigned_technician_id (scalar lead tech column)
--
-- Rationale:
--   Final cleanup of the "lead technician" concept. Canonical crew ownership
--   lives entirely in job_visits.assigned_technician_ids (varchar[]). The
--   scalar column has been removed from all code paths.
--
-- Run with:
--   npm run db:migrate:one -- migrations/2026_04_12_drop_job_visits_assigned_technician_id.sql

BEGIN;

-- Drop dependent indexes first.
DROP INDEX IF EXISTS idx_job_visits_technician;
DROP INDEX IF EXISTS idx_job_visits_assigned_technician_id;

ALTER TABLE job_visits
  DROP COLUMN IF EXISTS assigned_technician_id;

COMMIT;
