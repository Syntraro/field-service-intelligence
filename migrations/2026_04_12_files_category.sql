-- Migration: add `category` column to `files` + backfill from mime_type.
--
-- Rationale:
--   Reliability pass for Phase 1. Category is a coarse-grained classifier
--   assigned by the server at upload-request time so we can filter
--   (gallery vs document) without re-parsing mime types in queries and
--   so future entity types (client_note, contract, invoice, quote) can
--   declare their own categories without requiring a new column.
--
--   Category is server-assigned; the client never sets it.
--
-- Run with:
--   npm run db:migrate:one -- migrations/2026_04_12_files_category.sql

BEGIN;

ALTER TABLE files
  ADD COLUMN IF NOT EXISTS category varchar NOT NULL DEFAULT 'other';

-- Backfill existing rows from their mime_type. Anything unknown stays 'other'.
UPDATE files
SET category = CASE
  WHEN mime_type IN ('image/jpeg', 'image/png', 'image/webp') THEN 'note_image'
  WHEN mime_type = 'application/pdf' THEN 'note_pdf'
  ELSE 'other'
END
WHERE category = 'other';

COMMIT;
