-- ============================================================================
-- MIGRATION: Complete locationId migration (Phase 2)
-- Date: 2026-01-12
--
-- This completes the clientId → locationId migration:
-- - Makes locationId NOT NULL (after verifying all rows have been backfilled)
-- - Makes clientId nullable (for backwards compatibility)
-- - Updates column order preference to locationId
--
-- PREREQUISITES:
-- - Phase 1 migration (2026_01_11_add_location_id_columns.sql) must be run first
-- - Storage layer must support dual-read/dual-write
--
-- ROLLBACK: This migration is reversible by swapping NOT NULL constraints back
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Safety check: Ensure all locationId values are populated
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  missing_count INTEGER;
BEGIN
  -- Check client_parts
  SELECT COUNT(*) INTO missing_count FROM client_parts WHERE location_id IS NULL;
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'client_parts has % rows with NULL location_id. Run backfill first.', missing_count;
  END IF;

  -- Check maintenance_records
  SELECT COUNT(*) INTO missing_count FROM maintenance_records WHERE location_id IS NULL;
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'maintenance_records has % rows with NULL location_id. Run backfill first.', missing_count;
  END IF;

  -- Check calendar_assignments
  SELECT COUNT(*) INTO missing_count FROM calendar_assignments WHERE location_id IS NULL;
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'calendar_assignments has % rows with NULL location_id. Run backfill first.', missing_count;
  END IF;

  -- Check equipment
  SELECT COUNT(*) INTO missing_count FROM equipment WHERE location_id IS NULL;
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'equipment has % rows with NULL location_id. Run backfill first.', missing_count;
  END IF;

  -- Check client_notes
  SELECT COUNT(*) INTO missing_count FROM client_notes WHERE location_id IS NULL;
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'client_notes has % rows with NULL location_id. Run backfill first.', missing_count;
  END IF;

  -- Note: tasks.location_id can be NULL (it's optional)

  RAISE NOTICE 'All locationId columns are properly populated. Proceeding with migration.';
END $$;

-- ----------------------------------------------------------------------------
-- 1. client_parts: Make locationId NOT NULL, clientId nullable
-- ----------------------------------------------------------------------------
ALTER TABLE client_parts
ALTER COLUMN location_id SET NOT NULL;

ALTER TABLE client_parts
ALTER COLUMN client_id DROP NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. maintenance_records: Make locationId NOT NULL, clientId nullable
-- ----------------------------------------------------------------------------
ALTER TABLE maintenance_records
ALTER COLUMN location_id SET NOT NULL;

ALTER TABLE maintenance_records
ALTER COLUMN client_id DROP NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. calendar_assignments: Make locationId NOT NULL, clientId nullable
-- ----------------------------------------------------------------------------
ALTER TABLE calendar_assignments
ALTER COLUMN location_id SET NOT NULL;

ALTER TABLE calendar_assignments
ALTER COLUMN client_id DROP NOT NULL;

-- ----------------------------------------------------------------------------
-- 4. equipment: Make locationId NOT NULL, clientId nullable
-- ----------------------------------------------------------------------------
ALTER TABLE equipment
ALTER COLUMN location_id SET NOT NULL;

ALTER TABLE equipment
ALTER COLUMN client_id DROP NOT NULL;

-- ----------------------------------------------------------------------------
-- 5. client_notes: Make locationId NOT NULL, clientId nullable
-- ----------------------------------------------------------------------------
ALTER TABLE client_notes
ALTER COLUMN location_id SET NOT NULL;

ALTER TABLE client_notes
ALTER COLUMN client_id DROP NOT NULL;

-- ----------------------------------------------------------------------------
-- 6. tasks: locationId remains nullable (by design), clientId stays nullable
-- ----------------------------------------------------------------------------
-- No changes needed - both columns are nullable for tasks

-- ----------------------------------------------------------------------------
-- Update statistics
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
-- Storage layer changes needed:
-- 1. Read from locationId primarily (with clientId fallback for legacy data)
-- 2. Write to locationId only (stop dual-write to clientId)
-- 3. Future: Drop clientId columns after burn-in period
-- ============================================================================
