-- Fix Cascade Delete Behavior Migration
-- Generated: 2026-01-09
-- Purpose: Prevent unintended data loss from cascading deletes
--
-- IMPORTANT: Run AFTER 002_add_company_id_to_detail_tables.sql
-- Execute with: psql $DATABASE_URL -f server/db/migrations/20260109_003_fix_cascade_deletes.sql
--
-- STRATEGY:
-- 1. SET NULL for creator/author references (user_id on records)
-- 2. RESTRICT for critical business relationships (prevent accidental deletions)
-- 3. CASCADE only for true detail records (lines, parts, equipment on parent)
-- 4. Add soft delete columns for proper archival

BEGIN;

-- ============================================================================
-- STEP 1: IDENTIFY CURRENT FOREIGN KEY CONSTRAINTS
-- ============================================================================

-- First, let's see what we're working with
-- Run this manually to see constraint names:
-- SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table, rc.delete_rule, tc.constraint_name
-- FROM information_schema.table_constraints AS tc
-- JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
-- JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
-- JOIN information_schema.referential_constraints AS rc ON rc.constraint_name = tc.constraint_name
-- WHERE tc.constraint_type = 'FOREIGN KEY'
-- ORDER BY tc.table_name, kcu.column_name;

-- ============================================================================
-- STEP 2: CHANGE CREATOR REFERENCES TO SET NULL
-- These are user_id columns that track "who created this record"
-- Deleting a user should NOT delete all records they created
-- ============================================================================

-- client_locations.user_id → users (creator)
DO $$
DECLARE
  constraint_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'client_locations_user_id_users_id_fk'
  ) INTO constraint_exists;

  IF constraint_exists THEN
    ALTER TABLE client_locations DROP CONSTRAINT client_locations_user_id_users_id_fk;
    ALTER TABLE client_locations
    ADD CONSTRAINT client_locations_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
    -- Make column nullable if not already
    ALTER TABLE client_locations ALTER COLUMN user_id DROP NOT NULL;
    RAISE NOTICE 'client_locations.user_id: Changed to SET NULL';
  ELSE
    RAISE NOTICE 'client_locations.user_id: Constraint not found, checking alternate names...';
  END IF;
END $$;

-- equipment.user_id → users (creator)
DO $$
DECLARE
  constraint_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'equipment_user_id_users_id_fk'
  ) INTO constraint_exists;

  IF constraint_exists THEN
    ALTER TABLE equipment DROP CONSTRAINT equipment_user_id_users_id_fk;
    ALTER TABLE equipment
    ADD CONSTRAINT equipment_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE equipment ALTER COLUMN user_id DROP NOT NULL;
    RAISE NOTICE 'equipment.user_id: Changed to SET NULL';
  ELSE
    RAISE NOTICE 'equipment.user_id: Constraint not found';
  END IF;
END $$;

-- items.user_id → users (creator)
DO $$
DECLARE
  constraint_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'items_user_id_users_id_fk'
  ) INTO constraint_exists;

  IF constraint_exists THEN
    ALTER TABLE items DROP CONSTRAINT items_user_id_users_id_fk;
    ALTER TABLE items
    ADD CONSTRAINT items_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE items ALTER COLUMN user_id DROP NOT NULL;
    RAISE NOTICE 'items.user_id: Changed to SET NULL';
  ELSE
    RAISE NOTICE 'items.user_id: Constraint not found';
  END IF;
END $$;

-- calendar_assignments.user_id → users (creator)
DO $$
DECLARE
  constraint_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'calendar_assignments_user_id_users_id_fk'
  ) INTO constraint_exists;

  IF constraint_exists THEN
    ALTER TABLE calendar_assignments DROP CONSTRAINT calendar_assignments_user_id_users_id_fk;
    ALTER TABLE calendar_assignments
    ADD CONSTRAINT calendar_assignments_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE calendar_assignments ALTER COLUMN user_id DROP NOT NULL;
    RAISE NOTICE 'calendar_assignments.user_id: Changed to SET NULL';
  ELSE
    RAISE NOTICE 'calendar_assignments.user_id: Constraint not found';
  END IF;
END $$;

-- client_parts.user_id → users (creator)
DO $$
DECLARE
  constraint_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'client_parts_user_id_users_id_fk'
  ) INTO constraint_exists;

  IF constraint_exists THEN
    ALTER TABLE client_parts DROP CONSTRAINT client_parts_user_id_users_id_fk;
    ALTER TABLE client_parts
    ADD CONSTRAINT client_parts_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE client_parts ALTER COLUMN user_id DROP NOT NULL;
    RAISE NOTICE 'client_parts.user_id: Changed to SET NULL';
  ELSE
    RAISE NOTICE 'client_parts.user_id: Constraint not found';
  END IF;
END $$;

-- maintenance_records.user_id → users (creator)
DO $$
DECLARE
  constraint_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'maintenance_records_user_id_users_id_fk'
  ) INTO constraint_exists;

  IF constraint_exists THEN
    ALTER TABLE maintenance_records DROP CONSTRAINT maintenance_records_user_id_users_id_fk;
    ALTER TABLE maintenance_records
    ADD CONSTRAINT maintenance_records_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE maintenance_records ALTER COLUMN user_id DROP NOT NULL;
    RAISE NOTICE 'maintenance_records.user_id: Changed to SET NULL';
  ELSE
    RAISE NOTICE 'maintenance_records.user_id: Constraint not found';
  END IF;
END $$;

-- ============================================================================
-- STEP 3: CHANGE CRITICAL BUSINESS RELATIONSHIPS TO RESTRICT
-- These prevent accidental deletion of parent records with active children
-- ============================================================================

-- jobs.location_id → client_locations (can't delete location with active jobs)
DO $$
DECLARE
  constraint_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'jobs_location_id_client_locations_id_fk'
  ) INTO constraint_exists;

  IF constraint_exists THEN
    ALTER TABLE jobs DROP CONSTRAINT jobs_location_id_client_locations_id_fk;
    ALTER TABLE jobs
    ADD CONSTRAINT jobs_location_id_client_locations_id_fk
    FOREIGN KEY (location_id) REFERENCES client_locations(id) ON DELETE RESTRICT;
    RAISE NOTICE 'jobs.location_id: Changed to RESTRICT';
  ELSE
    RAISE NOTICE 'jobs.location_id: Constraint not found';
  END IF;
END $$;

-- invoices.location_id → client_locations (can't delete location with invoices)
DO $$
DECLARE
  constraint_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'invoices_location_id_client_locations_id_fk'
  ) INTO constraint_exists;

  IF constraint_exists THEN
    ALTER TABLE invoices DROP CONSTRAINT invoices_location_id_client_locations_id_fk;
    ALTER TABLE invoices
    ADD CONSTRAINT invoices_location_id_client_locations_id_fk
    FOREIGN KEY (location_id) REFERENCES client_locations(id) ON DELETE RESTRICT;
    RAISE NOTICE 'invoices.location_id: Changed to RESTRICT';
  ELSE
    RAISE NOTICE 'invoices.location_id: Constraint not found';
  END IF;
END $$;

-- equipment.client_id → client_locations (can't delete location with equipment)
DO $$
DECLARE
  constraint_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'equipment_client_id_client_locations_id_fk'
  ) INTO constraint_exists;

  IF constraint_exists THEN
    ALTER TABLE equipment DROP CONSTRAINT equipment_client_id_client_locations_id_fk;
    ALTER TABLE equipment
    ADD CONSTRAINT equipment_client_id_client_locations_id_fk
    FOREIGN KEY (client_id) REFERENCES client_locations(id) ON DELETE RESTRICT;
    RAISE NOTICE 'equipment.client_id: Changed to RESTRICT';
  ELSE
    RAISE NOTICE 'equipment.client_id: Constraint not found';
  END IF;
END $$;

-- calendar_assignments.client_id → client_locations
DO $$
DECLARE
  constraint_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'calendar_assignments_client_id_client_locations_id_fk'
  ) INTO constraint_exists;

  IF constraint_exists THEN
    ALTER TABLE calendar_assignments DROP CONSTRAINT calendar_assignments_client_id_client_locations_id_fk;
    ALTER TABLE calendar_assignments
    ADD CONSTRAINT calendar_assignments_client_id_client_locations_id_fk
    FOREIGN KEY (client_id) REFERENCES client_locations(id) ON DELETE RESTRICT;
    RAISE NOTICE 'calendar_assignments.client_id: Changed to RESTRICT';
  ELSE
    RAISE NOTICE 'calendar_assignments.client_id: Constraint not found';
  END IF;
END $$;

-- client_parts.client_id → client_locations
DO $$
DECLARE
  constraint_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'client_parts_client_id_client_locations_id_fk'
  ) INTO constraint_exists;

  IF constraint_exists THEN
    ALTER TABLE client_parts DROP CONSTRAINT client_parts_client_id_client_locations_id_fk;
    ALTER TABLE client_parts
    ADD CONSTRAINT client_parts_client_id_client_locations_id_fk
    FOREIGN KEY (client_id) REFERENCES client_locations(id) ON DELETE RESTRICT;
    RAISE NOTICE 'client_parts.client_id: Changed to RESTRICT';
  ELSE
    RAISE NOTICE 'client_parts.client_id: Constraint not found';
  END IF;
END $$;

-- maintenance_records.client_id → client_locations
DO $$
DECLARE
  constraint_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'maintenance_records_client_id_client_locations_id_fk'
  ) INTO constraint_exists;

  IF constraint_exists THEN
    ALTER TABLE maintenance_records DROP CONSTRAINT maintenance_records_client_id_client_locations_id_fk;
    ALTER TABLE maintenance_records
    ADD CONSTRAINT maintenance_records_client_id_client_locations_id_fk
    FOREIGN KEY (client_id) REFERENCES client_locations(id) ON DELETE RESTRICT;
    RAISE NOTICE 'maintenance_records.client_id: Changed to RESTRICT';
  ELSE
    RAISE NOTICE 'maintenance_records.client_id: Constraint not found';
  END IF;
END $$;

-- client_notes.client_id → client_locations
DO $$
DECLARE
  constraint_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'client_notes_client_id_client_locations_id_fk'
  ) INTO constraint_exists;

  IF constraint_exists THEN
    ALTER TABLE client_notes DROP CONSTRAINT client_notes_client_id_client_locations_id_fk;
    ALTER TABLE client_notes
    ADD CONSTRAINT client_notes_client_id_client_locations_id_fk
    FOREIGN KEY (client_id) REFERENCES client_locations(id) ON DELETE RESTRICT;
    RAISE NOTICE 'client_notes.client_id: Changed to RESTRICT';
  ELSE
    RAISE NOTICE 'client_notes.client_id: Constraint not found';
  END IF;
END $$;

-- ============================================================================
-- STEP 4: ADD SOFT DELETE COLUMNS
-- These allow "archiving" records instead of hard deleting
-- ============================================================================

-- Add is_active and deleted_at to equipment table
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- Users already have 'disabled' and 'status' columns, add deleted_at for completeness
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- Client locations already have 'inactive' column, add deleted_at for completeness
ALTER TABLE client_locations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- Items already have is_active, add deleted_at
ALTER TABLE items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- Customer companies have is_active, add deleted_at
ALTER TABLE customer_companies ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

COMMIT;

-- ============================================================================
-- STEP 5: ADD PARTIAL INDEXES FOR SOFT DELETE QUERIES
-- ============================================================================

-- Index for active equipment only
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_equipment_company_active
ON equipment(company_id, is_active) WHERE is_active = true;

-- Index for non-deleted users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_company_not_deleted
ON users(company_id) WHERE deleted_at IS NULL;

-- Index for non-deleted client locations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_client_locations_company_not_deleted
ON client_locations(company_id) WHERE deleted_at IS NULL;

-- Index for non-deleted items
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_items_company_not_deleted
ON items(company_id) WHERE deleted_at IS NULL;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Verify cascade behavior changes
SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  rc.delete_rule,
  CASE
    WHEN rc.delete_rule = 'SET NULL' THEN '✓ Creator reference'
    WHEN rc.delete_rule = 'RESTRICT' THEN '✓ Protected relationship'
    WHEN rc.delete_rule = 'CASCADE' THEN '→ Cascade (detail record)'
    WHEN rc.delete_rule = 'NO ACTION' THEN '⚠ No action'
    ELSE '? Unknown'
  END as status
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
JOIN information_schema.referential_constraints AS rc
  ON rc.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
ORDER BY rc.delete_rule, tc.table_name;

-- Verify soft delete columns were added
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE column_name IN ('is_active', 'deleted_at')
  AND table_schema = 'public'
  AND table_name IN ('equipment', 'users', 'client_locations', 'items', 'customer_companies')
ORDER BY table_name, column_name;

-- ============================================================================
-- ROLLBACK COMMANDS (uncomment if needed)
-- ============================================================================

-- Revert user_id constraints to CASCADE:
-- ALTER TABLE client_locations DROP CONSTRAINT client_locations_user_id_users_id_fk;
-- ALTER TABLE client_locations ADD CONSTRAINT client_locations_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
-- ALTER TABLE client_locations ALTER COLUMN user_id SET NOT NULL;

-- ALTER TABLE equipment DROP CONSTRAINT equipment_user_id_users_id_fk;
-- ALTER TABLE equipment ADD CONSTRAINT equipment_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
-- ALTER TABLE equipment ALTER COLUMN user_id SET NOT NULL;

-- ALTER TABLE items DROP CONSTRAINT items_user_id_users_id_fk;
-- ALTER TABLE items ADD CONSTRAINT items_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
-- ALTER TABLE items ALTER COLUMN user_id SET NOT NULL;

-- ALTER TABLE calendar_assignments DROP CONSTRAINT calendar_assignments_user_id_users_id_fk;
-- ALTER TABLE calendar_assignments ADD CONSTRAINT calendar_assignments_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
-- ALTER TABLE calendar_assignments ALTER COLUMN user_id SET NOT NULL;

-- Revert location_id/client_id constraints to CASCADE:
-- ALTER TABLE jobs DROP CONSTRAINT jobs_location_id_client_locations_id_fk;
-- ALTER TABLE jobs ADD CONSTRAINT jobs_location_id_client_locations_id_fk FOREIGN KEY (location_id) REFERENCES client_locations(id) ON DELETE CASCADE;

-- ALTER TABLE invoices DROP CONSTRAINT invoices_location_id_client_locations_id_fk;
-- ALTER TABLE invoices ADD CONSTRAINT invoices_location_id_client_locations_id_fk FOREIGN KEY (location_id) REFERENCES client_locations(id) ON DELETE CASCADE;

-- ALTER TABLE equipment DROP CONSTRAINT equipment_client_id_client_locations_id_fk;
-- ALTER TABLE equipment ADD CONSTRAINT equipment_client_id_client_locations_id_fk FOREIGN KEY (client_id) REFERENCES client_locations(id) ON DELETE CASCADE;

-- Remove soft delete columns:
-- ALTER TABLE equipment DROP COLUMN IF EXISTS is_active;
-- ALTER TABLE equipment DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE users DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE client_locations DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE items DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE customer_companies DROP COLUMN IF EXISTS deleted_at;

-- Remove indexes:
-- DROP INDEX IF EXISTS idx_equipment_company_active;
-- DROP INDEX IF EXISTS idx_users_company_not_deleted;
-- DROP INDEX IF EXISTS idx_client_locations_company_not_deleted;
-- DROP INDEX IF EXISTS idx_items_company_not_deleted;
