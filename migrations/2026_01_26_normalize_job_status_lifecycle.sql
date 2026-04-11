-- ============================================================================
-- Migration: Normalize Job Status to 4-Value Lifecycle Model
-- ============================================================================
--
-- CANONICAL LIFECYCLE STATUSES (exactly 4):
--   open      - Active job (may be scheduled or unscheduled, assigned or not)
--   completed - Work finished, awaiting invoicing
--   invoiced  - Invoice sent to customer
--   archived  - Closed/cancelled, hidden from active views
--
-- LEGACY STATUSES BEING ELIMINATED:
--   assigned    - Now derived: job has technician(s) assigned
--   scheduled   - Now derived: job has scheduledStart IS NOT NULL
--   unscheduled - Now just 'open' with scheduledStart IS NULL
--   on_hold     - Maps to 'open' (hold state is tracked separately)
--   pending     - Maps to 'open'
--   in_progress - Maps to 'open' (work tracking is separate)
--
-- INVARIANTS AFTER MIGRATION:
--   - status column contains ONLY: open, completed, invoiced, archived
--   - "Is job scheduled?" = scheduledStart IS NOT NULL (not status-based)
--   - "Is job assigned?" = primaryTechnicianId IS NOT NULL OR assignedTechnicianIds has elements
--
-- EXECUTION:
--   psql "$DATABASE_URL" -f migrations/2026_01_26_normalize_job_status_lifecycle.sql
--
-- ============================================================================

-- Start transaction for atomicity
BEGIN;

-- ============================================================================
-- STEP 1: Audit current state (before changes)
-- ============================================================================

DO $$
DECLARE
    status_rec RECORD;
    total_jobs INT;
BEGIN
    SELECT COUNT(*) INTO total_jobs FROM jobs WHERE deleted_at IS NULL;

    RAISE NOTICE '=== PRE-MIGRATION AUDIT ===';
    RAISE NOTICE 'Total active jobs: %', total_jobs;
    RAISE NOTICE '';
    RAISE NOTICE 'Current status distribution:';

    FOR status_rec IN
        SELECT status, COUNT(*) as cnt
        FROM jobs
        WHERE deleted_at IS NULL
        GROUP BY status
        ORDER BY status
    LOOP
        RAISE NOTICE '  %: %', status_rec.status, status_rec.cnt;
    END LOOP;
END $$;

-- ============================================================================
-- STEP 2: Migrate legacy statuses to 'open'
-- ============================================================================

-- Migrate 'assigned' → 'open'
-- Assignment is now derived from primaryTechnicianId/assignedTechnicianIds
UPDATE jobs
SET
    status = 'open',
    updated_at = NOW()
WHERE status = 'assigned';

-- Migrate 'scheduled' → 'open'
-- Scheduling is now derived from scheduledStart IS NOT NULL
UPDATE jobs
SET
    status = 'open',
    updated_at = NOW()
WHERE status = 'scheduled';

-- Migrate 'unscheduled' → 'open'
-- Unscheduled is now derived from scheduledStart IS NULL
UPDATE jobs
SET
    status = 'open',
    updated_at = NOW()
WHERE status = 'unscheduled';

-- Migrate 'on_hold' → 'open'
-- Hold state is tracked via hold_reason column, not status
UPDATE jobs
SET
    status = 'open',
    updated_at = NOW()
WHERE status = 'on_hold';

-- Migrate 'pending' → 'open'
UPDATE jobs
SET
    status = 'open',
    updated_at = NOW()
WHERE status = 'pending';

-- Migrate 'in_progress' → 'open'
UPDATE jobs
SET
    status = 'open',
    updated_at = NOW()
WHERE status = 'in_progress';

-- ============================================================================
-- STEP 3: Handle any other unexpected legacy statuses
-- ============================================================================

-- Map any other unexpected statuses to 'open' as a safety net
UPDATE jobs
SET
    status = 'open',
    updated_at = NOW()
WHERE status NOT IN ('open', 'completed', 'invoiced', 'archived');

-- ============================================================================
-- STEP 4: Update column default to 'open' (was 'unscheduled')
-- ============================================================================

ALTER TABLE jobs ALTER COLUMN status SET DEFAULT 'open';

-- ============================================================================
-- STEP 5: Drop old constraints that reference legacy statuses
-- ============================================================================

-- Drop the on_hold constraint since 'on_hold' status no longer exists
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_hold_reason_check;

-- ============================================================================
-- STEP 6: Add CHECK constraint to enforce 4-status model
-- ============================================================================

-- Drop existing constraint if any (idempotent)
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_lifecycle_check;

-- Add CHECK constraint to enforce exactly 4 valid statuses (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_status_lifecycle_check') THEN
    ALTER TABLE jobs ADD CONSTRAINT jobs_status_lifecycle_check
      CHECK (status IN ('open', 'completed', 'invoiced', 'archived'));
  END IF;
END $$;

-- ============================================================================
-- STEP 7: Post-migration verification
-- ============================================================================

DO $$
DECLARE
    status_rec RECORD;
    invalid_count INT;
    open_scheduled INT;
    open_backlog INT;
    open_assigned INT;
    open_unassigned INT;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=== POST-MIGRATION VERIFICATION ===';
    RAISE NOTICE '';

    -- Show status distribution
    RAISE NOTICE 'Status distribution (active jobs only):';
    FOR status_rec IN
        SELECT status, COUNT(*) as cnt
        FROM jobs
        WHERE deleted_at IS NULL
        GROUP BY status
        ORDER BY status
    LOOP
        RAISE NOTICE '  %: %', status_rec.status, status_rec.cnt;
    END LOOP;

    -- Verify no invalid statuses
    SELECT COUNT(*) INTO invalid_count
    FROM jobs
    WHERE status NOT IN ('open', 'completed', 'invoiced', 'archived');

    IF invalid_count > 0 THEN
        RAISE EXCEPTION 'MIGRATION FAILED: % jobs still have invalid status', invalid_count;
    END IF;
    RAISE NOTICE '';
    RAISE NOTICE 'Invalid status count: % (expected 0) ✓', invalid_count;

    -- Show open job breakdown (scheduled vs backlog)
    SELECT COUNT(*) INTO open_scheduled
    FROM jobs
    WHERE status = 'open'
      AND scheduled_start IS NOT NULL
      AND deleted_at IS NULL;

    SELECT COUNT(*) INTO open_backlog
    FROM jobs
    WHERE status = 'open'
      AND scheduled_start IS NULL
      AND deleted_at IS NULL;

    -- Show assigned vs unassigned
    SELECT COUNT(*) INTO open_assigned
    FROM jobs
    WHERE status = 'open'
      AND (primary_technician_id IS NOT NULL
           OR COALESCE(array_length(assigned_technician_ids, 1), 0) > 0)
      AND deleted_at IS NULL;

    SELECT COUNT(*) INTO open_unassigned
    FROM jobs
    WHERE status = 'open'
      AND primary_technician_id IS NULL
      AND COALESCE(array_length(assigned_technician_ids, 1), 0) = 0
      AND deleted_at IS NULL;

    RAISE NOTICE '';
    RAISE NOTICE 'Open jobs breakdown:';
    RAISE NOTICE '  open_scheduled (has scheduledStart): %', open_scheduled;
    RAISE NOTICE '  open_backlog (no scheduledStart): %', open_backlog;
    RAISE NOTICE '  open_total: %', open_scheduled + open_backlog;
    RAISE NOTICE '';
    RAISE NOTICE '  open_assigned (has technician): %', open_assigned;
    RAISE NOTICE '  open_unassigned (no technician): %', open_unassigned;

    RAISE NOTICE '';
    RAISE NOTICE '=== MIGRATION COMPLETE ===';
    RAISE NOTICE 'DB constraint added: status IN (open, completed, invoiced, archived)';
    RAISE NOTICE 'Default updated: status DEFAULT ''open''';
END $$;

COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES (run separately to confirm)
-- ============================================================================
--
-- -- Should show only: open, completed, invoiced, archived
-- SELECT status, COUNT(*) FROM jobs WHERE deleted_at IS NULL GROUP BY status ORDER BY status;
--
-- -- Should return 0
-- SELECT COUNT(*) FROM jobs WHERE status NOT IN ('open','completed','invoiced','archived');
--
-- -- Should show breakdown of open jobs
-- SELECT
--     COUNT(*) FILTER (WHERE scheduled_start IS NOT NULL) as open_scheduled,
--     COUNT(*) FILTER (WHERE scheduled_start IS NULL) as open_backlog,
--     COUNT(*) as open_total
-- FROM jobs
-- WHERE status = 'open' AND deleted_at IS NULL;
--
-- -- Test constraint (should fail)
-- -- UPDATE jobs SET status = 'scheduled' WHERE id = (SELECT id FROM jobs LIMIT 1);
--
-- ============================================================================
