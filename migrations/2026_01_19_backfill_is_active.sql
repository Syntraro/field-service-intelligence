-- Migration: Backfill isActive columns to fix NULL values for legacy data
-- Date: 2026-01-19
-- Issue: Invoice list and other queries were filtering by is_active = true,
--        which excluded legacy rows where is_active was NULL

-- ============================================================================
-- Part 1: Backfill NULL values to TRUE for invoices
-- ============================================================================
UPDATE invoices
SET is_active = true
WHERE is_active IS NULL;

-- Ensure default is set (should already be true, but being explicit)
ALTER TABLE invoices ALTER COLUMN is_active SET DEFAULT true;

-- ============================================================================
-- Part 2: Backfill NULL values to TRUE for customer_companies
-- ============================================================================
UPDATE customer_companies
SET is_active = true
WHERE is_active IS NULL;

-- Ensure default is set (should already be true, but being explicit)
ALTER TABLE customer_companies ALTER COLUMN is_active SET DEFAULT true;

-- ============================================================================
-- Part 3: Backfill client_locations (uses 'inactive' not 'is_active')
-- Set NULL inactive values to FALSE (meaning they ARE active)
-- ============================================================================
UPDATE client_locations
SET inactive = false
WHERE inactive IS NULL;

-- Ensure default is set (should already be false, but being explicit)
ALTER TABLE client_locations ALTER COLUMN inactive SET DEFAULT false;

-- ============================================================================
-- Part 4: Verify counts (optional, can be run manually to verify)
-- ============================================================================
-- SELECT 'invoices' as table_name, count(*) as total,
--        count(*) FILTER (WHERE is_active IS NULL) as null_count
-- FROM invoices
-- UNION ALL
-- SELECT 'customer_companies', count(*),
--        count(*) FILTER (WHERE is_active IS NULL)
-- FROM customer_companies
-- UNION ALL
-- SELECT 'client_locations', count(*),
--        count(*) FILTER (WHERE inactive IS NULL)
-- FROM client_locations;

-- ============================================================================
-- Notes:
-- - This migration should be run ONCE to fix existing data
-- - The code has been updated to tolerate NULL values using:
--   or(eq(isActive, true), isNull(isActive))
-- - Future inserts will have the default value applied automatically
-- ============================================================================
