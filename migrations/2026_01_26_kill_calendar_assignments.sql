-- ============================================================================
-- Migration: Remove calendar_assignments table (Model A Refactor)
-- ============================================================================
--
-- MODEL A: Job-Centric Scheduling
-- - Scheduling is stored directly on jobs table (scheduledStart, scheduledEnd, isAllDay)
-- - A job is scheduled iff scheduledStart IS NOT NULL
-- - calendar_assignments table is obsolete and can be removed
--
-- CHANGES:
-- 1. Drop jobs.calendar_assignment_id foreign key and column
-- 2. Drop calendar_assignments table
--
-- EXECUTION:
--   psql "$DATABASE_URL" -f migrations/2026_01_26_kill_calendar_assignments.sql
--
-- ============================================================================

-- Start transaction for atomicity
BEGIN;

-- ============================================================================
-- STEP 1: Audit current state
-- ============================================================================

DO $$
DECLARE
    job_ca_count INT;
    ca_count INT;
BEGIN
    RAISE NOTICE '=== PRE-MIGRATION AUDIT ===';

    -- Count jobs with calendar_assignment_id set
    SELECT COUNT(*) INTO job_ca_count
    FROM jobs
    WHERE calendar_assignment_id IS NOT NULL;

    RAISE NOTICE 'Jobs with calendar_assignment_id set: %', job_ca_count;

    -- Count calendar_assignments records
    SELECT COUNT(*) INTO ca_count
    FROM calendar_assignments;

    RAISE NOTICE 'Calendar assignments table records: %', ca_count;

    IF job_ca_count > 0 THEN
        RAISE NOTICE 'WARNING: % jobs have calendar_assignment_id - this FK will be removed', job_ca_count;
    END IF;
END $$;

-- ============================================================================
-- STEP 2: Drop foreign key constraint (if exists)
-- ============================================================================

ALTER TABLE jobs
DROP CONSTRAINT IF EXISTS jobs_calendar_assignment_id_calendar_assignments_id_fk;

-- ============================================================================
-- STEP 3: Drop calendar_assignment_id column from jobs
-- ============================================================================

ALTER TABLE jobs
DROP COLUMN IF EXISTS calendar_assignment_id;

-- ============================================================================
-- STEP 4: Drop calendar_assignments table
-- ============================================================================

DROP TABLE IF EXISTS calendar_assignments;

-- ============================================================================
-- STEP 5: Verify cleanup
-- ============================================================================

DO $$
DECLARE
    table_exists BOOLEAN;
    column_exists BOOLEAN;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=== POST-MIGRATION VERIFICATION ===';

    -- Check if table still exists
    SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'calendar_assignments'
    ) INTO table_exists;

    IF table_exists THEN
        RAISE EXCEPTION 'ERROR: calendar_assignments table still exists';
    END IF;
    RAISE NOTICE 'calendar_assignments table removed: OK';

    -- Check if column still exists
    SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_name = 'jobs' AND column_name = 'calendar_assignment_id'
    ) INTO column_exists;

    IF column_exists THEN
        RAISE EXCEPTION 'ERROR: jobs.calendar_assignment_id column still exists';
    END IF;
    RAISE NOTICE 'jobs.calendar_assignment_id column removed: OK';

    RAISE NOTICE '';
    RAISE NOTICE '=== MIGRATION COMPLETE ===';
    RAISE NOTICE 'Model A: Scheduling is now fully job-centric';
    RAISE NOTICE 'A job is scheduled iff scheduledStart IS NOT NULL';
END $$;

COMMIT;

-- ============================================================================
-- POST-MIGRATION VERIFICATION QUERIES
-- ============================================================================
--
-- -- Verify table is gone
-- SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'calendar_assignments');
-- -- Should return: f
--
-- -- Verify column is gone
-- SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'calendar_assignment_id');
-- -- Should return: f
--
-- -- Verify scheduling still works
-- SELECT id, job_number, status, scheduled_start, scheduled_end, is_all_day
-- FROM jobs
-- WHERE scheduled_start IS NOT NULL
-- LIMIT 5;
--
-- ============================================================================
