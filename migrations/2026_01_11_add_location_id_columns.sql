-- ============================================================================
-- MIGRATION: Add locationId columns for clientId → locationId transition
-- Date: 2026-01-11
--
-- This is Phase 1 of the domain model migration. It adds locationId columns
-- to tables that currently use clientId to reference service locations.
--
-- BACKFILL LOGIC:
-- Since clientId already references client_locations(id), the backfill is
-- simply: location_id = client_id. They point to the same table.
--
-- IMPORTANT:
-- - clientId columns are NOT removed in this migration
-- - Both columns will coexist during the transition period
-- - Storage layer will handle dual-read/dual-write
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. client_parts table
-- ----------------------------------------------------------------------------
ALTER TABLE client_parts
ADD COLUMN IF NOT EXISTS location_id VARCHAR;

-- Backfill: location_id = client_id (same FK target)
UPDATE client_parts
SET location_id = client_id
WHERE location_id IS NULL AND client_id IS NOT NULL;

-- Add foreign key constraint
ALTER TABLE client_parts
ADD CONSTRAINT fk_client_parts_location
FOREIGN KEY (location_id) REFERENCES client_locations(id) ON DELETE RESTRICT;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_client_parts_location_id
ON client_parts(location_id);

-- ----------------------------------------------------------------------------
-- 2. maintenance_records table
-- ----------------------------------------------------------------------------
ALTER TABLE maintenance_records
ADD COLUMN IF NOT EXISTS location_id VARCHAR;

-- Backfill
UPDATE maintenance_records
SET location_id = client_id
WHERE location_id IS NULL AND client_id IS NOT NULL;

-- Add foreign key constraint
ALTER TABLE maintenance_records
ADD CONSTRAINT fk_maintenance_records_location
FOREIGN KEY (location_id) REFERENCES client_locations(id) ON DELETE RESTRICT;

-- Add index
CREATE INDEX IF NOT EXISTS idx_maintenance_records_location_id
ON maintenance_records(location_id);

-- ----------------------------------------------------------------------------
-- 3. calendar_assignments table
-- ----------------------------------------------------------------------------
ALTER TABLE calendar_assignments
ADD COLUMN IF NOT EXISTS location_id VARCHAR;

-- Backfill
UPDATE calendar_assignments
SET location_id = client_id
WHERE location_id IS NULL AND client_id IS NOT NULL;

-- Add foreign key constraint
ALTER TABLE calendar_assignments
ADD CONSTRAINT fk_calendar_assignments_location
FOREIGN KEY (location_id) REFERENCES client_locations(id) ON DELETE RESTRICT;

-- Add index (compound with company_id for common queries)
CREATE INDEX IF NOT EXISTS idx_calendar_assignments_location_id
ON calendar_assignments(location_id);

CREATE INDEX IF NOT EXISTS idx_calendar_company_location_date
ON calendar_assignments(company_id, location_id, scheduled_date);

-- ----------------------------------------------------------------------------
-- 4. equipment table
-- ----------------------------------------------------------------------------
ALTER TABLE equipment
ADD COLUMN IF NOT EXISTS location_id VARCHAR;

-- Backfill
UPDATE equipment
SET location_id = client_id
WHERE location_id IS NULL AND client_id IS NOT NULL;

-- Add foreign key constraint
ALTER TABLE equipment
ADD CONSTRAINT fk_equipment_location
FOREIGN KEY (location_id) REFERENCES client_locations(id) ON DELETE RESTRICT;

-- Add index
CREATE INDEX IF NOT EXISTS idx_equipment_location_id
ON equipment(location_id);

-- ----------------------------------------------------------------------------
-- 5. client_notes table
-- ----------------------------------------------------------------------------
ALTER TABLE client_notes
ADD COLUMN IF NOT EXISTS location_id VARCHAR;

-- Backfill
UPDATE client_notes
SET location_id = client_id
WHERE location_id IS NULL AND client_id IS NOT NULL;

-- Add foreign key constraint
ALTER TABLE client_notes
ADD CONSTRAINT fk_client_notes_location
FOREIGN KEY (location_id) REFERENCES client_locations(id) ON DELETE RESTRICT;

-- Add index
CREATE INDEX IF NOT EXISTS idx_client_notes_location_id
ON client_notes(location_id);

-- ----------------------------------------------------------------------------
-- 6. tasks table (nullable - different handling)
-- ----------------------------------------------------------------------------
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS location_id VARCHAR;

-- Backfill (client_id is nullable here, so some may remain NULL)
UPDATE tasks
SET location_id = client_id
WHERE location_id IS NULL AND client_id IS NOT NULL;

-- Add foreign key constraint (ON DELETE SET NULL to match clientId behavior)
ALTER TABLE tasks
ADD CONSTRAINT fk_tasks_location
FOREIGN KEY (location_id) REFERENCES client_locations(id) ON DELETE SET NULL;

-- Add index
CREATE INDEX IF NOT EXISTS idx_tasks_location_id
ON tasks(location_id);

-- Compound index for common queries
CREATE INDEX IF NOT EXISTS idx_tasks_company_location
ON tasks(company_id, location_id);

-- ----------------------------------------------------------------------------
-- Update statistics for query planner
-- ----------------------------------------------------------------------------
ANALYZE client_parts;
ANALYZE maintenance_records;
ANALYZE calendar_assignments;
ANALYZE equipment;
ANALYZE client_notes;
ANALYZE tasks;

-- ============================================================================
-- END OF MIGRATION
--
-- Next steps (NOT in this migration):
-- 1. Update storage layer for dual-read/dual-write
-- 2. Verify all reads/writes work correctly
-- 3. Future: Make locationId NOT NULL and drop clientId
-- ============================================================================
