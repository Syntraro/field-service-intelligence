-- Phase 4B.1: Ephemeral live position table (one row per technician)
-- Run: psql "$DATABASE_URL" -f migrations/2026_03_05_technician_live_positions.sql
--
-- Replaces DISTINCT ON query over technician_positions history.
-- UPSERT on (company_id, technician_id) keeps exactly one row per tech.

CREATE TABLE IF NOT EXISTS technician_live_positions (
  id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  technician_id   VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lat             NUMERIC NOT NULL,
  lng             NUMERIC NOT NULL,
  accuracy        NUMERIC,
  speed           NUMERIC,
  heading         NUMERIC,
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (company_id, technician_id)
);

-- Fast scan for "who's online" queries
CREATE INDEX IF NOT EXISTS tech_live_company_last_seen_idx
  ON technician_live_positions (company_id, last_seen_at);
