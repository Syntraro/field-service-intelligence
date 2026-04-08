-- Migration: Create lead_notes table for internal lead notes
-- Run: npm run db:migrate:one -- migrations/2026_04_07_lead_notes.sql

CREATE TABLE IF NOT EXISTS lead_notes (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  lead_id VARCHAR NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_text TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS lead_notes_lead_idx ON lead_notes(lead_id, company_id);
