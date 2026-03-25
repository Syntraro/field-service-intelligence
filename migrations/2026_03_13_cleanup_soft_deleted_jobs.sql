-- Migration: Cleanup soft-deleted jobs without invoices
-- Date: 2026-03-13
-- Purpose: Hard-delete jobs that were soft-deleted (deleted_at IS NOT NULL)
--          but have no invoice attached from EITHER direction:
--            1. jobs.invoice_id (canonical FK from job to invoice)
--            2. invoices.job_id (denormalized, no FK constraint)
--          FK cascades handle child rows (job_visits, job_parts, job_equipment,
--          job_status_events, job_schedule_audit).
--          Work sessions and timesheet entries get job_id set to NULL (onDelete: "set null").
--
-- Run: npm run db:migrate:one -- migrations/2026_03_13_cleanup_soft_deleted_jobs.sql
--
-- IMPORTANT: Run this AFTER deploying the updated deleteJob() logic.
-- This is a one-time data repair for jobs that were soft-deleted before the
-- conditional hard-delete logic was implemented.

-- Step 1: Preview what will be deleted (run this SELECT first to verify)
-- SELECT j.id, j.job_number, j.summary, j.status, j.deleted_at, j.invoice_id
-- FROM jobs j
-- WHERE j.deleted_at IS NOT NULL
--   AND j.invoice_id IS NULL
--   AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.job_id = j.id);

-- Step 2: Hard-delete soft-deleted jobs with no invoice from either direction
DELETE FROM jobs j
WHERE j.deleted_at IS NOT NULL
  AND j.invoice_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.job_id = j.id);

-- Step 3: Verify no orphaned job_visits remain for hard-deleted jobs
-- (Should return 0 rows due to FK CASCADE, but verify)
-- SELECT jv.id, jv.job_id
-- FROM job_visits jv
-- LEFT JOIN jobs j ON j.id = jv.job_id
-- WHERE j.id IS NULL;
