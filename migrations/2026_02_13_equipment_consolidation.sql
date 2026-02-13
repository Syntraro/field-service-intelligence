-- Equipment Table Consolidation Migration
-- Phase 5 Part D2
--
-- Merges legacy `equipment` table records into canonical `location_equipment`.
-- Skips duplicates matched by (location_id, name, serial_number).
--
-- Prerequisites:
--   1. Database backup
--   2. Run DRY RUN first (Steps 1-2 only)
--   3. Verify record counts match expectations
--
-- DO NOT RUN IN PRODUCTION without explicit approval.
--
-- Execution:
--   psql "$DATABASE_URL" -f migrations/2026_02_13_equipment_consolidation.sql
--
-- This migration does NOT use CONCURRENTLY, so transaction wrapping is safe.

-- ==========================================================================
-- Step 1: DRY RUN — Count records in both tables
-- ==========================================================================

SELECT '--- STEP 1: Record counts ---' as step;

SELECT
  'Legacy equipment' as table_name,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE deleted_at IS NULL AND is_active = true) as active,
  COUNT(*) FILTER (WHERE deleted_at IS NOT NULL OR is_active = false) as inactive
FROM equipment;

SELECT
  'Canonical location_equipment' as table_name,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE deleted_at IS NULL AND is_active = true) as active,
  COUNT(*) FILTER (WHERE deleted_at IS NOT NULL OR is_active = false) as inactive
FROM location_equipment;

-- ==========================================================================
-- Step 2: DRY RUN — Identify what would be migrated vs skipped
-- ==========================================================================

SELECT '--- STEP 2: Migration preview ---' as step;

-- Records that WOULD be migrated (no match in location_equipment)
SELECT
  e.company_id,
  e.location_id,
  e.name,
  e.serial_number,
  'MIGRATE' as action
FROM equipment e
WHERE NOT EXISTS (
  SELECT 1 FROM location_equipment le
  WHERE le.location_id = e.location_id
    AND le.name = e.name
    AND (le.serial_number = e.serial_number
         OR (le.serial_number IS NULL AND e.serial_number IS NULL))
);

-- Records that WOULD be skipped (match found in location_equipment)
SELECT
  e.company_id,
  e.location_id,
  e.name,
  e.serial_number,
  'SKIP (duplicate)' as action
FROM equipment e
WHERE EXISTS (
  SELECT 1 FROM location_equipment le
  WHERE le.location_id = e.location_id
    AND le.name = e.name
    AND (le.serial_number = e.serial_number
         OR (le.serial_number IS NULL AND e.serial_number IS NULL))
);

-- ==========================================================================
-- Step 3: EXECUTE — Insert non-duplicate records
-- UNCOMMENT THE BLOCK BELOW AFTER VERIFYING STEP 1-2 OUTPUT
-- ==========================================================================

SELECT '--- STEP 3: Migration (commented out) ---' as step;

/*
INSERT INTO location_equipment (
  id, company_id, location_id, name, equipment_type, model_number,
  serial_number, notes, is_active, deleted_at, created_at
)
SELECT
  gen_random_uuid(),
  e.company_id,
  e.location_id,
  e.name,
  e.type,
  e.model_number,
  e.serial_number,
  CASE
    WHEN e.location IS NOT NULL AND e.notes IS NOT NULL
      THEN e.notes || E'\n[Location: ' || e.location || ']'
    WHEN e.location IS NOT NULL
      THEN '[Location: ' || e.location || ']'
    ELSE e.notes
  END,
  e.is_active,
  e.deleted_at,
  e.created_at
FROM equipment e
WHERE NOT EXISTS (
  SELECT 1 FROM location_equipment le
  WHERE le.location_id = e.location_id
    AND le.name = e.name
    AND (le.serial_number = e.serial_number
         OR (le.serial_number IS NULL AND e.serial_number IS NULL))
);
*/

-- ==========================================================================
-- Step 4: VERIFY — Post-migration counts
-- UNCOMMENT AFTER RUNNING STEP 3
-- ==========================================================================

/*
SELECT '--- STEP 4: Post-migration verification ---' as step;

SELECT
  'location_equipment (after)' as table_name,
  COUNT(*) as total
FROM location_equipment;

-- Verify all legacy records are accounted for (migrated or skipped)
SELECT
  'Unaccounted legacy records' as label,
  COUNT(*) as count
FROM equipment e
WHERE NOT EXISTS (
  SELECT 1 FROM location_equipment le
  WHERE le.location_id = e.location_id
    AND le.name = e.name
    AND (le.serial_number = e.serial_number
         OR (le.serial_number IS NULL AND e.serial_number IS NULL))
);
*/

-- ==========================================================================
-- Step 5: CLEANUP (FUTURE — after verifying app works with migrated data)
-- DO NOT RUN until import flow is updated to use createLocationEquipment()
-- ==========================================================================

/*
-- Remove legacy table
DROP TABLE IF EXISTS equipment;
*/
