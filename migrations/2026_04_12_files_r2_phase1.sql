-- Migration: Phase 1 — extend `files` table for Cloudflare R2.
--
-- Rationale:
--   Moves binary storage off Render disk and onto Cloudflare R2. Existing
--   rows remain readable through the legacy disk path via
--   storage_provider='local'. New uploads use storage_provider='r2' and
--   follow the 3-step lifecycle (pending_upload → uploaded).
--
--   The existing attachment join tables (note_attachments,
--   job_note_attachments) are untouched. File metadata shape is compatible
--   with future reuse for client notes, technician docs, contracts,
--   invoices, and quotes without further migration.
--
-- Run with:
--   npm run db:migrate:one -- migrations/2026_04_12_files_r2_phase1.sql

BEGIN;

ALTER TABLE files
  ADD COLUMN IF NOT EXISTS storage_provider varchar NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS bucket          varchar,
  ADD COLUMN IF NOT EXISTS status          varchar NOT NULL DEFAULT 'uploaded',
  ADD COLUMN IF NOT EXISTS updated_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Indexes for the canonical lookup patterns: tenant-scoped reads and
-- status filtering (e.g. sweep of stale pending_upload rows).
CREATE INDEX IF NOT EXISTS idx_files_company_id ON files (company_id);
CREATE INDEX IF NOT EXISTS idx_files_status     ON files (status);
CREATE INDEX IF NOT EXISTS idx_files_company_status_created
  ON files (company_id, status, created_at DESC);

COMMIT;
