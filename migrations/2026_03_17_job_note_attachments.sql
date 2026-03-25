-- Migration: Add job_note_attachments join table
-- Links job notes to uploaded files, mirroring note_attachments for client notes.
-- Run: npm run db:migrate:one -- migrations/2026_03_17_job_note_attachments.sql

CREATE TABLE IF NOT EXISTS job_note_attachments (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  note_id VARCHAR NOT NULL REFERENCES job_notes(id) ON DELETE CASCADE,
  file_id VARCHAR NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR REFERENCES users(id)
);

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_job_note_attachments_note_id ON job_note_attachments(note_id);
CREATE INDEX IF NOT EXISTS idx_job_note_attachments_company_id ON job_note_attachments(company_id);
