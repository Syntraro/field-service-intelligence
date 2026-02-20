-- Customer Portal: Magic Link Tokens + Feature Flags
-- Run: psql "$DATABASE_URL" -f migrations/2026_02_15_customer_portal.sql
-- DO NOT use -1 or --single-transaction (contains CONCURRENTLY index)

-- 1. Portal magic link tokens table
CREATE TABLE IF NOT EXISTS portal_magic_tokens (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id VARCHAR NOT NULL REFERENCES client_contacts(id) ON DELETE CASCADE,
  customer_company_id VARCHAR NOT NULL REFERENCES customer_companies(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  email TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS portal_magic_tokens_hash_idx ON portal_magic_tokens (token_hash);
CREATE INDEX IF NOT EXISTS portal_magic_tokens_email_idx ON portal_magic_tokens (email);
CREATE INDEX IF NOT EXISTS portal_magic_tokens_expires_idx ON portal_magic_tokens (expires_at);

-- 2. Add customer portal feature flags to tenant_features
ALTER TABLE tenant_features
  ADD COLUMN IF NOT EXISTS customer_portal_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_portal_payments_enabled BOOLEAN NOT NULL DEFAULT false;
