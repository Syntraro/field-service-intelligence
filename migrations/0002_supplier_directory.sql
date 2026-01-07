-- ============================================================================
-- SUPPLIER DIRECTORY WITH MULTI-LOCATION SUPPORT
-- Migration: 0002_supplier_directory
-- Description: Extends suppliers with QBO sync fields and adds multi-location support
-- ============================================================================

-- ============================================================================
-- PART 1: Extend suppliers table with QBO Vendor fields and contact info
-- ============================================================================

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS qbo_vendor_id TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS qbo_sync_token TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS qbo_last_synced_at TIMESTAMP;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS qbo_sync_status TEXT DEFAULT 'NOT_SYNCED';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS qbo_sync_error TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS website TEXT;

-- Add constraint for qbo_sync_status enum values
ALTER TABLE suppliers ADD CONSTRAINT suppliers_qbo_sync_status_check
  CHECK (qbo_sync_status IN ('NOT_SYNCED', 'SYNCED', 'PENDING', 'ERROR'));

-- ============================================================================
-- PART 2: Create supplier_locations table
-- ============================================================================

CREATE TABLE IF NOT EXISTS supplier_locations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL,
  supplier_id VARCHAR NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  province TEXT,
  postal_code TEXT,
  country TEXT,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP,

  -- Foreign keys
  CONSTRAINT fk_supplier_locations_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_supplier_locations_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
);

-- ============================================================================
-- PART 3: Add indexes for supplier_locations
-- ============================================================================

-- Composite index for company + supplier lookups
CREATE INDEX IF NOT EXISTS idx_supplier_locations_company_supplier
  ON supplier_locations(company_id, supplier_id);

-- Index for active locations filtering
CREATE INDEX IF NOT EXISTS idx_supplier_locations_company_active
  ON supplier_locations(company_id, is_active);

-- Index for primary location lookups
CREATE INDEX IF NOT EXISTS idx_supplier_locations_supplier_primary
  ON supplier_locations(supplier_id, is_primary);

-- Index for supplier foreign key
CREATE INDEX IF NOT EXISTS idx_supplier_locations_supplier_id
  ON supplier_locations(supplier_id);

-- ============================================================================
-- PART 4: Extend supplier_visit_details with location reference
-- ============================================================================

ALTER TABLE supplier_visit_details ADD COLUMN IF NOT EXISTS supplier_location_id VARCHAR;

-- Add foreign key constraint
ALTER TABLE supplier_visit_details
  ADD CONSTRAINT fk_supplier_visit_details_location
  FOREIGN KEY (supplier_location_id)
  REFERENCES supplier_locations(id) ON DELETE SET NULL;

-- Add index for location lookups
CREATE INDEX IF NOT EXISTS idx_supplier_visit_details_location
  ON supplier_visit_details(supplier_location_id);

-- ============================================================================
-- PART 5: Add indexes for suppliers table (QBO and company filtering)
-- ============================================================================

-- Index for company scoped queries
CREATE INDEX IF NOT EXISTS idx_suppliers_company_id
  ON suppliers(company_id);

-- Index for active suppliers
CREATE INDEX IF NOT EXISTS idx_suppliers_company_active
  ON suppliers(company_id, is_active);

-- Index for QBO sync status queries
CREATE INDEX IF NOT EXISTS idx_suppliers_qbo_sync_status
  ON suppliers(company_id, qbo_sync_status)
  WHERE qbo_vendor_id IS NOT NULL;

-- Full-text search index for supplier names
CREATE INDEX IF NOT EXISTS idx_suppliers_search
  ON suppliers USING gin(to_tsvector('english', coalesce(name, '')));

-- ============================================================================
-- PART 6: Update statistics
-- ============================================================================

ANALYZE suppliers;
ANALYZE supplier_locations;
ANALYZE supplier_visit_details;
