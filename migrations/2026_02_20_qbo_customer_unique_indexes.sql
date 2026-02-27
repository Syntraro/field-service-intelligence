-- Migration: Add unique partial indexes on QBO customer IDs
-- Prevents duplicate QBO customer mappings within a tenant
-- Run: psql "$DATABASE_URL" -f migrations/2026_02_20_qbo_customer_unique_indexes.sql
-- DO NOT use -1 or --single-transaction (contains CONCURRENTLY)

-- Step 1: Check for duplicates before adding constraints
-- If this returns rows, resolve them before proceeding
DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT company_id, qbo_customer_id, COUNT(*) as cnt
    FROM customer_companies
    WHERE qbo_customer_id IS NOT NULL
    GROUP BY company_id, qbo_customer_id
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Found % duplicate qbo_customer_id values in customer_companies. Resolve before applying index.', dup_count;
  END IF;

  SELECT COUNT(*) INTO dup_count FROM (
    SELECT company_id, qbo_customer_id, COUNT(*) as cnt
    FROM client_locations
    WHERE qbo_customer_id IS NOT NULL
    GROUP BY company_id, qbo_customer_id
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Found % duplicate qbo_customer_id values in client_locations. Resolve before applying index.', dup_count;
  END IF;
END $$;

-- Step 2: Create partial unique indexes (CONCURRENTLY for zero-downtime)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS customer_companies_company_qbo_customer_id_uq
  ON customer_companies (company_id, qbo_customer_id)
  WHERE qbo_customer_id IS NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS client_locations_company_qbo_customer_id_uq
  ON client_locations (company_id, qbo_customer_id)
  WHERE qbo_customer_id IS NOT NULL;
