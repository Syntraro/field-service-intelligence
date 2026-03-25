-- Migration: Add name_normalized column to customer_companies for case-insensitive dedup
-- Purpose: CSV import hardening — normalized company name matching for idempotent re-imports
-- Run: npm run db:migrate:one -- migrations/2026_03_15_customer_companies_name_normalized.sql

-- Step 1: Add column with default
ALTER TABLE customer_companies
  ADD COLUMN IF NOT EXISTS name_normalized text NOT NULL DEFAULT '';

-- Step 2: Backfill from existing name values
-- normalizeForMatch: trim → collapse whitespace → lowercase
UPDATE customer_companies
  SET name_normalized = lower(trim(regexp_replace(name, '\s+', ' ', 'g')))
  WHERE name_normalized = '';

-- Step 3: Create index for fast lookup during import
-- Only index non-deleted companies (partial index)
CREATE INDEX IF NOT EXISTS idx_customer_companies_name_normalized
  ON customer_companies (company_id, name_normalized)
  WHERE deleted_at IS NULL;
