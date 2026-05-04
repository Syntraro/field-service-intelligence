-- ============================================================================
-- 2026-04-19 DEV FULL RESET — wipe all tenant + auth + business data to
-- return the DB to a first-ever-tenant baseline. Preserves only:
--   * roles, permissions, role_permissions  (global RBAC catalog)
--   * subscription_plans                    (product catalog)
--   * subscription_features                 (entitlement catalog) — 2026-05-03
--   * subscription_plan_features            (per-plan feature flags) — 2026-05-03
--   * schema_migrations                     (migration tracker — critical)
--
-- Deeper than migrations/dev_reset_business_data.sql (which intentionally
-- preserves users/companies/sessions). This one takes everything down to
-- zero for signup-flow verification.
--
-- Approach: dynamic pg_class loop builds a single TRUNCATE … CASCADE so
-- we don't miss any public-schema table added since this file was
-- written. One transaction; RESTART IDENTITY resets identity sequences.
--
-- 2026-05-03: extended the exclusion list to preserve the entitlement
-- catalog (`subscription_features` + `subscription_plan_features`).
-- These are platform-config rows, not tenant data — same category as
-- `subscription_plans` which was already excluded. Without this, a
-- full reset wiped every plan_feature row and `schema_migrations`
-- still showed the seed migrations as "applied", so the rows never
-- came back on re-migrate. The `customer_portal` /
-- `customer_portal_payments` enablement (migration
-- 2026_05_03_enable_customer_portal_payments.sql) survives a full
-- reset cleanly because of this exclusion. Tenant-specific
-- `tenant_feature_overrides` rows ARE still cleared — they're tenant
-- data, not catalog data.
--
-- Run: npm run db:migrate:one -- migrations/dev_reset_full.sql
-- ============================================================================

BEGIN;

DO $$
DECLARE
  tbl_list text;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
    INTO tbl_list
    FROM pg_tables
   WHERE schemaname = 'public'
     AND tablename NOT IN (
       'roles',
       'permissions',
       'role_permissions',
       'subscription_plans',
       -- 2026-05-03: entitlement catalog rows are platform-config,
       -- not tenant data. Preserving them mirrors the existing
       -- `subscription_plans` carve-out so feature flags survive a
       -- full reset (notably customer_portal_payments).
       'subscription_features',
       'subscription_plan_features',
       'schema_migrations'
     );

  IF tbl_list IS NULL THEN
    RAISE NOTICE 'No tables to truncate — nothing to do';
    RETURN;
  END IF;

  RAISE NOTICE 'Truncating tables: %', tbl_list;
  EXECUTE 'TRUNCATE TABLE ' || tbl_list || ' RESTART IDENTITY CASCADE';
END $$;

COMMIT;
