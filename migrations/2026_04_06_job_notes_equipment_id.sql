-- Migration: Add optional equipmentId to job_notes
-- Purpose: Allow job notes to be associated with specific equipment serviced on a job.
--          Enables future equipment history reporting (notes per equipment unit).
-- Run: npm run db:migrate:one -- migrations/2026_04_06_job_notes_equipment_id.sql

ALTER TABLE job_notes
  ADD COLUMN IF NOT EXISTS equipment_id VARCHAR
    REFERENCES location_equipment(id) ON DELETE SET NULL;

-- Index for querying notes by equipment (future equipment history surface)
CREATE INDEX IF NOT EXISTS idx_job_notes_equipment_id
  ON job_notes(equipment_id)
  WHERE equipment_id IS NOT NULL;
