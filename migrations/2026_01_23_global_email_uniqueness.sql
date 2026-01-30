-- Migration: Enforce global email uniqueness across all tenants
-- Each email can only belong to one company - simplifies login (no tenant selection needed)
-- Users working for multiple companies must use different email addresses.

-- ============================================================================
-- Step 1: Normalize existing email identifiers (backfill)
-- ============================================================================

UPDATE user_identities
SET identifier = LOWER(TRIM(identifier)),
    updated_at = CURRENT_TIMESTAMP
WHERE provider = 'email'
  AND identifier != LOWER(TRIM(identifier));

-- ============================================================================
-- Step 2: Create partial unique index for global email uniqueness
-- ============================================================================
-- This prevents the same email from being used in multiple companies.
-- The partial index only applies to provider='email' identities.

CREATE UNIQUE INDEX IF NOT EXISTS user_identities_email_global_unique
  ON user_identities (LOWER(identifier))
  WHERE provider = 'email';

-- ============================================================================
-- Verification query (check for any duplicate emails that would violate constraint)
-- Run this BEFORE the migration to identify conflicts:
-- ============================================================================
-- SELECT identifier, COUNT(*) as count, array_agg(company_id) as companies
-- FROM user_identities
-- WHERE provider = 'email'
-- GROUP BY LOWER(identifier)
-- HAVING COUNT(*) > 1;
