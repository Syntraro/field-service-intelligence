-- ============================================================================
-- 2026-04-19 DEV FULL RESET — wipe all tenant + auth + business data to
-- return the DB to a first-ever-tenant baseline. Preserves only:
--   * roles, permissions, role_permissions  (global RBAC catalog)
--   * subscription_plans                    (product catalog)
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
