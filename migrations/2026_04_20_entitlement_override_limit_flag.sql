-- 2026-04-20 Entitlement override limit semantics — explicit-null support.
--
-- Context:
--   The resolver previously treated `tenant_feature_overrides.limit_value = NULL`
--   as "inherit from plan" (because storage collapsed both `undefined` and
--   `null` inputs to NULL in the column, losing the distinction at the
--   write boundary).
--
--   The documented contract is "null limit_value = unlimited". To make
--   the override layer honor that contract without breaking the partial-
--   override use case (override enabled, inherit limit), we add a boolean
--   flag that records whether the caller explicitly provided `limit_value`.
--
--   New resolver rule:
--     - override.limit_overridden = true  → override.limit_value wins
--                                            (NULL here = unlimited for this tenant)
--     - override.limit_overridden = false → inherit from plan / core / default
--
--   Back-compat: existing rows get limit_overridden = false by default so
--   the resolver behavior for already-written overrides stays identical
--   (they all had the "inherit" semantic already). If an admin intended
--   any existing override to express "unlimited via override", they can
--   re-upsert the row through the admin UI to set the flag.
--
-- Run via: npm run db:migrate

ALTER TABLE tenant_feature_overrides
  ADD COLUMN IF NOT EXISTS limit_overridden BOOLEAN NOT NULL DEFAULT false;
