-- ============================================================================
-- Migration: 2026_05_04_users_role_restrict_to_tenant
-- ============================================================================
--
-- Purpose
--   Hard-enforce at the database level that `users.role` can ONLY be a
--   tenant role. Platform identities live exclusively in the dedicated
--   `platform_users` / `platform_user_roles` tables (Phase 2-A); the
--   destructive cleanup migration (Phase 5) emptied every legacy
--   platform-role row from `users`. This migration adds the structural
--   guarantee — once it lands, no INSERT or UPDATE can ever put a
--   platform role string back into `users.role`.
--
-- Canonical tenant role list (matches `server/auth/roles.ts::ALL_ROLES`):
--   owner | admin | manager | dispatcher | technician
--
-- Canonical platform role list (NEVER permitted in `users.role`):
--   platform_admin | platform_support | platform_billing | platform_readonly_audit
--
-- Preconditions
--   • Phase 5 destructive cleanup migration has run
--     (`2026_05_04_platform_users_users_table_cleanup.sql`).
--   • `auditPlatformUsers.ts` reports zero rows in `[users (legacy)]`.
--
-- Reversibility
--   ALTER TABLE users DROP CONSTRAINT users_role_tenant_only_chk;
--   Safe to drop at any point — no data depends on the constraint.
--
-- Idempotency
--   The pre-flight count check is idempotent (read-only). The ADD
--   CONSTRAINT step uses a guarded DO $$ block that names the
--   constraint and skips if it already exists, so a re-run of this
--   migration is a no-op against a database that already has it.
--
-- Note on rollout pattern
--   ADD CONSTRAINT … NOT VALID followed by VALIDATE CONSTRAINT is the
--   canonical Postgres "non-blocking add then verify" sequence. With
--   zero existing rows in violation (verified by the pre-flight) the
--   VALIDATE phase is fast and trivially passes. If a row somehow
--   sneaks in between the two statements (it can't — they run in the
--   same transaction), the VALIDATE call would fail and the entire
--   transaction rolls back.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) Pre-flight verification.
--    Aborts the migration if any platform-role row is still present in
--    `users`. After Phase 5 this should always be zero; the check is
--    cheap and provides a clear failure message if someone re-applies
--    legacy data accidentally (e.g. a partial backup-restore).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  legacy_platform_count integer;
BEGIN
  SELECT count(*) INTO legacy_platform_count
  FROM "users"
  WHERE "role" IN (
          'platform_admin',
          'platform_support',
          'platform_billing',
          'platform_readonly_audit'
        );

  IF legacy_platform_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add tenant-role-only constraint: % platform-role row(s) still in users. Run the Phase 5 cleanup migration first.',
      legacy_platform_count;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2) Add the CHECK constraint, idempotent on re-runs.
--    Named explicitly so future operators can drop / inspect by name.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'users'
      AND c.conname = 'users_role_tenant_only_chk'
  ) THEN
    -- Two-step add: NOT VALID first (avoids a full table scan during
    -- the ALTER), then VALIDATE inside the same transaction.
    ALTER TABLE "users"
      ADD CONSTRAINT "users_role_tenant_only_chk"
      CHECK (
        "role" IN (
          'owner',
          'admin',
          'manager',
          'dispatcher',
          'technician'
        )
      ) NOT VALID;

    ALTER TABLE "users"
      VALIDATE CONSTRAINT "users_role_tenant_only_chk";
  END IF;
END $$;

COMMIT;
