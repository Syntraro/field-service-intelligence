-- Add optional title / prefix column to contact_persons (2026-04-22)
--
-- Motivation: Jobber exports include a "Title" column for primary-contact
-- titles/prefixes (Mr./Ms./Dr./job title). The Client import previously
-- dropped this column because there was no storage for it. Adding a nullable
-- TEXT column is non-breaking — existing rows stay NULL, inserts without the
-- field work unchanged.
--
-- Run: npm run db:migrate:one -- migrations/2026_04_22_contact_title.sql

ALTER TABLE contact_persons
  ADD COLUMN IF NOT EXISTS title TEXT;
