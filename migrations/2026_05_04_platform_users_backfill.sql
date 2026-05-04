-- ============================================================================
-- Migration: 2026_05_04_platform_users_backfill  (Phase 2-A, Step B — data move)
-- ============================================================================
--
-- Purpose
--   Copy every existing platform-role row out of the tenant `users`
--   table into the new dedicated tables. Idempotent — `NOT EXISTS`
--   guards make re-runs a no-op. Legacy rows in `users` are NOT
--   deleted in this step; that's the destructive Step D
--   (`*_users_table_cleanup.sql`) which lands in a separate PR after
--   monitoring has confirmed the new code path is stable.
--
-- Preconditions
--   • `2026_05_04_platform_users_create.sql` has been applied.
--   • Legacy rows still exist in `users WHERE role IN
--     ('platform_admin','platform_support','platform_billing',
--      'platform_readonly_audit')`.
--
-- Postconditions / verification
--   The verification block at the bottom asserts:
--     count(platform_users)
--       == count(users WHERE role IN PLATFORM_ROLES AND deleted_at IS NULL)
--   If this fails the transaction aborts and rolls back so the partial
--   backfill is not persisted.
--
-- Reversibility
--   Truncate the three platform tables. The legacy `users` rows are
--   untouched.
--
-- Idempotency
--   Every INSERT is guarded by `NOT EXISTS` against the destination,
--   so re-runs leave existing rows alone and only insert any newly-
--   appearing platform users (e.g. ones created in `users` between
--   the first and second run of this migration during a staged
--   rollout).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) platform_users — preserve `id` (FK continuity for Step D + reset tokens)
-- ----------------------------------------------------------------------------
INSERT INTO "platform_users" (
  "id", "email", "full_name", "first_name", "last_name",
  "status", "disabled", "token_version",
  "last_login_at", "deleted_at",
  "created_at", "updated_at"
)
SELECT
  u."id",
  u."email",
  u."full_name",
  u."first_name",
  u."last_name",
  COALESCE(u."status", 'active'),
  COALESCE(u."disabled", false),
  COALESCE(u."token_version", 0),
  u."last_login_at",
  u."deleted_at",
  u."created_at",
  CURRENT_TIMESTAMP
FROM "users" u
WHERE u."role" IN (
        'platform_admin',
        'platform_support',
        'platform_billing',
        'platform_readonly_audit'
      )
  AND NOT EXISTS (
        SELECT 1 FROM "platform_users" p WHERE p."id" = u."id"
      );

-- ----------------------------------------------------------------------------
-- 2) platform_user_identities — preserve `id` + password_hash byte-for-byte
-- ----------------------------------------------------------------------------
-- Every email-provider identity row whose user is now in platform_users.
-- Preserves `password_hash` so existing admins can keep logging in with
-- their current passwords across the cutover.
INSERT INTO "platform_user_identities" (
  "id", "user_id", "provider", "identifier",
  "password_hash", "verified_at",
  "created_at", "updated_at"
)
SELECT
  ui."id",
  ui."user_id",
  ui."provider",
  ui."identifier",
  ui."password_hash",
  ui."verified_at",
  ui."created_at",
  CURRENT_TIMESTAMP
FROM "user_identities" ui
JOIN "platform_users" pu ON pu."id" = ui."user_id"
WHERE NOT EXISTS (
        SELECT 1 FROM "platform_user_identities" pi WHERE pi."id" = ui."id"
      );

-- ----------------------------------------------------------------------------
-- 3) platform_user_roles — single row per platform user from legacy users.role
-- ----------------------------------------------------------------------------
-- Multi-role-ready table starts with one row per user; future grants
-- append additional rows.
INSERT INTO "platform_user_roles" (
  "user_id", "role", "granted_at", "granted_by"
)
SELECT
  pu."id",
  u."role",
  COALESCE(u."created_at", CURRENT_TIMESTAMP),
  -- We don't know who granted the role historically — leave NULL.
  -- Future grants will populate granted_by from the acting platform admin.
  NULL
FROM "platform_users" pu
JOIN "users" u ON u."id" = pu."id"
WHERE u."role" IN (
        'platform_admin',
        'platform_support',
        'platform_billing',
        'platform_readonly_audit'
      )
  AND NOT EXISTS (
        SELECT 1
        FROM "platform_user_roles" pr
        WHERE pr."user_id" = pu."id" AND pr."role" = u."role"
      );

-- ----------------------------------------------------------------------------
-- 4) Verification — count parity. Aborts the transaction on mismatch.
-- ----------------------------------------------------------------------------
-- Counts only NON-soft-deleted rows on both sides so a soft-deleted
-- legacy row that was excluded by the email-uniqueness partial index
-- doesn't trigger a false-positive mismatch.
DO $$
DECLARE
  legacy_count integer;
  new_count    integer;
BEGIN
  SELECT count(*) INTO legacy_count
  FROM "users"
  WHERE "role" IN (
          'platform_admin',
          'platform_support',
          'platform_billing',
          'platform_readonly_audit'
        )
    AND "deleted_at" IS NULL;

  SELECT count(*) INTO new_count
  FROM "platform_users"
  WHERE "deleted_at" IS NULL;

  IF legacy_count <> new_count THEN
    RAISE EXCEPTION
      'Backfill verification failed: legacy=% , platform_users=%',
      legacy_count, new_count;
  END IF;
END $$;

COMMIT;
