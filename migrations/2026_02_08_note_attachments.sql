-- Migration: Add note attachments support and visibility flags
-- Run: psql "$DATABASE_URL" -f migrations/2026_02_08_note_attachments.sql
-- DO NOT use -1 or --single-transaction

-- 1) Make location_id nullable (allows company-wide notes where location_id IS NULL)
ALTER TABLE client_notes ALTER COLUMN location_id DROP NOT NULL;

-- 2) Add visibility flag columns
ALTER TABLE client_notes ADD COLUMN IF NOT EXISTS show_on_jobs boolean NOT NULL DEFAULT false;
ALTER TABLE client_notes ADD COLUMN IF NOT EXISTS show_on_invoices boolean NOT NULL DEFAULT false;
ALTER TABLE client_notes ADD COLUMN IF NOT EXISTS show_on_quotes boolean NOT NULL DEFAULT false;

-- 3) Files table — tenant-scoped file metadata
CREATE TABLE IF NOT EXISTS files (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id varchar NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  storage_key varchar NOT NULL,
  original_name varchar,
  mime_type varchar,
  size integer,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by varchar REFERENCES users(id)
);

-- 4) Note attachments — join table linking notes to files
CREATE TABLE IF NOT EXISTS note_attachments (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id varchar NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  note_id varchar NOT NULL REFERENCES client_notes(id) ON DELETE CASCADE,
  file_id varchar NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by varchar REFERENCES users(id)
);

-- 5) Indexes for common lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_files_company_id ON files(company_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_note_attachments_note_id ON note_attachments(note_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_note_attachments_file_id ON note_attachments(file_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_client_notes_location_id ON client_notes(location_id) WHERE location_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_client_notes_company_notes ON client_notes(company_id) WHERE location_id IS NULL;
