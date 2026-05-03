-- ============================================================================
-- Migration: 2026_05_02_contact_persons_honorific_split
-- ============================================================================
--
-- Purpose
--   The canonical Add/Edit Contact modal (2026-05-02 layout refactor)
--   wants TWO separate fields where the schema today carries one:
--
--     • title     — short honorific (Mr. / Mrs. / Ms. / Miss / Dr. / null)
--     • jobTitle  — professional role (Operations Manager, Owner, etc.)
--
--   Pre-migration, `contact_persons.title` already exists and is in
--   practice populated with job-title-style strings (Jobber import maps
--   their `Title` column straight in — see
--   `shared/schema.ts:543-551` comment). Reading the existing data as
--   "honorific" would be wrong on the overwhelming majority of rows.
--
--   This migration splits the two by:
--     1. Adding a new nullable `job_title` column.
--     2. Copying the existing `title` value into `job_title` for every
--        row that has one (the values are job-title strings today).
--     3. Nulling out `title`, since the existing values are job-title
--        strings — none of them are valid honorifics in the new model.
--
--   After this migration `title` becomes the honorific (free-form
--   string from a UI dropdown of canonical values) and `job_title`
--   carries the freeform professional role.
--
-- Schema source
--   `shared/schema.ts::contactPersons` (`title` repurposed,
--   `jobTitle` added in the same commit).
--
-- Run instructions
--   Local / dev:    npm run db:migrate:one -- migrations/2026_05_02_contact_persons_honorific_split.sql
--   Full sweep:     npm run db:migrate
--
-- Reversibility
--   The honorific repurpose is non-destructive — original strings are
--   preserved verbatim in `job_title`. To roll back:
--     UPDATE contact_persons SET title = job_title WHERE title IS NULL AND job_title IS NOT NULL;
--     ALTER TABLE contact_persons DROP COLUMN job_title;
--   No FK or constraint depends on either column, so the drop is safe.
--
-- Idempotency
--   `ADD COLUMN IF NOT EXISTS` guards the column add. The data copy
--   uses `IS NULL` predicate so a re-run is a no-op once `job_title`
--   is populated. The title-nullification is gated on
--   `job_title IS NOT NULL` so the second run can't blank a row that
--   was already split.
-- ============================================================================

-- 1. Add the new column (nullable; no default; preserves all existing rows).
ALTER TABLE "contact_persons"
  ADD COLUMN IF NOT EXISTS "job_title" text;

-- 2. Move existing `title` strings into `job_title` (idempotent — only
--    runs for rows where `job_title` is still NULL, so a second sweep
--    after the column is populated is a no-op).
UPDATE "contact_persons"
SET "job_title" = "title"
WHERE "title" IS NOT NULL
  AND "title" <> ''
  AND "job_title" IS NULL;

-- 3. Null out `title` for rows whose data has been moved to `job_title`.
--    This is the repurpose step: post-migration, `title` is empty for
--    every existing contact, ready to be set to an honorific the next
--    time the user opens the modal. Idempotent via the
--    `job_title IS NOT NULL` guard — a second run won't overwrite a
--    row whose `title` was set to a real honorific in between.
UPDATE "contact_persons"
SET "title" = NULL
WHERE "title" IS NOT NULL
  AND "job_title" IS NOT NULL
  AND "title" = "job_title";
