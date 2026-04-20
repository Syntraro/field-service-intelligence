-- 2026-04-19 Fix portal_magic_tokens.contact_id FK target
--
-- BACKGROUND
-- ----------
-- `portal_magic_tokens` was introduced on 2026-02-15 with:
--     contact_id VARCHAR NOT NULL REFERENCES client_contacts(id) ON DELETE CASCADE
--
-- The 2026-03-28 contact-identity refactor replaced `client_contacts` with
-- two canonical tables (`contact_persons` + `contact_assignments`) and
-- renamed `client_contacts` -> `client_contacts_legacy`. It did NOT
-- re-point the portal token FK. The Drizzle schema in `shared/schema.ts`
-- was updated to declare `references(() => contactPersons.id)`, but that
-- declaration doesn't retroactively alter the live DB.
--
-- Result: the portal request-link handler writes a valid
-- contact_persons.id into contact_id, but the FK still points at
-- client_contacts_legacy so inserts fail with:
--   "insert or update on table \"portal_magic_tokens\" violates foreign
--    key constraint \"portal_magic_tokens_contact_id_fkey\""
--
-- THIS MIGRATION
-- --------------
-- 1. Drops the stale FK.
-- 2. Removes any orphaned rows (portal tokens are 15-minute, single-use
--    ephemeral artifacts; any in-flight link simply needs to be
--    re-requested by the customer).
-- 3. Re-adds the FK pointing at the canonical contact_persons table so
--    the live DB matches the Drizzle schema declaration.
--
-- Run with:
--   npm run db:migrate:one -- migrations/2026_04_19_fix_portal_magic_tokens_contact_fk.sql
--
-- Safe to run multiple times (IF EXISTS / IF NOT EXISTS throughout).

BEGIN;

-- 1. Drop the stale FK (pre-refactor target = client_contacts).
ALTER TABLE portal_magic_tokens
  DROP CONSTRAINT IF EXISTS portal_magic_tokens_contact_id_fkey;

-- 2. Purge any token rows that cannot satisfy the new constraint.
--    Tokens are ephemeral (15-minute TTL, single-use), so deletion is
--    harmless — users re-request a sign-in link on demand.
DELETE FROM portal_magic_tokens
 WHERE contact_id NOT IN (SELECT id FROM contact_persons);

-- 3. Re-add the FK with the correct canonical target.
ALTER TABLE portal_magic_tokens
  ADD CONSTRAINT portal_magic_tokens_contact_id_fkey
    FOREIGN KEY (contact_id)
    REFERENCES contact_persons (id)
    ON DELETE CASCADE;

COMMIT;
