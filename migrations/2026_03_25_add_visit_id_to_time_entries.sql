-- Labor unification: Add visitId to time_entries for visit-level attribution
-- Run: npm run db:migrate:one -- migrations/2026_03_25_add_visit_id_to_time_entries.sql

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS visit_id VARCHAR REFERENCES job_visits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS time_entries_visit_idx ON time_entries(company_id, visit_id);
