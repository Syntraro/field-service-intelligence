-- Run: npm run db:migrate:one -- migrations/2026_05_18_job_parts_service_template.sql
--
-- RALPH Service Templates Phase 4: Job Integration
-- Adds service_template_id attribution column to job_parts so flat-rate
-- service template applications can be traced back to their source template.
-- ON DELETE SET NULL: deleting or soft-deleting a template does not remove
-- the job parts that were generated from it.

ALTER TABLE job_parts
  ADD COLUMN IF NOT EXISTS service_template_id varchar
    REFERENCES service_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_job_parts_service_template
  ON job_parts(service_template_id)
  WHERE service_template_id IS NOT NULL;
