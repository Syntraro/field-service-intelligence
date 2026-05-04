-- ============================================================================
-- Migration: 2026_05_04_platform_users_create  (Phase 2-A, Step A — additive)
-- ============================================================================
--
-- Purpose
--   Create the dedicated platform-identity tables that will replace the
--   current "platform admin parked in tenant users" model. This step is
--   ADDITIVE ONLY:
--     • No tenant code path reads from these tables yet.
--     • The legacy `users WHERE role IN (PLATFORM_ROLES)` path stays
--       fully alive — Step B (`*_backfill.sql`) copies data over,
--       Step C (this PR's code cutover + reset-token FK repoint) flips
--       the read source, Step D (separate PR, after monitoring) deletes
--       the legacy rows.
--
--   See `docs/REFACTORING_LOG.md` (2026-05-03) and `SECURITY.md`
--   ("Platform Admin Identity — Architectural Debt") for full context.
--
-- Decision: Option 1 — same email allowed across platform + tenant.
--   Platform identity uniqueness is enforced WITHIN this surface only
--   (`platform_user_identities (provider, lower(identifier))`). The
--   tenant `user_identities` table is queried independently. A real
--   human MAY have a tenant account at `nad@example.com` AND a
--   platform-admin account at `nad@example.com` — the two surfaces
--   are deliberately separate identity worlds.
--
-- Schema source
--   `shared/schema.ts::platformUsers` / `platformUserIdentities` /
--   `platformUserRoles` (added in the same commit).
--
-- Reversibility
--   `DROP TABLE platform_user_roles;`
--   `DROP TABLE platform_user_identities;`
--   `DROP TABLE platform_users;`
--   No FK from any pre-existing table to these. Safe to drop in any
--   order if the tables are empty; otherwise drop in the reverse-FK
--   order shown above.
--
-- Idempotency
--   `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- platform_users
-- ----------------------------------------------------------------------------
-- The canonical identity row for an internal SaaS-vendor staff member
-- (platform_admin, platform_support, platform_billing,
-- platform_readonly_audit). Deliberately has NO companyId, NO roleId
-- pointing at the tenant RBAC catalog, NO tenant `password` column —
-- the credential surface is `platform_user_identities`.
CREATE TABLE IF NOT EXISTS "platform_users" (
  "id"             varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "email"          text NOT NULL,
  "full_name"      text,
  "first_name"     text,
  "last_name"      text,
  -- 'active' | 'deactivated'. Smaller enum than tenant users.status —
  -- platform users are bootstrapped via the seed script, never invited.
  "status"         text NOT NULL DEFAULT 'active',
  "disabled"       boolean NOT NULL DEFAULT false,
  -- Same session-invalidation lever as tenant users.token_version —
  -- bump it to force every active platform session to re-authenticate.
  "token_version"  integer NOT NULL DEFAULT 0,
  "last_login_at"  timestamp,
  "deleted_at"     timestamp,
  "created_at"     timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Email uniqueness is partial on `deleted_at IS NULL` so a soft-deleted
-- platform user can be re-created at the same address without a
-- collision. Case-insensitive via lower() to mirror the tenant model.
CREATE UNIQUE INDEX IF NOT EXISTS "platform_users_email_unique"
  ON "platform_users" (lower("email"))
  WHERE "deleted_at" IS NULL;

-- ----------------------------------------------------------------------------
-- platform_user_identities
-- ----------------------------------------------------------------------------
-- Login credential surface for platform users. Mirrors tenant
-- `user_identities` shape minus the tenant-scoping `companyId` column —
-- platform identity is NOT tenant-scoped. Today only `provider='email'`
-- exists; SSO providers can be added later without schema change.
CREATE TABLE IF NOT EXISTS "platform_user_identities" (
  "id"             varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"        varchar NOT NULL REFERENCES "platform_users"("id") ON DELETE CASCADE,
  "provider"       text NOT NULL,
  "identifier"     text NOT NULL,
  "password_hash"  text,
  "verified_at"    timestamp,
  "created_at"     timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Global uniqueness on (provider, lower(identifier)) — no tenant scoping.
-- One platform-email identity row per (provider, identifier) tuple.
CREATE UNIQUE INDEX IF NOT EXISTS "platform_user_identities_provider_identifier_unique"
  ON "platform_user_identities" ("provider", lower("identifier"));

-- Lookup by user_id for "list all identities for this platform user".
CREATE INDEX IF NOT EXISTS "platform_user_identities_user_idx"
  ON "platform_user_identities" ("user_id");

-- ----------------------------------------------------------------------------
-- platform_user_roles
-- ----------------------------------------------------------------------------
-- Multi-role join table. Today every platform user has exactly one
-- role (the legacy single-role model in `users.role`), so the join
-- starts with one row per user; the schema is multi-role-ready so
-- a future grant-additional-role flow doesn't need a migration.
-- Roles are stored as plain strings matching the canonical
-- `PLATFORM_ROLES` list in `server/auth/roles.ts` —
-- 'platform_admin' | 'platform_support' | 'platform_billing' |
-- 'platform_readonly_audit'. Format intentionally NOT enforced
-- with a CHECK constraint at this stage; the application layer is
-- the source of truth (matches the existing `users.role` pattern).
CREATE TABLE IF NOT EXISTS "platform_user_roles" (
  "user_id"     varchar NOT NULL REFERENCES "platform_users"("id") ON DELETE CASCADE,
  "role"        text NOT NULL,
  "granted_at"  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- granted_by is nullable so the very first platform user (the
  -- bootstrap seed) can be inserted without a circular reference.
  -- ON DELETE SET NULL preserves audit trail when a granter is
  -- later removed.
  "granted_by"  varchar REFERENCES "platform_users"("id") ON DELETE SET NULL,
  PRIMARY KEY ("user_id", "role")
);

CREATE INDEX IF NOT EXISTS "platform_user_roles_user_idx"
  ON "platform_user_roles" ("user_id");
