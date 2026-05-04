-- ============================================================================
-- Migration: 2026_05_04_platform_password_reset_tokens_repoint  (Phase 2-A, Step C)
-- ============================================================================
--
-- Purpose
--   Repoint `platform_password_reset_tokens.user_id` from the legacy
--   tenant `users(id)` to the new dedicated `platform_users(id)`.
--
--   The 2026-05-03 migration added the table with `user_id REFERENCES
--   users(id) ON DELETE CASCADE` because there was nowhere else for
--   the FK to point yet. With Phase 2-A's `platform_users` table
--   created and backfilled (see `2026_05_04_platform_users_create.sql`
--   + `*_platform_users_backfill.sql`), the FK target is now wrong:
--   tokens are notionally for platform identities, not tenant users.
--
-- Preconditions
--   • `2026_05_04_platform_users_create.sql` applied.
--   • `2026_05_04_platform_users_backfill.sql` applied (so every
--     existing token's `user_id` exists in `platform_users` —
--     ids are preserved byte-for-byte by the backfill).
--
-- Token-row preservation
--   Existing tokens are NOT invalidated — their `user_id` UUIDs were
--   the same before and after the backfill (the backfill INSERTs
--   preserved `id`). The constraint swap below just changes which
--   table the FK points at.
--
-- Reversibility
--   ALTER TABLE platform_password_reset_tokens
--     DROP CONSTRAINT platform_password_reset_tokens_user_id_fkey;
--   ALTER TABLE platform_password_reset_tokens
--     ADD CONSTRAINT platform_password_reset_tokens_user_id_fkey
--     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
--
--   (Restoration only valid as long as the legacy `users` rows still
--   exist — i.e. before Phase 5 cleanup runs.)
--
-- Idempotency
--   `IF EXISTS` on the DROP and a matching name on the ADD make this
--   safely re-runnable. Postgres lets us add a new constraint with
--   the same name only after the old one is dropped, so the order is
--   DROP-then-ADD inside one transaction.
-- ============================================================================

BEGIN;

-- 1) Drop the old FK targeting `users(id)`.
--
--    Constraint name was auto-generated when the table was created.
--    The standard convention Postgres uses is
--    `<table>_<column>_fkey`, but we don't know for certain what the
--    auto-generated name was on this database. The safest cross-env
--    approach is to look it up at runtime and drop by name.
DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT conname INTO fk_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'platform_password_reset_tokens'
    AND c.contype = 'f';
  -- There should be exactly one FK on this table (user_id → users).
  -- If there are zero, the constraint was already dropped — no-op.
  IF fk_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE platform_password_reset_tokens DROP CONSTRAINT %I',
      fk_name
    );
  END IF;
END $$;

-- 2) Add the new FK targeting `platform_users(id)`.
--    NOT VALID + VALIDATE keeps the constraint check non-blocking for
--    extant rows during the transaction; rows are validated at the end.
ALTER TABLE "platform_password_reset_tokens"
  ADD CONSTRAINT "platform_password_reset_tokens_user_id_fkey"
  FOREIGN KEY ("user_id")
  REFERENCES "platform_users"("id")
  ON DELETE CASCADE
  NOT VALID;

ALTER TABLE "platform_password_reset_tokens"
  VALIDATE CONSTRAINT "platform_password_reset_tokens_user_id_fkey";

COMMIT;
