-- ============================================================================
-- Migration: Calendar Performance Indexes
-- Date: 2026-01-30
-- Purpose: Add missing indexes to improve calendar schedule/unschedule operations
--
-- EXECUTION INSTRUCTIONS:
-- Run WITHOUT transaction wrapping (uses CONCURRENTLY):
--   psql "$DATABASE_URL" -f migrations/2026_01_30_calendar_performance_indexes.sql
--
-- DO NOT use -1 or --single-transaction flag!
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
-- ============================================================================

-- ============================================================================
-- INDEX 1: Composite index for conflict detection queries
-- ============================================================================
-- Used by: validateSchedule() in calendarValidation.ts
-- Query pattern:
--   SELECT ... FROM jobs
--   WHERE company_id = ? AND primary_technician_id = ?
--   AND scheduled_start < ? AND scheduled_end > ?
--   AND is_all_day = ?
--
-- This index covers the conflict detection query efficiently by including
-- the date range columns and filtering to only scheduled jobs.
-- ============================================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS jobs_conflict_check_idx
ON jobs (company_id, primary_technician_id, scheduled_start, scheduled_end, is_all_day)
WHERE scheduled_start IS NOT NULL AND deleted_at IS NULL;

-- ============================================================================
-- INDEX 2: Composite index for tenant-isolated job lookups by ID
-- ============================================================================
-- Used by: getJobById(), validateJobBelongsToTenant(), and UPDATE...WHERE
-- Query pattern:
--   SELECT/UPDATE ... FROM jobs WHERE id = ? AND company_id = ?
--
-- The primary key index (jobs_pkey) only covers id. This compound index
-- ensures tenant isolation queries can use an index seek without table scan.
-- ============================================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS jobs_company_id_lookup_idx
ON jobs (company_id, id)
WHERE deleted_at IS NULL;

-- ============================================================================
-- VERIFICATION: Check index creation
-- ============================================================================
-- Run this to verify indexes were created:
--   SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'jobs';
-- ============================================================================
