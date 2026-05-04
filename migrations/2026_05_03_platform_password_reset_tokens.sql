-- ============================================================================
-- Migration: 2026_05_03_platform_password_reset_tokens
-- ============================================================================
--
-- Purpose
--   Adds a dedicated `platform_password_reset_tokens` table for the new
--   `/api/platform/auth/{request,reset}-password` flow. Kept separate
--   from the existing tenant-scoped `password_reset_tokens` table so
--   the two flows cannot ever cross-contaminate:
--     • A tenant reset link CANNOT be redeemed at the platform
--       endpoint (different table, different lookup).
--     • A platform reset link CANNOT be redeemed at the tenant
--       endpoint (same reason).
--   This is the same separation-of-purpose principle that backs the
--   psid vs sid cookie split — distinct identity surfaces, distinct
--   token surfaces, distinct audit events.
--
-- Schema source
--   `shared/schema.ts::platformPasswordResetTokens` (added in the same
--   commit).
--
-- Run instructions
--   Local / dev:   npm run db:migrate:one -- migrations/2026_05_03_platform_password_reset_tokens.sql
--   Full sweep:    npm run db:migrate
--
-- Reversibility
--   `DROP TABLE platform_password_reset_tokens;`
--   No FK from any other table.
--
-- Idempotency
--   `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "platform_password_reset_tokens" (
  "id"            varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"       varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash"    text NOT NULL UNIQUE,
  "expires_at"    timestamp NOT NULL,
  "used_at"       timestamp,
  "requested_ip"  text,
  "created_at"    timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Lookup index for "active token for a user" sweeps used at issue time
-- to invalidate any prior unused link for the same user.
CREATE INDEX IF NOT EXISTS "idx_platform_password_reset_tokens_user_active"
  ON "platform_password_reset_tokens" ("user_id")
  WHERE "used_at" IS NULL;
