-- ============================================================================
-- Migration: 2026_05_02_quote_note_attachments
-- ============================================================================
--
-- Purpose
--   Add the `quote_note_attachments` join table so quote notes can carry
--   file attachments the same way job notes already do via
--   `job_note_attachments`. This is the backend prep for Audit #2 PR 3A.
--
-- Schema source
--   `shared/schema.ts::quoteNoteAttachments` (added in the same commit).
--
-- Run instructions
--   Local / dev:    npm run db:migrate:one -- migrations/2026_05_02_quote_note_attachments.sql
--   Full sweep:     npm run db:migrate
--
-- Reversibility
--   `DROP TABLE quote_note_attachments;` is safe — no other table
--   references it (this is a leaf join). No data is lost from `quote_notes`
--   or `files` because both are referenced via FK with `ON DELETE CASCADE`
--   to the parent direction only.
--
-- Idempotency
--   `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` guards
--   make a re-run a no-op.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "quote_note_attachments" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" varchar NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "note_id" varchar NOT NULL REFERENCES "quote_notes"("id") ON DELETE CASCADE,
  "file_id" varchar NOT NULL REFERENCES "files"("id") ON DELETE CASCADE,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" varchar REFERENCES "users"("id")
);

-- Lookup index for `listByNote(noteId, companyId)` — the canonical read path
-- exposed by `quoteNoteAttachmentRepository.listByNote`. Composite key
-- matches the `jobNoteAttachments` index pattern so the per-note read
-- behavior is identical across the two tables.
CREATE INDEX IF NOT EXISTS "idx_quote_note_attachments_note_company"
  ON "quote_note_attachments" ("note_id", "company_id");

-- Reverse-lookup index for "what notes does this file appear on" — same
-- shape as `jobNoteAttachments` for parity. Rarely used but cheap.
CREATE INDEX IF NOT EXISTS "idx_quote_note_attachments_file_company"
  ON "quote_note_attachments" ("file_id", "company_id");
