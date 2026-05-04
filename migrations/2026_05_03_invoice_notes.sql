-- ============================================================================
-- Migration: 2026_05_03_invoice_notes
-- ============================================================================
--
-- Purpose
--   Promote invoice notes to a first-class per-entity surface, matching the
--   canonical pattern used by `job_notes`, `quote_notes`, `client_notes`,
--   and `lead_notes`. Before this migration:
--     - invoices had no notes table of their own
--     - GET /api/invoices/:id/notes borrowed entity-owned notes from the
--       linked job (when invoice.jobId was set), and fell through to the
--       flat `invoices.notes_internal` column for no-job invoices
--     - the no-job branch could not support attachments, edit history, or
--       per-note authorship
--
--   This migration adds two tables that mirror `job_note_attachments` /
--   `job_notes` shape exactly so the existing fileUploadService adapter
--   pattern, the R2 object-key layout, and the read-side attachment
--   hydration carry over with no special-casing.
--
-- Schema source
--   `shared/schema.ts::invoiceNotes` and `shared/schema.ts::invoiceNoteAttachments`
--   added in the same commit.
--
-- Run instructions
--   Local / dev:    npm run db:migrate:one -- migrations/2026_05_03_invoice_notes.sql
--   Full sweep:     npm run db:migrate
--
-- Reversibility
--   `DROP TABLE invoice_note_attachments; DROP TABLE invoice_notes;` is
--   safe — no other table references either (both are leaves). FK with
--   `ON DELETE CASCADE` to the parents (companies, invoices, users,
--   files) means deleting a parent never strands rows in these tables.
--
-- Idempotency
--   `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` guards
--   make a re-run a no-op.
--
-- Data migration
--   This migration does NOT backfill `invoices.notes_internal` values
--   into the new table. Reason: `notes_internal` doubles as the QBO
--   PrivateNote source + import-snapshot store, so its content is not
--   strictly user-authored "first user-facing note" data and may already
--   be empty for most rows. Operators who want to migrate legacy
--   per-invoice notes can do so post-deploy with a one-shot script —
--   keeping this migration purely additive avoids surprising
--   double-rendering of the same string in two surfaces.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) invoice_notes
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "invoice_notes" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" varchar NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "invoice_id" varchar NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "note_text" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Canonical per-invoice list query. Matches the `(invoice_id, company_id)`
-- read predicate that `invoiceNotesRepository.listInvoiceNotes` uses.
CREATE INDEX IF NOT EXISTS "idx_invoice_notes_invoice_company"
  ON "invoice_notes" ("invoice_id", "company_id");

-- Tenant-isolated lookup by user (e.g. "show all notes I authored").
CREATE INDEX IF NOT EXISTS "idx_invoice_notes_user_company"
  ON "invoice_notes" ("user_id", "company_id");

-- ----------------------------------------------------------------------------
-- 2) invoice_note_attachments  (mirrors `job_note_attachments`)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "invoice_note_attachments" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" varchar NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "note_id" varchar NOT NULL REFERENCES "invoice_notes"("id") ON DELETE CASCADE,
  "file_id" varchar NOT NULL REFERENCES "files"("id") ON DELETE CASCADE,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" varchar REFERENCES "users"("id")
);

-- Lookup index for `listByNote(noteId, companyId)` — mirror of
-- `idx_job_note_attachments_note_company`.
CREATE INDEX IF NOT EXISTS "idx_invoice_note_attachments_note_company"
  ON "invoice_note_attachments" ("note_id", "company_id");

-- Reverse-lookup index for "what notes does this file appear on" — same
-- shape + intent as the job/quote attachment indexes.
CREATE INDEX IF NOT EXISTS "idx_invoice_note_attachments_file_company"
  ON "invoice_note_attachments" ("file_id", "company_id");
