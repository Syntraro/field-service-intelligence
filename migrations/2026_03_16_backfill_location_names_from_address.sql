-- Migration: Repair location names that defaulted to parent company name
-- Run: npm run db:migrate:one -- migrations/2026_03_16_backfill_location_names_from_address.sql
--
-- Context: The CSV importer previously fell back to company name when location name
-- was blank (e.g., Jobber "Property" column not mapped). This left multi-location
-- clients with every child location named identically (the company name).
--
-- Matching logic:
--   1. Location must belong to a parent company (parent_company_id IS NOT NULL)
--   2. Location's current name must exactly equal the parent company name
--      (i.e., it was set by the old fallback, not by the user)
--   3. The parent company must have MORE THAN ONE non-deleted location
--      (single-location companies are fine — the company name IS the right label)
--   4. Location must have a non-NULL address to build a replacement name from
--   5. Location is not soft-deleted
--
-- Replacement: "address, city" (or just "address" when city is null)
-- This matches the new executeRow() fallback: addressBasedName

UPDATE client_locations cl
SET
  location = cl.address || COALESCE(', ' || cl.city, ''),
  updated_at = NOW()
FROM customer_companies cc
WHERE cl.parent_company_id = cc.id
  AND cl.location = cc.name
  AND cl.address IS NOT NULL
  AND cl.deleted_at IS NULL
  -- Only repair multi-location companies; single-location naming is fine as-is
  AND (
    SELECT COUNT(*)
    FROM client_locations sibling
    WHERE sibling.parent_company_id = cc.id
      AND sibling.deleted_at IS NULL
  ) > 1;
