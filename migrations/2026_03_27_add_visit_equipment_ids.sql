-- Migration: Add equipment_ids array to job_visits
-- Purpose: Track which location equipment is being worked on during a specific visit.
-- Follows the same pattern as assigned_technician_ids (varchar array on job_visits).
-- Run: npm run db:migrate:one -- migrations/2026_03_27_add_visit_equipment_ids.sql

ALTER TABLE job_visits
  ADD COLUMN IF NOT EXISTS equipment_ids VARCHAR(36)[] DEFAULT '{}';

COMMENT ON COLUMN job_visits.equipment_ids IS 'Array of location_equipment IDs selected for this visit';
