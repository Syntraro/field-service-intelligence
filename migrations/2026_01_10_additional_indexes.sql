-- ============================================================================
-- ADDITIONAL PERFORMANCE INDEXES
-- Migration: 2026_01_10_additional_indexes
-- Adds compound indexes identified in codebase audit
-- ============================================================================

-- Calendar Assignments: Company + Client + Date (for client-specific calendar queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calendar_company_client_date
ON calendar_assignments(company_id, client_id, scheduled_date);

-- Job Parts: Job + Product (for parts lookup during invoice generation)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_parts_job_product
ON job_parts(job_id, product_id);

-- Location PM Part Templates: Location + Product (for PM template lookups)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_location_pm_parts_location_product
ON location_pm_part_templates(location_id, product_id);

-- Client Notes: Client + CreatedAt (for chronological note listing)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_client_notes_client_created
ON client_notes(client_id, created_at DESC);

-- Job Notes: Job + CreatedAt (for chronological note listing)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_notes_job_created
ON job_notes(job_id, created_at DESC);

-- Job Notes: Company (for tenant isolation)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_notes_company_id
ON job_notes(company_id);

-- Items: Company + Active (for products/services lists)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_items_company_active
ON items(company_id, is_active)
WHERE deleted_at IS NULL;

-- Items: Full-text search
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_items_search
ON items USING gin(to_tsvector('english',
  coalesce(name, '') || ' ' ||
  coalesce(sku, '') || ' ' ||
  coalesce(description, '')
))
WHERE deleted_at IS NULL AND is_active = true;

-- Location Equipment: Location (for equipment lists)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_location_equipment_location
ON location_equipment(location_id)
WHERE is_active = true;

-- Client Parts: Client (for parts lookup)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_client_parts_client
ON client_parts(client_id);

-- Job Visits: Job (for visit history)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_visits_job
ON job_visits(job_id);

-- Update statistics for new indexes
ANALYZE calendar_assignments;
ANALYZE job_parts;
ANALYZE location_pm_part_templates;
ANALYZE client_notes;
ANALYZE job_notes;
ANALYZE items;
ANALYZE location_equipment;
ANALYZE client_parts;
