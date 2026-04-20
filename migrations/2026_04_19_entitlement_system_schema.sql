-- 2026-04-19 Entitlement system — canonical schema.
--
-- Adds the forward-looking dynamic-feature entitlement system alongside the
-- existing `tenant_features` hardcoded-column table. This is a PARALLEL
-- system (by explicit design, see architecture approval in CHANGELOG):
--
--   - `tenant_features` (9 boolean columns) stays exactly as-is; every
--     existing `requireFeature("quotesEnabled")` middleware call keeps
--     reading those columns with zero breakage.
--   - The new 4 tables below (`subscription_features`,
--     `subscription_plan_features`, `tenant_feature_overrides`,
--     `subscription_plan_metadata`) are the canonical source of truth for
--     NEW feature checks and future plan packaging.
--   - `companies.subscription_plan` stays the canonical plan pointer.
--     `tenant_subscriptions` stays the billing-cycle tracker. Neither is
--     touched by this migration.
--
-- All tables are additive. No existing columns or rows are modified.
--
-- Run via: npm run db:migrate
--
-- ---------------------------------------------------------------------------
-- subscription_features — feature catalog
-- ---------------------------------------------------------------------------
-- Dynamic feature definitions keyed by an immutable `feature_key`. All
-- entitlement enforcement is by key, never by display name.
--
-- `is_core = true` → the feature is always enabled for every tenant
-- regardless of plan or override. The resolver short-circuits to enabled
-- with null limit (unlimited). Core features exist in the catalog for
-- visibility/UI display but cannot be disabled in normal admin flows.
--
-- `limit_type` values are a fixed vocabulary (mirrors server enum):
--   none | count | monthly_count | seat_count | storage_mb | storage_gb |
--   branch_count | per_user | custom
CREATE TABLE IF NOT EXISTS subscription_features (
  id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key      TEXT NOT NULL UNIQUE,
  display_name     TEXT NOT NULL,
  description      TEXT,
  category         TEXT NOT NULL,
  limit_type       TEXT NOT NULL DEFAULT 'none',
  is_core          BOOLEAN NOT NULL DEFAULT false,
  active           BOOLEAN NOT NULL DEFAULT true,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  metadata         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS subscription_features_category_idx
  ON subscription_features(category);
CREATE INDEX IF NOT EXISTS subscription_features_active_idx
  ON subscription_features(active);

-- ---------------------------------------------------------------------------
-- subscription_plan_features — plan × feature matrix
-- ---------------------------------------------------------------------------
-- One row per (plan, feature). If no row exists for a (plan, feature) pair,
-- the resolver falls through to `is_core` behavior (enabled if core, else
-- denied). `limit_value NULL` = unlimited.
CREATE TABLE IF NOT EXISTS subscription_plan_features (
  id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id          VARCHAR NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  feature_id       VARCHAR NOT NULL REFERENCES subscription_features(id) ON DELETE CASCADE,
  enabled          BOOLEAN NOT NULL DEFAULT true,
  limit_value      INTEGER,
  metadata         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (plan_id, feature_id)
);

CREATE INDEX IF NOT EXISTS subscription_plan_features_plan_idx
  ON subscription_plan_features(plan_id);
CREATE INDEX IF NOT EXISTS subscription_plan_features_feature_idx
  ON subscription_plan_features(feature_id);

-- ---------------------------------------------------------------------------
-- tenant_feature_overrides — per-tenant escape hatch
-- ---------------------------------------------------------------------------
-- Highest-precedence layer. Null `enabled` means "do not override enablement
-- (inherit from plan)", null `limit_value` means "do not override limit".
-- A row with both nulls is effectively a no-op and the resolver ignores it.
CREATE TABLE IF NOT EXISTS tenant_feature_overrides (
  id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  feature_id       VARCHAR NOT NULL REFERENCES subscription_features(id) ON DELETE CASCADE,
  enabled          BOOLEAN,
  limit_value      INTEGER,
  reason           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (company_id, feature_id)
);

CREATE INDEX IF NOT EXISTS tenant_feature_overrides_company_idx
  ON tenant_feature_overrides(company_id);

-- ---------------------------------------------------------------------------
-- subscription_plan_metadata — editorial/packaging metadata
-- ---------------------------------------------------------------------------
-- Split out from `subscription_plans` per architecture decision to minimize
-- risk around the recently-fixed trial provisioning flow. Holds fields that
-- are admin-/marketing-facing (description, public visibility, annual price,
-- badges, sort order). One-to-one with a plan; created lazily on first write.
CREATE TABLE IF NOT EXISTS subscription_plan_metadata (
  id                      VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id                 VARCHAR NOT NULL UNIQUE REFERENCES subscription_plans(id) ON DELETE CASCADE,
  description             TEXT,
  is_public               BOOLEAN NOT NULL DEFAULT false,
  annual_price_cents      INTEGER,
  trial_eligible          BOOLEAN NOT NULL DEFAULT false,
  display_badge           TEXT,
  marketing_sort_order    INTEGER,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- Audit logging — reuses the existing `audit_logs` table via
-- `server/services/platformAuditService.ts`. See that file for the extended
-- AuditAction union covering:
--   entitlement_feature_created, entitlement_feature_updated,
--   entitlement_plan_created, entitlement_plan_updated,
--   entitlement_plan_feature_upsert, entitlement_plan_metadata_updated,
--   entitlement_tenant_plan_assigned, entitlement_tenant_override_upsert,
--   entitlement_tenant_override_removed
-- No new audit table — intentional consolidation.
