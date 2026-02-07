-- Migration: Bump job numbers to 6 digits (100000+)
-- Date: 2026-02-06
--
-- This migration updates existing company_counters to use 6-digit job numbers.
-- Companies still using the old 5-digit range (10000-99999) are bumped to 100000.
-- Companies already at or above 100000 are unaffected.
--
-- Run with:
--   psql "$DATABASE_URL" -f migrations/2026_02_06_bump_job_numbers_to_6_digits.sql
--
-- Note: This is safe to run multiple times (idempotent).

-- Bump any company still in the old 5-digit range to 6-digit
UPDATE company_counters
SET next_job_number = 100000
WHERE next_job_number < 100000;

-- Verify results
SELECT
  COUNT(*) as total_companies,
  COUNT(*) FILTER (WHERE next_job_number >= 100000) as companies_at_6_digits,
  MIN(next_job_number) as min_job_number,
  MAX(next_job_number) as max_job_number
FROM company_counters;
