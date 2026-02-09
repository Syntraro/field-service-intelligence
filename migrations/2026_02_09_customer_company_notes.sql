-- Migration: Add customerCompanyId to client_notes for customer-company-level notes
-- Run: psql "$DATABASE_URL" -f migrations/2026_02_09_customer_company_notes.sql
-- DO NOT use -1 or --single-transaction (contains CONCURRENTLY)

-- 1) Add customer_company_id column (nullable FK to customer_companies)
ALTER TABLE client_notes ADD COLUMN IF NOT EXISTS customer_company_id varchar REFERENCES customer_companies(id) ON DELETE CASCADE;

-- 2) Index for customer-company-scoped note lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_client_notes_customer_company_id
  ON client_notes(customer_company_id) WHERE customer_company_id IS NOT NULL;
