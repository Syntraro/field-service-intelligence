-- ========================================
-- Migration: Add pg_trgm indexes for universal search
-- Date: 2026-02-04
-- Phase 2 of RALPH global search implementation
--
-- EXECUTION:
--   psql "$DATABASE_URL" -f migrations/2026_02_04_add_search_trgm_indexes.sql
--
-- NOTE: Uses CREATE INDEX CONCURRENTLY - do NOT wrap in transaction
-- ========================================

-- Enable pg_trgm extension for fuzzy text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ========================================
-- TRIGRAM INDEXES (GIN) for ILIKE performance
-- ========================================

-- customer_companies.name - fuzzy company name search
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_companies_name_trgm
  ON customer_companies USING gin (name gin_trgm_ops);

-- client_locations.company_name - fuzzy location name search
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_client_locations_company_name_trgm
  ON client_locations USING gin (company_name gin_trgm_ops);

-- client_locations.address - fuzzy address search
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_client_locations_address_trgm
  ON client_locations USING gin (address gin_trgm_ops);

-- jobs.summary - fuzzy job summary search
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_summary_trgm
  ON jobs USING gin (summary gin_trgm_ops);

-- suppliers.name - fuzzy supplier name search
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_suppliers_name_trgm
  ON suppliers USING gin (name gin_trgm_ops);

-- ========================================
-- B-TREE INDEXES for exact/prefix matching
-- ========================================

-- jobs.job_number - exact/prefix job number search (compound with company_id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_company_job_number
  ON jobs (company_id, job_number);

-- invoices.invoice_number - exact/prefix invoice number search (compound with company_id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_company_invoice_number
  ON invoices (company_id, invoice_number);

-- ========================================
-- VERIFICATION
-- ========================================
SELECT indexname, tablename
FROM pg_indexes
WHERE indexname LIKE '%trgm%' OR indexname LIKE '%search%' OR indexname IN ('idx_jobs_company_job_number', 'idx_invoices_company_invoice_number');
