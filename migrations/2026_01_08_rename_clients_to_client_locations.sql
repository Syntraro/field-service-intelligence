-- Migration: Rename 'clients' table to 'client_locations' for architectural clarity
-- Date: 2026-01-08
-- Reason: The 'clients' table represents service locations, not client companies.
--         This rename improves code clarity and reduces confusion.
--
-- IMPORTANT: This is a table rename only. Column names remain unchanged.
-- PostgreSQL automatically updates all foreign key references when a table is renamed.
--
-- Tables affected by foreign keys:
--   - client_parts (client_id → client_locations.id)
--   - maintenance_records (client_id → client_locations.id)
--   - calendar_assignments (client_id → client_locations.id)
--   - client_notes (client_id → client_locations.id)
--   - tasks (client_id → client_locations.id)
--   - invoices (location_id → client_locations.id)
--   - recurring_job_series (location_id → client_locations.id)
--   - jobs (location_id → client_locations.id)
--   - location_pm_plans (location_id → client_locations.id)
--   - location_equipment (location_id → client_locations.id)
--   - location_pm_part_templates (location_id → client_locations.id)

-- ==============================================================================
-- STEP 1: Rename the table
-- ==============================================================================

ALTER TABLE clients RENAME TO client_locations;

-- ==============================================================================
-- STEP 2: Verify Foreign Key Auto-Update
-- ==============================================================================

-- PostgreSQL automatically updates:
-- - Foreign key constraint references
-- - Indexes (they get renamed with _old suffix but still work)
-- - Sequences (if any)
--
-- No manual action needed for FK updates!

-- ==============================================================================
-- STEP 3: Refresh Statistics
-- ==============================================================================

ANALYZE client_locations;

-- ==============================================================================
-- VERIFICATION QUERIES (Run these after migration)
-- ==============================================================================

-- Verify table exists and has data
SELECT 'client_locations row count:' as check, count(*)::text as result FROM client_locations;

-- Verify foreign keys are intact
SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
  JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_name = 'client_locations'
ORDER BY tc.table_name, kcu.column_name;

-- Verify indexes
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'client_locations'
ORDER BY indexname;

-- Verify no orphaned references to old 'clients' table name
SELECT
  conname AS constraint_name,
  conrelid::regclass AS table_name,
  confrelid::regclass AS referenced_table
FROM pg_constraint
WHERE confrelid = 'clients'::regclass; -- Should return 0 rows (table doesn't exist)

-- ==============================================================================
-- ROLLBACK INSTRUCTIONS (IF NEEDED)
-- ==============================================================================

-- To rollback this migration, run:
-- ALTER TABLE client_locations RENAME TO clients;
-- ANALYZE clients;

-- ==============================================================================
-- MIGRATION COMPLETE
-- ==============================================================================

-- Next steps:
-- 1. Update shared/schema.ts (TypeScript definitions)
-- 2. Update server code (routes, storage)
-- 3. Update client code (components, pages)
-- 4. Restart application
-- 5. Test all location-related features
