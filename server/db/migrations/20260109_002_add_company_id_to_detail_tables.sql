-- Add company_id to Detail Tables Migration
-- Generated: 2026-01-09
-- Purpose: Improve tenant isolation and query performance on detail tables
--
-- IMPORTANT: Run AFTER 001_add_performance_indexes.sql
-- Execute with: psql $DATABASE_URL -f server/db/migrations/20260109_002_add_company_id_to_detail_tables.sql

BEGIN;

-- ============================================================================
-- INVOICE_LINES TABLE
-- Parent: invoices (via invoice_id)
-- ============================================================================

-- Check if column already exists before adding
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoice_lines' AND column_name = 'company_id'
  ) THEN
    -- Add column (nullable initially)
    ALTER TABLE invoice_lines ADD COLUMN company_id VARCHAR;

    -- Backfill from parent table
    UPDATE invoice_lines il
    SET company_id = i.company_id
    FROM invoices i
    WHERE il.invoice_id = i.id;

    -- Make NOT NULL after backfill
    ALTER TABLE invoice_lines ALTER COLUMN company_id SET NOT NULL;

    -- Add foreign key constraint
    ALTER TABLE invoice_lines
    ADD CONSTRAINT fk_invoice_lines_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

    RAISE NOTICE 'invoice_lines: company_id column added and populated';
  ELSE
    RAISE NOTICE 'invoice_lines: company_id column already exists, skipping';
  END IF;
END $$;

-- Add compound index for performance (outside transaction for CONCURRENTLY)
-- Will be created after COMMIT

-- ============================================================================
-- JOB_PARTS TABLE
-- Parent: jobs (via job_id)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'job_parts' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE job_parts ADD COLUMN company_id VARCHAR;

    UPDATE job_parts jp
    SET company_id = j.company_id
    FROM jobs j
    WHERE jp.job_id = j.id;

    ALTER TABLE job_parts ALTER COLUMN company_id SET NOT NULL;

    ALTER TABLE job_parts
    ADD CONSTRAINT fk_job_parts_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

    RAISE NOTICE 'job_parts: company_id column added and populated';
  ELSE
    RAISE NOTICE 'job_parts: company_id column already exists, skipping';
  END IF;
END $$;

-- ============================================================================
-- JOB_EQUIPMENT TABLE
-- Parent: jobs (via job_id)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'job_equipment' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE job_equipment ADD COLUMN company_id VARCHAR;

    UPDATE job_equipment je
    SET company_id = j.company_id
    FROM jobs j
    WHERE je.job_id = j.id;

    ALTER TABLE job_equipment ALTER COLUMN company_id SET NOT NULL;

    ALTER TABLE job_equipment
    ADD CONSTRAINT fk_job_equipment_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

    RAISE NOTICE 'job_equipment: company_id column added and populated';
  ELSE
    RAISE NOTICE 'job_equipment: company_id column already exists, skipping';
  END IF;
END $$;

-- ============================================================================
-- PAYMENTS TABLE
-- Parent: invoices (via invoice_id)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE payments ADD COLUMN company_id VARCHAR;

    UPDATE payments p
    SET company_id = i.company_id
    FROM invoices i
    WHERE p.invoice_id = i.id;

    ALTER TABLE payments ALTER COLUMN company_id SET NOT NULL;

    ALTER TABLE payments
    ADD CONSTRAINT fk_payments_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

    RAISE NOTICE 'payments: company_id column added and populated';
  ELSE
    RAISE NOTICE 'payments: company_id column already exists, skipping';
  END IF;
END $$;

-- ============================================================================
-- LOCATION_PM_PLANS TABLE
-- Parent: client_locations (via location_id)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'location_pm_plans' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE location_pm_plans ADD COLUMN company_id VARCHAR;

    UPDATE location_pm_plans lpp
    SET company_id = cl.company_id
    FROM client_locations cl
    WHERE lpp.location_id = cl.id;

    ALTER TABLE location_pm_plans ALTER COLUMN company_id SET NOT NULL;

    ALTER TABLE location_pm_plans
    ADD CONSTRAINT fk_location_pm_plans_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

    RAISE NOTICE 'location_pm_plans: company_id column added and populated';
  ELSE
    RAISE NOTICE 'location_pm_plans: company_id column already exists, skipping';
  END IF;
END $$;

-- ============================================================================
-- LOCATION_EQUIPMENT TABLE
-- Parent: client_locations (via location_id)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'location_equipment' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE location_equipment ADD COLUMN company_id VARCHAR;

    UPDATE location_equipment le
    SET company_id = cl.company_id
    FROM client_locations cl
    WHERE le.location_id = cl.id;

    ALTER TABLE location_equipment ALTER COLUMN company_id SET NOT NULL;

    ALTER TABLE location_equipment
    ADD CONSTRAINT fk_location_equipment_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

    RAISE NOTICE 'location_equipment: company_id column added and populated';
  ELSE
    RAISE NOTICE 'location_equipment: company_id column already exists, skipping';
  END IF;
END $$;

-- ============================================================================
-- LOCATION_PM_PART_TEMPLATES TABLE
-- Parent: client_locations (via location_id)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'location_pm_part_templates' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE location_pm_part_templates ADD COLUMN company_id VARCHAR;

    UPDATE location_pm_part_templates lppt
    SET company_id = cl.company_id
    FROM client_locations cl
    WHERE lppt.location_id = cl.id;

    ALTER TABLE location_pm_part_templates ALTER COLUMN company_id SET NOT NULL;

    ALTER TABLE location_pm_part_templates
    ADD CONSTRAINT fk_location_pm_part_templates_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

    RAISE NOTICE 'location_pm_part_templates: company_id column added and populated';
  ELSE
    RAISE NOTICE 'location_pm_part_templates: company_id column already exists, skipping';
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- ADD COMPOUND INDEXES (run after COMMIT for CONCURRENTLY support)
-- ============================================================================

-- Invoice lines compound index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoice_lines_company_invoice
ON invoice_lines(company_id, invoice_id);

-- Job parts compound index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_parts_company_job
ON job_parts(company_id, job_id);

-- Job equipment compound index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_equipment_company_job
ON job_equipment(company_id, job_id);

-- Payments compound index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_company_invoice
ON payments(company_id, invoice_id);

-- Location PM plans compound index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_location_pm_plans_company_location
ON location_pm_plans(company_id, location_id);

-- Location equipment compound index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_location_equipment_company_location
ON location_equipment(company_id, location_id);

-- Location PM part templates compound index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_location_pm_part_templates_company_location
ON location_pm_part_templates(company_id, location_id);

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Verify all company_id columns were added and populated
SELECT
  table_name,
  column_name,
  is_nullable,
  data_type
FROM information_schema.columns
WHERE column_name = 'company_id'
  AND table_schema = 'public'
  AND table_name IN (
    'invoice_lines',
    'job_parts',
    'job_equipment',
    'payments',
    'location_pm_plans',
    'location_equipment',
    'location_pm_part_templates'
  )
ORDER BY table_name;

-- Verify foreign key constraints
SELECT
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
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
  AND kcu.column_name = 'company_id'
  AND tc.table_name IN (
    'invoice_lines',
    'job_parts',
    'job_equipment',
    'payments',
    'location_pm_plans',
    'location_equipment',
    'location_pm_part_templates'
  )
ORDER BY tc.table_name;

-- Check for any NULL values (should be 0)
SELECT 'invoice_lines' as table_name, COUNT(*) as null_count FROM invoice_lines WHERE company_id IS NULL
UNION ALL
SELECT 'job_parts', COUNT(*) FROM job_parts WHERE company_id IS NULL
UNION ALL
SELECT 'job_equipment', COUNT(*) FROM job_equipment WHERE company_id IS NULL
UNION ALL
SELECT 'payments', COUNT(*) FROM payments WHERE company_id IS NULL
UNION ALL
SELECT 'location_pm_plans', COUNT(*) FROM location_pm_plans WHERE company_id IS NULL
UNION ALL
SELECT 'location_equipment', COUNT(*) FROM location_equipment WHERE company_id IS NULL
UNION ALL
SELECT 'location_pm_part_templates', COUNT(*) FROM location_pm_part_templates WHERE company_id IS NULL;

-- ============================================================================
-- ROLLBACK COMMANDS (uncomment if needed)
-- ============================================================================

-- ALTER TABLE invoice_lines DROP CONSTRAINT IF EXISTS fk_invoice_lines_company;
-- DROP INDEX IF EXISTS idx_invoice_lines_company_invoice;
-- ALTER TABLE invoice_lines DROP COLUMN IF EXISTS company_id;

-- ALTER TABLE job_parts DROP CONSTRAINT IF EXISTS fk_job_parts_company;
-- DROP INDEX IF EXISTS idx_job_parts_company_job;
-- ALTER TABLE job_parts DROP COLUMN IF EXISTS company_id;

-- ALTER TABLE job_equipment DROP CONSTRAINT IF EXISTS fk_job_equipment_company;
-- DROP INDEX IF EXISTS idx_job_equipment_company_job;
-- ALTER TABLE job_equipment DROP COLUMN IF EXISTS company_id;

-- ALTER TABLE payments DROP CONSTRAINT IF EXISTS fk_payments_company;
-- DROP INDEX IF EXISTS idx_payments_company_invoice;
-- ALTER TABLE payments DROP COLUMN IF EXISTS company_id;

-- ALTER TABLE location_pm_plans DROP CONSTRAINT IF EXISTS fk_location_pm_plans_company;
-- DROP INDEX IF EXISTS idx_location_pm_plans_company_location;
-- ALTER TABLE location_pm_plans DROP COLUMN IF EXISTS company_id;

-- ALTER TABLE location_equipment DROP CONSTRAINT IF EXISTS fk_location_equipment_company;
-- DROP INDEX IF EXISTS idx_location_equipment_company_location;
-- ALTER TABLE location_equipment DROP COLUMN IF EXISTS company_id;

-- ALTER TABLE location_pm_part_templates DROP CONSTRAINT IF EXISTS fk_location_pm_part_templates_company;
-- DROP INDEX IF EXISTS idx_location_pm_part_templates_company_location;
-- ALTER TABLE location_pm_part_templates DROP COLUMN IF EXISTS company_id;
