-- 2026-04-21b Phase 1 follow-up: add UNIQUE(role_id, permission_id) on role_permissions.
--
-- PRECONDITION
-- ------------
-- The 2026-04-21 RBAC seed migration (2026_04_21_seed_rbac_catalog.sql) used
-- `ON CONFLICT DO NOTHING` on role_permissions INSERTs to make the seed
-- idempotent. Postgres ON CONFLICT only fires when a matching unique index
-- or exclusion constraint exists — none exists on role_permissions today.
-- On the first live run (2026-04-21), rows previously written by the legacy
-- runtime seeder (`ensureRolesAndPermissionsSeeded` in server/routes/roles.ts)
-- were duplicated by the migration because ON CONFLICT had nothing to
-- conflict against.
--
-- Observed post-migration state on 2026-04-21:
--   - role_permissions rows:                      298
--   - duplicate (role_id, permission_id) pairs:   148
--
-- Effective permissions are still correct — `getUserEffectivePermissions`
-- builds a Set<string>, so duplicates collapse at read time. No user is
-- locked out and no user has unintended access. The risk is purely
-- operational: every future re-run of the RBAC seed migration would double
-- the row count again, row-count metrics are wrong, and DELETE/UPDATE
-- against role_permissions behave unpredictably.
--
-- DEDUPE STRATEGY
-- ---------------
-- For each (role_id, permission_id) group, keep exactly one row — the row
-- with the smallest `ctid`. `ctid` is Postgres's built-in physical row
-- identifier: unique within a heap and stable for the duration of a single
-- transaction. VACUUM may relocate rows between transactions, so ctid-based
-- dedupe is only safe when the read and the delete happen inside the same
-- transaction. Both run inside the BEGIN/COMMIT below, so the ctid values
-- read by the CTE are the same values matched by the DELETE.
--
-- Rows with row_number() > 1 within their (role_id, permission_id)
-- partition are semantic duplicates — same grant, different `id` UUID — and
-- are removed. Information loss is nil: the surviving row represents the
-- same role→permission grant.
--
-- Running this block when no duplicates exist is a no-op (CTE returns no
-- rows where rn > 1). Safe on re-run.
--
-- CONSTRAINT ADDITION
-- -------------------
-- Adds a UNIQUE constraint on (role_id, permission_id). This is what makes
-- the RBAC seed migration's `ON CONFLICT DO NOTHING` clauses actually fire
-- on future applies. Guarded by a pg_constraint lookup so the migration is
-- safe to re-run after the constraint already exists.
--
-- POST-MIGRATION STATE
-- --------------------
--   - role_permissions contains exactly one row per (role_id, permission_id).
--   - `role_permissions_role_permission_unique` UNIQUE constraint exists on
--     role_permissions.
--   - Expected surviving row count: ~150 (the union of rows previously
--     written by the runtime seeder and the Phase 1 migration — not a round
--     number because the two sources' per-role permission lists have small
--     differences that produce a union of 150 unique pairs).
--   - Re-running 2026_04_21_seed_rbac_catalog.sql is now genuinely idempotent
--     — ON CONFLICT DO NOTHING will now match the new constraint and skip
--     existing mappings.
--
-- Run via: npm run db:migrate. Idempotent. Transactional.

BEGIN;

-- ============================================================================
-- Step 1 — Deduplicate role_permissions.
-- ============================================================================
-- row_number() partitions by (role_id, permission_id) and assigns rn=1 to
-- exactly one row per group (ordered by ctid — the physically-first row).
-- Any row with rn > 1 is a duplicate. The DELETE removes them by ctid join,
-- which is unambiguous: ctid is the tuple's physical address.

WITH ranked AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY role_id, permission_id
      ORDER BY ctid
    ) AS rn
  FROM role_permissions
)
DELETE FROM role_permissions rp
USING ranked r
WHERE rp.ctid = r.ctid
  AND r.rn > 1;

-- ============================================================================
-- Step 2 — Add UNIQUE(role_id, permission_id). Guarded for idempotency.
-- ============================================================================
-- Uses a pg_constraint lookup so the migration does not error on re-run.
-- If the constraint already exists (e.g., this migration has already been
-- applied), the DO block RAISE NOTICEs and returns.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'role_permissions_role_permission_unique'
      AND conrelid = 'role_permissions'::regclass
  ) THEN
    ALTER TABLE role_permissions
      ADD CONSTRAINT role_permissions_role_permission_unique
      UNIQUE (role_id, permission_id);
    RAISE NOTICE '[role-permissions] Added UNIQUE(role_id, permission_id) constraint.';
  ELSE
    RAISE NOTICE '[role-permissions] UNIQUE constraint already present — no change.';
  END IF;
END $$;

COMMIT;
