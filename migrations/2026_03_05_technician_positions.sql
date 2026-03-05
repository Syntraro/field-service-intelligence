-- Phase 4B: Technician GPS telemetry positions table
-- Run: psql "$DATABASE_URL" -f migrations/2026_03_05_technician_positions.sql
--
-- Stores GPS pings from technician mobile devices.
-- Latest position per technician queried via DISTINCT ON pattern.

CREATE TABLE IF NOT EXISTS technician_positions (
  id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  technician_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lat         NUMERIC NOT NULL,
  lng         NUMERIC NOT NULL,
  accuracy    NUMERIC,
  speed       NUMERIC,
  heading     NUMERIC,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Fast lookup: all positions for a technician within a company
CREATE INDEX IF NOT EXISTS tech_positions_company_tech_idx
  ON technician_positions (company_id, technician_id);

-- Fast lookup: latest position per technician (DESC for DISTINCT ON)
CREATE INDEX IF NOT EXISTS tech_positions_tech_recorded_idx
  ON technician_positions (technician_id, recorded_at DESC);
