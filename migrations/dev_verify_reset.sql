-- 2026-04-19 verify reset — prints counts via RAISE NOTICE so the
-- migration runner captures them in stdout. Read-only.
--
-- Expected after migrations/dev_reset_full.sql:
--   all "operational" tables = 0
--   preserved catalogs       > 0  (or >= 0 if unseeded)

DO $$
DECLARE
  c_users                 bigint;
  c_companies             bigint;
  c_identities            bigint;
  c_session               bigint;
  c_invitations           bigint;
  c_company_settings      bigint;
  c_business_hours        bigint;
  c_jobs                  bigint;
  c_invoices              bigint;
  c_quotes                bigint;
  c_client_locations      bigint;
  c_customer_companies    bigint;
  c_audit_events          bigint;
  c_audit_logs            bigint;
  c_roles                 bigint;
  c_permissions           bigint;
  c_role_permissions      bigint;
  c_subscription_plans    bigint;
  c_schema_migrations     bigint;
BEGIN
  SELECT count(*) INTO c_users                 FROM users;
  SELECT count(*) INTO c_companies             FROM companies;
  SELECT count(*) INTO c_identities            FROM user_identities;
  SELECT count(*) INTO c_session               FROM session;
  SELECT count(*) INTO c_invitations           FROM invitations;
  SELECT count(*) INTO c_company_settings      FROM company_settings;
  SELECT count(*) INTO c_business_hours        FROM company_business_hours;
  SELECT count(*) INTO c_jobs                  FROM jobs;
  SELECT count(*) INTO c_invoices              FROM invoices;
  SELECT count(*) INTO c_quotes                FROM quotes;
  SELECT count(*) INTO c_client_locations      FROM client_locations;
  SELECT count(*) INTO c_customer_companies    FROM customer_companies;
  SELECT count(*) INTO c_audit_events          FROM audit_events;
  SELECT count(*) INTO c_audit_logs            FROM audit_logs;
  SELECT count(*) INTO c_roles                 FROM roles;
  SELECT count(*) INTO c_permissions           FROM permissions;
  SELECT count(*) INTO c_role_permissions      FROM role_permissions;
  SELECT count(*) INTO c_subscription_plans    FROM subscription_plans;
  SELECT count(*) INTO c_schema_migrations     FROM schema_migrations;

  RAISE NOTICE '---- OPERATIONAL TABLES (expect 0) ----';
  RAISE NOTICE 'users                %', c_users;
  RAISE NOTICE 'companies            %', c_companies;
  RAISE NOTICE 'user_identities      %', c_identities;
  RAISE NOTICE 'session              %', c_session;
  RAISE NOTICE 'invitations          %', c_invitations;
  RAISE NOTICE 'company_settings     %', c_company_settings;
  RAISE NOTICE 'company_business_hours %', c_business_hours;
  RAISE NOTICE 'jobs                 %', c_jobs;
  RAISE NOTICE 'invoices             %', c_invoices;
  RAISE NOTICE 'quotes               %', c_quotes;
  RAISE NOTICE 'client_locations     %', c_client_locations;
  RAISE NOTICE 'customer_companies   %', c_customer_companies;
  RAISE NOTICE 'audit_events         %', c_audit_events;
  RAISE NOTICE 'audit_logs           %', c_audit_logs;
  RAISE NOTICE '---- PRESERVED CATALOGS ----';
  RAISE NOTICE 'roles                %', c_roles;
  RAISE NOTICE 'permissions          %', c_permissions;
  RAISE NOTICE 'role_permissions     %', c_role_permissions;
  RAISE NOTICE 'subscription_plans   %', c_subscription_plans;
  RAISE NOTICE 'schema_migrations    %', c_schema_migrations;
END $$;
