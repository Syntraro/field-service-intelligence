-- ============================================================================
-- Migration: 2026_05_04_platform_users_users_table_cleanup  (Phase 2-A, Step D)
--                                                            (a.k.a. Phase 5)
-- ============================================================================
--
-- DESTRUCTIVE — final cleanup. Deletes every legacy platform-role row
-- from the tenant `users` table. The CASCADE on `user_identities` and
-- on `platform_password_reset_tokens` (now FK'd to `platform_users`)
-- means tenant-table identity rows for these users are also removed,
-- but the canonical `platform_users` / `platform_user_identities` rows
-- backfilled in Step B are untouched.
--
-- Preconditions (operator-verified before running)
--   • `platform_users` count == legacy `users WHERE role IN PLATFORM_ROLES`
--     count (parity verified by `auditPlatformUsers.ts`).
--   • Phase 5 code in this commit is deployed — no caller depends on
--     the legacy fallback path anymore.
--   • Minimum two release cycles have elapsed since the Phase 3 cutover
--     so live sessions have rotated through the new resolver.
--   • Database backup snapshot taken (this migration is non-reversible
--     without restore).
--
-- Safety
--   • Wrapped in BEGIN/COMMIT.
--   • Pre-flight count check via DO $$ ... RAISE EXCEPTION block.
--     Aborts the transaction if the legacy count exceeds the
--     platform_users count, which would mean the backfill missed
--     something and the DELETE would lose data.
--   • DELETE is scoped narrowly to `role IN PLATFORM_ROLES` so no
--     tenant user is at risk.
--
-- Reversibility
--   None. Restore from backup if needed. The `platform_users` rows
--   carry every value from the deleted legacy rows (id, email,
--   password_hash via user_identities, token_version, status, etc.),
--   so functional state is fully preserved on the new surface.
--
-- Idempotency
--   Re-running after a successful first run leaves the table empty
--   and the DELETE matches zero rows — a no-op.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) Pre-flight verification.
--    The legacy population must be a subset of platform_users — otherwise
--    the DELETE would lose data. The cleanest check is "every legacy id
--    must exist in platform_users".
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  unmigrated_count integer;
BEGIN
  SELECT count(*) INTO unmigrated_count
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

  IF unmigrated_count > 0 THEN
    RAISE EXCEPTION
      'Phase 5 cleanup aborted: % legacy platform-role row(s) have no matching platform_users entry. Re-run the backfill first.',
      unmigrated_count;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2) DESTRUCTIVE DELETE — legacy platform-role rows only.
--    user_identities rows (and any other CASCADE-dependent tenant rows)
--    are removed automatically by the FK from `users`.
-- ----------------------------------------------------------------------------
DELETE FROM "users"
WHERE "role" IN (
        'platform_admin',
        'platform_support',
        'platform_billing',
        'platform_readonly_audit'
      );

-- ----------------------------------------------------------------------------
-- 3) Post-delete sanity check — legacy table should now hold zero
--    platform-role rows. Belt-and-suspenders: if the DELETE silently
--    failed (somehow), the post-check rolls the transaction back.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  remaining integer;
BEGIN
  SELECT count(*) INTO remaining
  FROM "users"
  WHERE "role" IN (
          'platform_admin',
          'platform_support',
          'platform_billing',
          'platform_readonly_audit'
        );

  IF remaining > 0 THEN
    RAISE EXCEPTION
      'Phase 5 cleanup post-check failed: % legacy platform-role row(s) remain after DELETE.',
      remaining;
  END IF;
END $$;

COMMIT;
