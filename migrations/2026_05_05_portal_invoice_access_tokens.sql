-- ============================================================================
-- Migration: 2026_05_05_portal_invoice_access_tokens
-- ============================================================================
--
-- Purpose
--   Scope-limited access tokens that let a customer view + pay ONE
--   invoice through the portal without logging in. Minted when an invoice
--   email is dispatched and embedded in the Pay Invoice URL as `?t=…`.
--   Backs the new `requireInvoiceAccess` middleware that gates
--   `GET /api/portal/invoices/:id` and `POST /api/portal/invoices/:id/payments/checkout`.
--
--   Distinct from `portal_magic_tokens` (full account magic-link login):
--     - portal_magic_tokens     → email + contact + customerCompany → full portal session
--     - portal_invoice_access_tokens (this) → ONE invoice → view+pay only, no session
--
--   Tokens are 32-byte base64url, SHA-256 hashed at rest. Default TTL
--   30 days. Revoked on first successful payment (consumed_at set).
--
-- Run instructions
--   npm run db:migrate
--   or:  npm run db:migrate:one -- migrations/2026_05_05_portal_invoice_access_tokens.sql
--
-- Rollback
--   DROP TABLE IF EXISTS portal_invoice_access_tokens;
--
-- ============================================================================

CREATE TABLE IF NOT EXISTS portal_invoice_access_tokens (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id varchar NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  company_id varchar NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_company_id varchar NOT NULL REFERENCES customer_companies(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamp NOT NULL,
  consumed_at timestamp,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS portal_invoice_access_tokens_hash_idx
  ON portal_invoice_access_tokens (token_hash);

CREATE INDEX IF NOT EXISTS portal_invoice_access_tokens_invoice_idx
  ON portal_invoice_access_tokens (invoice_id);

CREATE INDEX IF NOT EXISTS portal_invoice_access_tokens_expires_idx
  ON portal_invoice_access_tokens (expires_at);
