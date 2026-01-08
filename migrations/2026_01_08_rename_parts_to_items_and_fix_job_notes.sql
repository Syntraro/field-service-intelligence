-- Migration: Rename parts to items and fix job_notes table
-- Date: 2026-01-08
-- Description:
--   1. Rename 'parts' table to 'items' (more accurate for products + services)
--   2. Fix job_notes to reference jobId directly instead of assignmentId
--   3. Remove simple_job_notes (dead code)

-- ============================================
-- PART 1: Rename parts to items
-- ============================================

-- Rename the table
ALTER TABLE parts RENAME TO items;

-- Rename primary key constraint
ALTER INDEX IF EXISTS parts_pkey RENAME TO items_pkey;

-- Rename all indexes
ALTER INDEX IF EXISTS parts_company_id_idx RENAME TO items_company_id_idx;
ALTER INDEX IF EXISTS parts_company_type_idx RENAME TO items_company_type_idx;
ALTER INDEX IF EXISTS parts_company_active_idx RENAME TO items_company_active_idx;
ALTER INDEX IF EXISTS parts_qbo_item_id_idx RENAME TO items_qbo_item_id_idx;

-- Update foreign key constraints in job_parts
ALTER TABLE job_parts DROP CONSTRAINT IF EXISTS job_parts_part_id_parts_id_fk;
ALTER TABLE job_parts ADD CONSTRAINT job_parts_part_id_items_id_fk
  FOREIGN KEY (part_id) REFERENCES items(id) ON DELETE CASCADE;

-- Update foreign key constraints in invoice_lines
ALTER TABLE invoice_lines DROP CONSTRAINT IF EXISTS invoice_lines_part_id_parts_id_fk;
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_part_id_items_id_fk
  FOREIGN KEY (part_id) REFERENCES items(id) ON DELETE SET NULL;

-- Update foreign key constraints in location_pm_parts
ALTER TABLE location_pm_parts DROP CONSTRAINT IF EXISTS location_pm_parts_part_id_parts_id_fk;
ALTER TABLE location_pm_parts ADD CONSTRAINT location_pm_parts_part_id_items_id_fk
  FOREIGN KEY (part_id) REFERENCES items(id) ON DELETE CASCADE;

-- Update foreign key constraints in client_parts (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints
             WHERE constraint_name = 'client_parts_part_id_parts_id_fk') THEN
    ALTER TABLE client_parts DROP CONSTRAINT client_parts_part_id_parts_id_fk;
    ALTER TABLE client_parts ADD CONSTRAINT client_parts_part_id_items_id_fk
      FOREIGN KEY (part_id) REFERENCES items(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Update foreign key constraints in job_template_lines (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints
             WHERE constraint_name = 'job_template_lines_product_id_parts_id_fk') THEN
    ALTER TABLE job_template_lines DROP CONSTRAINT job_template_lines_product_id_parts_id_fk;
    ALTER TABLE job_template_lines ADD CONSTRAINT job_template_lines_product_id_items_id_fk
      FOREIGN KEY (product_id) REFERENCES items(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================
-- PART 2: Fix job_notes table
-- ============================================

-- Add job_id column to job_notes (only if it doesn't exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'job_notes' AND column_name = 'job_id') THEN

    -- Add the new column
    ALTER TABLE job_notes ADD COLUMN job_id VARCHAR;

    -- Migrate data from assignment_id to job_id if assignment_id exists
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'job_notes' AND column_name = 'assignment_id') THEN

      -- Update job_id based on assignment_id
      UPDATE job_notes jn
      SET job_id = j.id
      FROM calendar_assignments ca
      JOIN jobs j ON j.calendar_assignment_id = ca.id
      WHERE jn.assignment_id = ca.id;

      -- Drop the old assignment_id column
      ALTER TABLE job_notes DROP COLUMN assignment_id;
    END IF;

    -- Make job_id NOT NULL
    ALTER TABLE job_notes ALTER COLUMN job_id SET NOT NULL;

    -- Add foreign key constraint
    ALTER TABLE job_notes ADD CONSTRAINT job_notes_job_id_jobs_id_fk
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;

    -- Add indexes for performance
    CREATE INDEX job_notes_job_id_idx ON job_notes(job_id);
    CREATE INDEX job_notes_company_job_idx ON job_notes(company_id, job_id);
  END IF;
END $$;

-- ============================================
-- PART 3: Drop simple_job_notes (dead code)
-- ============================================

DROP TABLE IF EXISTS simple_job_notes;

-- ============================================
-- VERIFICATION QUERIES (for manual testing)
-- ============================================

-- Uncomment to verify changes:
-- SELECT table_name FROM information_schema.tables WHERE table_name IN ('items', 'parts', 'job_notes', 'simple_job_notes');
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'job_notes';
-- SELECT constraint_name FROM information_schema.table_constraints WHERE table_name = 'job_parts' AND constraint_type = 'FOREIGN KEY';
