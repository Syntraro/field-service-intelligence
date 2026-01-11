-- ============================================================================
-- MIGRATION: Soft Delete Standardization
-- Date: 2026-01-11
--
-- GOAL: Standardize soft delete to use deletedAt TIMESTAMP as canonical mechanism
--   - Active row: deletedAt IS NULL
--   - Soft-deleted row: deletedAt IS NOT NULL
--
-- SCOPE: Tables with isActive only (need deletedAt added)
-- Already OK: users, client_locations (deletedAt only)
-- Mixed (need sync): customer_companies, items, equipment
-- isActive only: invoices, jobs, job_parts, job_templates, location_equipment,
--                location_pm_part_templates, location_pm_plans, recurring_job_series,
--                suppliers, supplier_locations, technicians
--
-- RULES:
-- - isActive columns are NOT removed (transition period)
-- - Both columns will coexist with dual-write
-- - deletedAt is source of truth going forward
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PHASE 1A: Add deletedAt to tables that only have isActive
-- ----------------------------------------------------------------------------

-- invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_invoices_deleted_at ON invoices(deleted_at);
CREATE INDEX IF NOT EXISTS idx_invoices_company_deleted ON invoices(company_id, deleted_at);

-- jobs
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_jobs_deleted_at ON jobs(deleted_at);
CREATE INDEX IF NOT EXISTS idx_jobs_company_deleted ON jobs(company_id, deleted_at);

-- job_parts
ALTER TABLE job_parts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_job_parts_deleted_at ON job_parts(deleted_at);

-- job_templates
ALTER TABLE job_templates ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_job_templates_deleted_at ON job_templates(deleted_at);
CREATE INDEX IF NOT EXISTS idx_job_templates_company_deleted ON job_templates(company_id, deleted_at);

-- location_equipment
ALTER TABLE location_equipment ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_location_equipment_deleted_at ON location_equipment(deleted_at);
CREATE INDEX IF NOT EXISTS idx_location_equipment_location_deleted ON location_equipment(location_id, deleted_at);

-- location_pm_part_templates
ALTER TABLE location_pm_part_templates ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_location_pm_part_templates_deleted_at ON location_pm_part_templates(deleted_at);

-- location_pm_plans
ALTER TABLE location_pm_plans ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_location_pm_plans_deleted_at ON location_pm_plans(deleted_at);

-- recurring_job_series
ALTER TABLE recurring_job_series ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_recurring_job_series_deleted_at ON recurring_job_series(deleted_at);

-- suppliers
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_suppliers_deleted_at ON suppliers(deleted_at);
CREATE INDEX IF NOT EXISTS idx_suppliers_company_deleted ON suppliers(company_id, deleted_at);

-- supplier_locations
ALTER TABLE supplier_locations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_supplier_locations_deleted_at ON supplier_locations(deleted_at);

-- technicians
ALTER TABLE technicians ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_technicians_deleted_at ON technicians(deleted_at);
CREATE INDEX IF NOT EXISTS idx_technicians_company_deleted ON technicians(company_id, deleted_at);

-- ----------------------------------------------------------------------------
-- PHASE 1B: Backfill deletedAt based on isActive
-- Rule: isActive = false => deletedAt = NOW()
--       isActive = true  => deletedAt = NULL (already default)
-- ----------------------------------------------------------------------------

-- Backfill invoices
UPDATE invoices SET deleted_at = CURRENT_TIMESTAMP 
WHERE is_active = false AND deleted_at IS NULL;

-- Backfill jobs
UPDATE jobs SET deleted_at = CURRENT_TIMESTAMP 
WHERE is_active = false AND deleted_at IS NULL;

-- Backfill job_parts
UPDATE job_parts SET deleted_at = CURRENT_TIMESTAMP 
WHERE is_active = false AND deleted_at IS NULL;

-- Backfill job_templates
UPDATE job_templates SET deleted_at = CURRENT_TIMESTAMP 
WHERE is_active = false AND deleted_at IS NULL;

-- Backfill location_equipment
UPDATE location_equipment SET deleted_at = CURRENT_TIMESTAMP 
WHERE is_active = false AND deleted_at IS NULL;

-- Backfill location_pm_part_templates
UPDATE location_pm_part_templates SET deleted_at = CURRENT_TIMESTAMP 
WHERE is_active = false AND deleted_at IS NULL;

-- Backfill location_pm_plans
UPDATE location_pm_plans SET deleted_at = CURRENT_TIMESTAMP 
WHERE is_active = false AND deleted_at IS NULL;

-- Backfill recurring_job_series
UPDATE recurring_job_series SET deleted_at = CURRENT_TIMESTAMP 
WHERE is_active = false AND deleted_at IS NULL;

-- Backfill suppliers
UPDATE suppliers SET deleted_at = CURRENT_TIMESTAMP 
WHERE is_active = false AND deleted_at IS NULL;

-- Backfill supplier_locations
UPDATE supplier_locations SET deleted_at = CURRENT_TIMESTAMP 
WHERE is_active = false AND deleted_at IS NULL;

-- Backfill technicians
UPDATE technicians SET deleted_at = CURRENT_TIMESTAMP 
WHERE is_active = false AND deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- PHASE 1C: Sync tables that have both columns (ensure consistency)
-- ----------------------------------------------------------------------------

-- customer_companies: sync deletedAt with isActive
UPDATE customer_companies SET deleted_at = CURRENT_TIMESTAMP 
WHERE is_active = false AND deleted_at IS NULL;
UPDATE customer_companies SET deleted_at = NULL 
WHERE is_active = true AND deleted_at IS NOT NULL;

-- items: sync deletedAt with isActive
UPDATE items SET deleted_at = CURRENT_TIMESTAMP 
WHERE is_active = false AND deleted_at IS NULL;
UPDATE items SET deleted_at = NULL 
WHERE is_active = true AND deleted_at IS NOT NULL;

-- equipment: sync deletedAt with isActive
UPDATE equipment SET deleted_at = CURRENT_TIMESTAMP 
WHERE is_active = false AND deleted_at IS NULL;
UPDATE equipment SET deleted_at = NULL 
WHERE is_active = true AND deleted_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Update statistics for query planner
-- ----------------------------------------------------------------------------
ANALYZE invoices;
ANALYZE jobs;
ANALYZE job_parts;
ANALYZE job_templates;
ANALYZE location_equipment;
ANALYZE location_pm_part_templates;
ANALYZE location_pm_plans;
ANALYZE recurring_job_series;
ANALYZE suppliers;
ANALYZE supplier_locations;
ANALYZE technicians;
ANALYZE customer_companies;
ANALYZE items;
ANALYZE equipment;

-- ============================================================================
-- END OF MIGRATION
--
-- Next steps:
-- 1. Update storage layer for dual-read/dual-write
-- 2. Verify all list queries use deletedAt IS NULL
-- 3. Future: Remove isActive columns after burn-in period
-- ============================================================================
