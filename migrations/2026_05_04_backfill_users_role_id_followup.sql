-- 2026-05-04 RBAC backfill follow-up — Phase 2 PR 3 hotfix.
--
-- Problem
--   The 2026-05-01 backfill migration populated `users.role_id` for
--   every user that existed at the time it ran. New users created
--   AFTER that point — including production tenant owners (e.g. the
--   re-seeded `service@samcor.ca`) and test fixtures from the
--   2026-05-04 PR 1 / PR 3 work — were inserted with `role_id = NULL`
--   because `userRepository.createUser` does not set the field.
--
--   The application-side resolver in `server/storage/permissions.ts`
--   threw on every NULL `role_id`, so every authenticated request
--   from those users 500'd. Symptom: "Failed to load financial
--   dashboard." for tenant owners that should have full access.
--
-- Fix (this migration)
--   Re-runs the same idempotent backfill from 2026_05_01 as a fresh
--   dated migration the runner will pick up. Identity-mapping on
--   `LOWER(users.role) = LOWER(roles.name)` for the five seeded
--   tenant roles. No-op for any user already populated.
--
-- Resilience companion
--   The application-side resolver was simultaneously updated to
--   self-heal at request time (look up `roles` by `role` string when
--   `role_id` is NULL, persist the resolved id back to the row).
--   This migration is the bulk fix; the resolver is the trickle fix
--   for any future row that escapes the bulk path.
--
-- Idempotent
--   The WHERE clause filters to NULL only; re-running on a
--   backfilled DB is a zero-row UPDATE.
--
-- Run
--   npm run db:migrate
-- Or:
--   npm run db:migrate:one -- migrations/2026_05_04_backfill_users_role_id_followup.sql

BEGIN;

UPDATE users u
SET role_id = r.id
FROM roles r
WHERE u.role_id IS NULL
  AND LOWER(u.role) = LOWER(r.name)
  AND u.role IN ('owner', 'admin', 'manager', 'dispatcher', 'technician');

DO $$
DECLARE
  unmapped_total integer;
BEGIN
  SELECT COUNT(*) INTO unmapped_total
  FROM users
  WHERE role_id IS NULL
    AND role IN ('owner', 'admin', 'manager', 'dispatcher', 'technician');

  RAISE NOTICE '[2026_05_04_backfill_followup] tenant users with NULL role_id remaining: %',
    unmapped_total;

  IF unmapped_total > 0 THEN
    RAISE NOTICE '[2026_05_04_backfill_followup] WARNING: % tenant users still need manual review.', unmapped_total;
  END IF;
END
$$;

COMMIT;
