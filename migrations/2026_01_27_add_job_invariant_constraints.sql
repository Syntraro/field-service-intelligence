-- Migration: Add CHECK constraints for job invariants
-- Purpose: Enforce data integrity at the database level
--
-- Run with: psql "$DATABASE_URL" -f migrations/2026_01_27_add_job_invariant_constraints.sql

-- All constraints idempotent — safe on replay
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_status_check') THEN
    ALTER TABLE jobs ADD CONSTRAINT jobs_status_check
      CHECK (status IN ('open', 'completed', 'invoiced', 'archived'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_scheduled_end_requires_start_check') THEN
    ALTER TABLE jobs ADD CONSTRAINT jobs_scheduled_end_requires_start_check
      CHECK (scheduled_end IS NULL OR scheduled_start IS NOT NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_all_day_start_midnight_check') THEN
    ALTER TABLE jobs ADD CONSTRAINT jobs_all_day_start_midnight_check
      CHECK (
        is_all_day = false
        OR scheduled_start IS NULL
        OR EXTRACT(HOUR FROM scheduled_start) = 0
           AND EXTRACT(MINUTE FROM scheduled_start) = 0
           AND EXTRACT(SECOND FROM scheduled_start) = 0
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_all_day_end_2359_check') THEN
    ALTER TABLE jobs ADD CONSTRAINT jobs_all_day_end_2359_check
      CHECK (
        is_all_day = false
        OR scheduled_end IS NULL
        OR (
          EXTRACT(HOUR FROM scheduled_end) = 23
          AND EXTRACT(MINUTE FROM scheduled_end) = 59
          AND EXTRACT(SECOND FROM scheduled_end) = 59
        )
      );
  END IF;
END $$;

-- Verification: List all constraints on jobs table
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'jobs'::regclass
  AND contype = 'c'
ORDER BY conname;
