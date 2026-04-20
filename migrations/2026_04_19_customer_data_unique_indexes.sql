-- 2026-04-19 Customer Data Integrity hardening — three partial unique
-- indexes on customer_companies + client_locations.
--
-- ARCHITECTURAL NOTE — NO `deleted_at` SCOPE:
--   Per the 2026-04-19 directive, soft-delete is being phased out as the
--   canonical delete strategy. New constraints DO NOT scope around
--   `deleted_at IS NULL`. Instead, we scope on the existing canonical
--   active flags that are already in production:
--     - `customer_companies.is_active = true`
--     - `client_locations.inactive = false`
--   The application's soft-delete code paths set BOTH the deleted_at
--   timestamp AND the inactive flag together (see
--   server/storage/customerCompanies.ts:1164,1176), so existing
--   soft-deleted rows are automatically excluded from these indexes
--   without referencing deleted_at directly. New hard-delete code paths
--   (going forward) leave no residual rows; the active-state scope
--   handles both transition states cleanly.
--
-- LIVE DUPLICATE SCAN (RAW, no soft-delete filter applied) on this DB:
--     customer_companies — 0 duplicate (company_id, name_normalized) groups
--     client_locations (child)  — 0 duplicate (parent_company_id, lower(location)) groups
--     client_locations (orphan) — 0 duplicate (company_id, lower(company_name)) groups
--   Safe to ship without a separate consolidation pass.
--
-- HELPERS LANDING IN THE SAME RELEASE:
--   - `customerCompanyRepository.createOrGetCustomerCompany` — primary
--     dedupe at the application layer (returns {customerCompany, created}).
--   - `clientRepository.createOrGetLocation` (and Tx variant) — handles
--     both child + orphan natural keys via the same lookup predicates
--     these indexes enforce. Every direct API route now goes through it.
--
-- The helpers are the primary dedupe; these indexes are the safety net
-- for races (concurrent tabs, double-submits, bulk paths that bypass
-- the helper) and the single source of truth for production correctness.
--
-- Run via: npm run db:migrate (CONCURRENTLY → migration runner dispatches
-- statements outside the implicit transaction block).

-- ============================================================================
-- 1. customer_companies — (company_id, name_normalized) within active rows
-- ============================================================================

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS customer_companies_company_name_normalized_active_uq
  ON customer_companies (company_id, name_normalized)
  WHERE is_active = true AND name_normalized IS NOT NULL AND name_normalized <> '';

-- ============================================================================
-- 2. client_locations (child) — (parent_company_id, lower(location)) within active rows
-- ============================================================================
-- Scoped to rows with a non-null parent_company_id and a meaningful
-- location text. Quick-create flows that defer location naming (location
-- IS NULL or empty) intentionally fall outside this constraint.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS client_locations_parent_location_lower_active_uq
  ON client_locations (parent_company_id, lower(location))
  WHERE inactive = false
    AND parent_company_id IS NOT NULL
    AND location IS NOT NULL
    AND TRIM(location) <> '';

-- ============================================================================
-- 3. client_locations (orphan) — (company_id, lower(company_name)) within active rows
-- ============================================================================
-- Orphan locations are standalone client records with no parent
-- customer_company. Dedupe key is (tenant, lower(company_name)).
-- Same active-state scope as the child index.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS client_locations_orphan_company_name_lower_active_uq
  ON client_locations (company_id, lower(company_name))
  WHERE inactive = false
    AND parent_company_id IS NULL
    AND company_name IS NOT NULL
    AND TRIM(company_name) <> '';
