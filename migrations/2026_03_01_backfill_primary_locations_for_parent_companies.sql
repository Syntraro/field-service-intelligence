-- Backfill: create primary client_locations for customer_companies that have none.
-- Parent companies without any location are invisible on the Clients page (which queries
-- client_locations only). This creates a "Main" primary location inheriting parent address/contact.
-- Idempotent: NOT EXISTS prevents duplicates on re-run.
-- Run: psql "$DATABASE_URL" -f migrations/2026_03_01_backfill_primary_locations_for_parent_companies.sql

INSERT INTO client_locations (company_id, parent_company_id, company_name, location, address, city, province, postal_code, email, phone, inactive, is_primary, selected_months)
SELECT
  cc.company_id,
  cc.id AS parent_company_id,
  cc.name AS company_name,
  'Main' AS location,
  cc.billing_street AS address,
  cc.billing_city AS city,
  cc.billing_province AS province,
  cc.billing_postal_code AS postal_code,
  cc.email,
  cc.phone,
  NOT cc.is_active AS inactive,
  true AS is_primary,
  ARRAY[]::int[] AS selected_months
FROM customer_companies cc
WHERE cc.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM client_locations cl
    WHERE cl.parent_company_id = cc.id
      AND cl.company_id = cc.company_id
      AND cl.deleted_at IS NULL
  );
