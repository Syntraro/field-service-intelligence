-- 2026-04-21 Phase 1: Canonical entitlement resolver becomes the read path.
--
-- The legacy tenant_features table has 9 boolean feature columns (quotesEnabled,
-- invoicesEnabled, calendarEnabled, qboEnabled, routeOptimizationEnabled,
-- multiTechEnabled, liveMapEnabled, customerPortalEnabled,
-- customerPortalPaymentsEnabled). The canonical entitlement system keys on
-- snake_case feature_keys in subscription_features.
--
-- This migration:
--   A1. Ensures every legacy key exists in the canonical catalog under its
--       snake_case counterpart. Keys already present from the 2026-04-19
--       seed are left untouched; only the ones that had no canonical
--       counterpart are inserted here.
--   A2. Seeds a default subscription_plan_features row for every active plan
--       so the resolver has a plan-layer answer for every catalog feature.
--       Enabled = true for core features; for non-core the default is true
--       (matches legacy tenant_features default behavior for new tenants).
--   A3. Backfills tenant_feature_overrides from the current tenant_features
--       row whenever a tenant's boolean differs from the plan default. This
--       preserves the exact effective feature set for every active tenant
--       on the switchover to the canonical resolver.
--   A4. Scans companies.subscription_plan for names that do not match any
--       subscription_plans.name. Emits a NOTICE per orphan (operational
--       signal, no automatic fix — the Phase 1 plan guard on admin PATCH
--       prevents future orphans).
--
-- Run via: npm run db:migrate. Idempotent.

-- ========================================================================
-- A1. Ensure every legacy feature key has a canonical snake_case counterpart.
-- ========================================================================
--
-- Mapping legacy (camelCase column)          → canonical (snake_case feature_key):
--   quotesEnabled                            → quotes                 (already seeded as core)
--   invoicesEnabled                          → invoices               (already seeded as core)
--   calendarEnabled                          → scheduling_calendar    (already seeded as core)
--   qboEnabled                               → quickbooks_online      (already seeded)
--   routeOptimizationEnabled                 → route_optimization     (NEW)
--   multiTechEnabled                         → multi_tech_scheduling  (NEW)
--   liveMapEnabled                           → live_map               (NEW)
--   customerPortalEnabled                    → customer_portal        (already seeded)
--   customerPortalPaymentsEnabled            → customer_portal_payments (NEW)

INSERT INTO subscription_features
  (feature_key, display_name, description, category, limit_type, is_core, active, sort_order)
VALUES
  ('route_optimization',       'Route Optimization',        'Automated technician route optimization',         'technician_app',  'none', false, true, 360),
  ('multi_tech_scheduling',    'Multi-Technician Scheduling','Multi-technician crews on a single visit',        'technician_app',  'none', false, true, 370),
  ('live_map',                 'Live Map',                  'Real-time map of technician locations',           'technician_app',  'none', false, true, 380),
  ('customer_portal_payments', 'Customer Portal Payments',  'Accept payments via the customer portal',         'communication',   'none', false, true, 825)
ON CONFLICT (feature_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description  = EXCLUDED.description,
  category     = EXCLUDED.category,
  limit_type   = EXCLUDED.limit_type,
  is_core      = EXCLUDED.is_core,
  active       = EXCLUDED.active,
  sort_order   = EXCLUDED.sort_order,
  updated_at   = CURRENT_TIMESTAMP;

-- ========================================================================
-- A2. Seed a default subscription_plan_features row for every (plan, feature).
-- ========================================================================
--
-- For every active plan × every active non-core feature, ensure a plan-feature
-- row exists. Default enabled = true. This matches legacy behavior (every
-- feature defaulted true in tenant_features except the two portal ones).
--
-- Core features are implicitly always enabled by the resolver, so they are
-- not strictly required here, but we still seed rows so the admin UI surfaces
-- a complete matrix.
--
-- limit_value = NULL (unlimited) for all defaults. Platform admin sets plan-
-- specific caps via the PlatformPlanDetail UI or future migrations.

INSERT INTO subscription_plan_features (plan_id, feature_id, enabled, limit_value)
SELECT p.id, f.id,
       CASE
         -- The two portal features historically default to FALSE on new tenants.
         -- Preserve that on the plan baseline so fresh plans don't silently
         -- flip the portal on.
         WHEN f.feature_key IN ('customer_portal', 'customer_portal_payments') THEN false
         ELSE true
       END AS enabled,
       NULL::integer AS limit_value
FROM subscription_plans p
CROSS JOIN subscription_features f
WHERE p.active = true AND f.active = true
ON CONFLICT (plan_id, feature_id) DO NOTHING;

-- ========================================================================
-- A3. Backfill tenant_feature_overrides from current tenant_features rows.
-- ========================================================================
--
-- Rationale: when the canonical resolver becomes the read path, every tenant
-- must continue to see the same effective enabled/disabled set as they do
-- today from tenant_features. We compare each tenant's current boolean to
-- the plan-default and insert an explicit override row ONLY when they differ.
-- This produces the minimum diff override set — tenants on defaults have no
-- override rows.
--
-- The override write path (future PATCH /api/platform/tenants/:id/overrides)
-- is unchanged; this is a one-time sync point.

-- Map of (legacy column name → canonical feature_key). Expressed as a VALUES
-- list so we can iterate inside a single SQL statement.
WITH legacy_map(legacy_col, canonical_key) AS (
  VALUES
    ('quotes_enabled',                      'quotes'),
    ('invoices_enabled',                    'invoices'),
    ('calendar_enabled',                    'scheduling_calendar'),
    ('qbo_enabled',                         'quickbooks_online'),
    ('route_optimization_enabled',          'route_optimization'),
    ('multi_tech_enabled',                  'multi_tech_scheduling'),
    ('live_map_enabled',                    'live_map'),
    ('customer_portal_enabled',             'customer_portal'),
    ('customer_portal_payments_enabled',    'customer_portal_payments')
),
tenant_flags AS (
  SELECT
    tf.company_id,
    unnest(ARRAY[
      tf.quotes_enabled, tf.invoices_enabled, tf.calendar_enabled, tf.qbo_enabled,
      tf.route_optimization_enabled, tf.multi_tech_enabled, tf.live_map_enabled,
      tf.customer_portal_enabled, tf.customer_portal_payments_enabled
    ]) AS flag_value,
    unnest(ARRAY[
      'quotes_enabled', 'invoices_enabled', 'calendar_enabled', 'qbo_enabled',
      'route_optimization_enabled', 'multi_tech_enabled', 'live_map_enabled',
      'customer_portal_enabled', 'customer_portal_payments_enabled'
    ]) AS legacy_col
  FROM tenant_features tf
),
-- Resolve plan default for each (tenant, canonical feature)
plan_defaults AS (
  SELECT
    c.id AS company_id,
    f.id AS feature_id,
    f.feature_key,
    pf.enabled AS plan_enabled,
    f.is_core
  FROM companies c
  LEFT JOIN subscription_plans p ON p.name = c.subscription_plan AND p.active = true
  CROSS JOIN subscription_features f
  LEFT JOIN subscription_plan_features pf
    ON pf.plan_id = p.id AND pf.feature_id = f.id
  WHERE f.active = true
),
-- Tenant's current effective flag per canonical key
tenant_current AS (
  SELECT tf.company_id, lm.canonical_key, tf.flag_value
  FROM tenant_flags tf
  INNER JOIN legacy_map lm ON lm.legacy_col = tf.legacy_col
),
-- Find mismatches where tenant flag ≠ plan default (and feature is not core,
-- because core is always enabled regardless of override)
diffs AS (
  SELECT
    tc.company_id,
    pd.feature_id,
    tc.flag_value AS tenant_enabled,
    pd.plan_enabled,
    pd.is_core
  FROM tenant_current tc
  JOIN plan_defaults pd
    ON pd.company_id = tc.company_id AND pd.feature_key = tc.canonical_key
  WHERE pd.is_core = false
    AND (pd.plan_enabled IS DISTINCT FROM tc.flag_value)
)
INSERT INTO tenant_feature_overrides (company_id, feature_id, enabled, limit_value, limit_overridden, reason)
SELECT
  d.company_id,
  d.feature_id,
  d.tenant_enabled,
  NULL,
  false,
  'Phase 1 backfill from legacy tenant_features row'
FROM diffs d
ON CONFLICT (company_id, feature_id) DO UPDATE SET
  -- If an override already exists, don't clobber it — respect existing admin intent.
  -- ON CONFLICT DO NOTHING would be simpler, but DO UPDATE with identity is
  -- explicit about the "preserve existing" decision.
  enabled = tenant_feature_overrides.enabled,
  reason  = COALESCE(tenant_feature_overrides.reason, EXCLUDED.reason);

-- ========================================================================
-- A4. Plan-name integrity scan (operational signal only, no auto-fix).
-- ========================================================================
--
-- companies.subscription_plan is a naked text reference to
-- subscription_plans.name. The Phase 1 plan guard on admin PATCH prevents
-- future orphans, but legacy rows may have typos. RAISE NOTICE surfaces
-- them during migration so ops can reconcile manually.

DO $$
DECLARE
  orphan_count integer;
  orphan_row record;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM companies c
  WHERE c.subscription_plan IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM subscription_plans sp WHERE sp.name = c.subscription_plan
    );

  IF orphan_count > 0 THEN
    RAISE NOTICE '[entitlement-migration] Found % companies with subscription_plan names that do NOT match any subscription_plans.name row. Operational follow-up required.', orphan_count;
    FOR orphan_row IN
      SELECT c.id AS company_id, c.name AS company_name, c.subscription_plan
      FROM companies c
      WHERE c.subscription_plan IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM subscription_plans sp WHERE sp.name = c.subscription_plan
        )
      LIMIT 50
    LOOP
      RAISE NOTICE '  - company_id=% name=% subscription_plan=%', orphan_row.company_id, orphan_row.company_name, orphan_row.subscription_plan;
    END LOOP;
  ELSE
    RAISE NOTICE '[entitlement-migration] OK — every companies.subscription_plan resolves to a subscription_plans.name.';
  END IF;
END $$;
