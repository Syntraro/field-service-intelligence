-- Migration: Create qbo_connections table for tenant-scoped OAuth token storage
-- Date: 2026-02-20
-- Feature: QBO OAuth — store access/refresh tokens per company after Intuit OAuth flow
--
-- Run: psql "$DATABASE_URL" -f migrations/2026_02_20_qbo_connections.sql

-- ==============================================================================
-- CREATE QBO_CONNECTIONS TABLE
-- ==============================================================================

CREATE TABLE IF NOT EXISTS qbo_connections (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  environment TEXT NOT NULL DEFAULT 'sandbox',
  realm_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMP,
  connected_by_user_id VARCHAR,
  connected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP
);

-- One QBO connection per tenant
CREATE UNIQUE INDEX IF NOT EXISTS qbo_connections_company_id_uq ON qbo_connections (company_id);

-- ==============================================================================
-- VERIFICATION
-- ==============================================================================

SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'qbo_connections'
ORDER BY ordinal_position;

-- ==============================================================================
-- ROLLBACK (if needed)
-- ==============================================================================
-- DROP TABLE IF EXISTS qbo_connections;
