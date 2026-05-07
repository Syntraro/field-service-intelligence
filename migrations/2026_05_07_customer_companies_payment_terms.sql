-- =====================================================================
-- Migration: 2026-05-07 — customer_companies.payment_terms_days
-- =====================================================================
-- Adds an optional client-level invoice payment-terms default to the
-- canonical `customer_companies` table. NULL = "use the company-wide
-- default" (the existing `companies.default_payment_terms_days`
-- setting), which is the documented behaviour exposed in the Edit
-- Client dialog as the "Use company default" option.
--
-- Why
-- ---
-- New invoices for a client should default their payment terms from
-- the client record when one is set, falling back to the tenant
-- default when not. Without this column, every invoice fell straight
-- through to the tenant default (or 30 days if absent), and there
-- was no way to express "this client always pays Net 7" without
-- editing each invoice.
--
-- Run with
-- --------
--   npm run db:migrate:one -- migrations/2026_05_07_customer_companies_payment_terms.sql
--
-- Idempotent — `IF NOT EXISTS` guard skips the column add on re-run.
-- =====================================================================

ALTER TABLE customer_companies
  ADD COLUMN IF NOT EXISTS payment_terms_days integer;

COMMENT ON COLUMN customer_companies.payment_terms_days IS
  'Per-client invoice payment terms in days. NULL = inherit from companies.default_payment_terms_days. New invoices default in the chain: invoice override > customer_companies.payment_terms_days > companies.default_payment_terms_days > 30.';
