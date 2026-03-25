-- Migration: Backfill location service addresses from parent company billing addresses
-- Run: npm run db:migrate:one -- migrations/2026_03_16_backfill_location_address_from_billing.sql
--
-- Context: CSV import stored street addresses on customer_companies.billing_street
-- but left client_locations.address NULL when CSV only had billing address columns
-- (e.g., Jobber exports with "Billing Address 1" but no "Property Address 1").
-- This migration copies billing address to location service address where:
--   1. Location address is currently NULL
--   2. Parent company has a non-NULL billing_street
--   3. Location is not soft-deleted

UPDATE client_locations cl
SET
  address = cc.billing_street,
  address2 = COALESCE(cl.address2, cc.billing_street2),
  city = COALESCE(cl.city, cc.billing_city),
  province = COALESCE(cl.province, cc.billing_province),
  postal_code = COALESCE(cl.postal_code, cc.billing_postal_code),
  country = COALESCE(cl.country, cc.billing_country),
  updated_at = NOW()
FROM customer_companies cc
WHERE cl.parent_company_id = cc.id
  AND cl.address IS NULL
  AND cc.billing_street IS NOT NULL
  AND cl.deleted_at IS NULL;
