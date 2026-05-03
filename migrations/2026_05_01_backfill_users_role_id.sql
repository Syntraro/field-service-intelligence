-- 2026-05-01 RBAC system fix: backfill `users.role_id` for every tenant
-- user from `users.role` (legacy free-form role string).
--
-- Background:
--   `users.role_id` (UUID FK → `roles.id`) is the canonical authority
--   for tenant-scoped RBAC, but it was added nullable in the original
--   2026-04-21 RBAC catalog migration with the inline comment "(will
--   be populated by migration)" — that follow-up migration never
--   shipped. The tenant-resolver in `server/storage/permissions.ts`
--   contained a now-removed legacy fallback that mapped `users.role`
--   to bogus role-id strings (`"role-admin"`, `"role-manager"`,
--   `"role-technician"`) which never matched any actual `roles.id`
--   (auto-generated UUIDs from `gen_random_uuid()`). Result: every
--   user with `role_id IS NULL` received an empty effective permission
--   set regardless of their `role` string — including owners/admins.
--
-- This migration:
--   1. Populates `users.role_id` from `users.role` for every tenant
--      user whose `role_id` is currently NULL. The mapping is the
--      identity mapping on `LOWER(role) = LOWER(roles.name)` for the
--      five seeded system roles (owner / admin / manager / dispatcher
--      / technician).
--   2. Reports the row count touched + any users that could NOT be
--      mapped (e.g., `role` value not in the seeded roles set) so the
--      operator can fix them manually.
--   3. Does NOT add `NOT NULL` on `users.role_id`. Reason: platform
--      users (`role = 'platform_admin'`, etc.) intentionally have no
--      tenant `role_id` by design — they bypass tenant RBAC entirely
--      via `isPlatformRole(user.role)`. A blanket `NOT NULL` would
--      block creation of platform users. The application-layer
--      resolver (`server/storage/permissions.ts`) now throws when a
--      non-platform user is missing `role_id`, which is the correct
--      enforcement layer.
--
-- Idempotent — re-running this migration on an already-backfilled
-- database is a no-op (the WHERE clause filters to NULL only).
--
-- Run: npm run db:migrate
-- Or:  npm run db:migrate:one -- migrations/2026_05_01_backfill_users_role_id.sql

BEGIN;

-- Step 1: Backfill users.role_id from the seeded roles table.
-- The 2026_04_21_seed_rbac_catalog.sql migration created the five
-- system roles (owner/admin/manager/dispatcher/technician). Map each
-- legacy `users.role` value to the matching `roles.name` row and
-- write the resolved `roles.id` UUID into `users.role_id`.
UPDATE users u
SET role_id = r.id
FROM roles r
WHERE u.role_id IS NULL
  AND LOWER(u.role) = LOWER(r.name)
  AND u.role IN ('owner', 'admin', 'manager', 'dispatcher', 'technician');

-- Step 2: Report any users that could NOT be backfilled. These are
-- either platform users (intentional) or users with a `role` string
-- that does not match any seeded role. The operator should review
-- and either assign a role through the admin UI or update the row
-- directly.
DO $$
DECLARE
  unmapped_total integer;
  platform_total integer;
  truly_unmapped integer;
BEGIN
  SELECT COUNT(*) INTO unmapped_total FROM users WHERE role_id IS NULL;
  SELECT COUNT(*) INTO platform_total FROM users WHERE role_id IS NULL AND role IN ('platform_admin');
  truly_unmapped := unmapped_total - platform_total;

  RAISE NOTICE '[backfill] users.role_id NULL after backfill: total=% (platform=% expected, unmapped=%)',
    unmapped_total, platform_total, truly_unmapped;

  IF truly_unmapped > 0 THEN
    RAISE NOTICE '[backfill] WARNING: % tenant users still have NULL role_id. They will fail authentication after deploy until role_id is set. Run:', truly_unmapped;
    RAISE NOTICE '[backfill]   SELECT id, email, role FROM users WHERE role_id IS NULL AND role NOT IN (''platform_admin'');';
  END IF;
END
$$;

COMMIT;

-- Optional follow-up (NOT applied automatically — review first):
-- An index on (company_id, role_id) accelerates per-tenant role
-- audits. Skipped here to keep the migration scoped to the data fix.
--   CREATE INDEX IF NOT EXISTS idx_users_company_role
--     ON users(company_id, role_id) WHERE role_id IS NOT NULL;
