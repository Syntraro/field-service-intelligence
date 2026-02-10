-- Phase 1B: Location Tag Assignments
-- Links client_tags to client_locations (independent from client_tag_assignments)
--
-- Run: psql "$DATABASE_URL" -f migrations/2026_02_09_location_tag_assignments.sql

CREATE TABLE IF NOT EXISTS location_tag_assignments (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tag_id VARCHAR NOT NULL REFERENCES client_tags(id) ON DELETE CASCADE,
  location_id VARCHAR NOT NULL REFERENCES client_locations(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS location_tag_assignments_unique_idx
  ON location_tag_assignments(company_id, location_id, tag_id);

CREATE INDEX IF NOT EXISTS location_tag_assignments_location_idx
  ON location_tag_assignments(company_id, location_id);

CREATE INDEX IF NOT EXISTS location_tag_assignments_tag_idx
  ON location_tag_assignments(company_id, tag_id);
