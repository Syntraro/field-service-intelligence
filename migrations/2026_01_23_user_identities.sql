-- Migration: Add user_identities table for email + SSO identity model
-- This allows separating login credentials from user identity, enabling:
-- 1. Safe email changes without breaking login
-- 2. Multiple SSO providers per user
-- 3. Multi-tenant email uniqueness (same email can exist in different companies)

-- ============================================================================
-- Step 1: Create user_identities table
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_identities (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- 'email', 'google', 'microsoft', 'apple'
  identifier TEXT NOT NULL, -- email address or SSO subject ID (lowercased for email)
  password_hash TEXT, -- only populated for provider='email'
  verified_at TIMESTAMP, -- when identity was verified
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraint: one provider+identifier per company (multi-tenant safe)
CREATE UNIQUE INDEX IF NOT EXISTS user_identities_company_provider_identifier_idx
  ON user_identities(company_id, provider, identifier);

-- Index for finding all identities for a user within a company
CREATE INDEX IF NOT EXISTS user_identities_user_id_idx
  ON user_identities(company_id, user_id);

-- ============================================================================
-- Step 2: Backfill existing users into user_identities
-- ============================================================================

-- For each existing user, create an email identity with their current credentials
INSERT INTO user_identities (company_id, user_id, provider, identifier, password_hash, verified_at, created_at, updated_at)
SELECT
  company_id,
  id AS user_id,
  'email' AS provider,
  LOWER(TRIM(email)) AS identifier, -- normalize email
  password AS password_hash,
  CURRENT_TIMESTAMP AS verified_at, -- treat existing users as verified
  created_at,
  CURRENT_TIMESTAMP AS updated_at
FROM users
WHERE email IS NOT NULL
  AND email != ''
  AND NOT EXISTS (
    -- Don't duplicate if already migrated
    SELECT 1 FROM user_identities ui
    WHERE ui.user_id = users.id
      AND ui.provider = 'email'
      AND ui.company_id = users.company_id
  );

-- ============================================================================
-- Step 3: Ensure users.full_name column exists (for display purposes)
-- ============================================================================

-- Add full_name if it doesn't exist (it should already exist per schema)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'full_name'
  ) THEN
    ALTER TABLE users ADD COLUMN full_name TEXT;
  END IF;
END $$;

-- Backfill full_name from first_name + last_name where missing
UPDATE users
SET full_name = TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
WHERE full_name IS NULL
  AND (first_name IS NOT NULL OR last_name IS NOT NULL)
  AND TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) != '';

-- For users with no name at all, try to derive from email
UPDATE users
SET full_name = INITCAP(REPLACE(SPLIT_PART(email, '@', 1), '.', ' '))
WHERE full_name IS NULL
  AND email IS NOT NULL
  AND email != '';

-- ============================================================================
-- Verification query (run to check migration success)
-- ============================================================================
-- SELECT
--   u.id, u.email, u.full_name,
--   ui.provider, ui.identifier, ui.verified_at
-- FROM users u
-- LEFT JOIN user_identities ui ON u.id = ui.user_id AND u.company_id = ui.company_id
-- ORDER BY u.created_at;
