-- Migration: Phase 2 — per-entity file join tables.
--
-- Rationale:
--   Phase 2 extends the canonical R2 file pipeline to three new entity
--   types. Each needs a thin join to the shared `files` table. The
--   client_note join already exists (`note_attachments`) and is reused
--   as-is — we do NOT add a redundant `client_note_files` table.
--
--   No changes to the `files` table itself. Category values are
--   open-ended varchar so no enum migration is required when new
--   entity types appear.
--
-- Run with:
--   npm run db:migrate:one -- migrations/2026_04_12_files_phase2_joins.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- client_files — documents attached directly to a client location.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_files (
  id           varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   varchar NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id    varchar NOT NULL REFERENCES client_locations(id) ON DELETE CASCADE,
  file_id      varchar NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  created_at   timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by   varchar REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_client_files_company  ON client_files (company_id);
CREATE INDEX IF NOT EXISTS idx_client_files_client   ON client_files (client_id);
CREATE INDEX IF NOT EXISTS idx_client_files_file     ON client_files (file_id);

-- ---------------------------------------------------------------------------
-- contract_files — contracts are recurring_job_templates in this codebase.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contract_files (
  id           varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   varchar NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contract_id  varchar NOT NULL REFERENCES recurring_job_templates(id) ON DELETE CASCADE,
  file_id      varchar NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  created_at   timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by   varchar REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_contract_files_company  ON contract_files (company_id);
CREATE INDEX IF NOT EXISTS idx_contract_files_contract ON contract_files (contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_files_file     ON contract_files (file_id);

-- ---------------------------------------------------------------------------
-- technician_files — technicians are users with role='technician'. The
-- role is enforced at the service boundary, not via a CHECK constraint,
-- so role changes don't break historical rows.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS technician_files (
  id             varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     varchar NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  technician_id  varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id        varchar NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  created_at     timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by     varchar REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_technician_files_company   ON technician_files (company_id);
CREATE INDEX IF NOT EXISTS idx_technician_files_tech      ON technician_files (technician_id);
CREATE INDEX IF NOT EXISTS idx_technician_files_file      ON technician_files (file_id);

COMMIT;
