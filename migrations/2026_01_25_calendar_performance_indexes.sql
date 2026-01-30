-- Calendar Performance Indexes Migration
-- Adds composite indexes to improve calendar range query and audit history performance
--
-- ============================================================================
-- IMPORTANT: NON-TRANSACTIONAL MIGRATION
-- ============================================================================
-- This migration uses CREATE INDEX CONCURRENTLY which CANNOT run inside a
-- transaction block. PostgreSQL will error with:
--   "CREATE INDEX CONCURRENTLY cannot run inside a transaction block"
--
-- CORRECT execution (default psql behavior, no transaction):
--   psql "$DATABASE_URL" -f migrations/2026_01_25_calendar_performance_indexes.sql
--
-- INCORRECT (will fail):
--   psql "$DATABASE_URL" -1 -f migrations/2026_01_25_calendar_performance_indexes.sql
--   psql "$DATABASE_URL" --single-transaction -f ...
--   BEGIN; \i migrations/2026_01_25_calendar_performance_indexes.sql; COMMIT;
--
-- The CONCURRENTLY option allows index creation without blocking writes,
-- which is critical for production deployments.
-- ============================================================================

-- ============================================================================
-- Jobs Table: Calendar Range Indexes
-- ============================================================================
-- These indexes optimize the primary calendar query pattern:
-- WHERE company_id = $1
--   AND deleted_at IS NULL
--   AND scheduled_start >= $2
--   AND scheduled_start < $3

-- Composite index for calendar date range queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS jobs_calendar_range_idx
  ON jobs (company_id, scheduled_start);

-- Composite index for technician-specific calendar views
CREATE INDEX CONCURRENTLY IF NOT EXISTS jobs_technician_schedule_idx
  ON jobs (company_id, primary_technician_id, scheduled_start);

-- ============================================================================
-- Job Schedule Audit: Efficient History Lookup
-- ============================================================================
-- Optimizes audit history queries: ORDER BY created_at DESC WHERE job_id = $1

-- Composite index for job audit history (replaces individual indexes)
CREATE INDEX CONCURRENTLY IF NOT EXISTS job_schedule_audit_job_history_idx
  ON job_schedule_audit (job_id, created_at);

-- Drop redundant individual indexes (now covered by composite)
DROP INDEX IF EXISTS job_schedule_audit_job_idx;
DROP INDEX IF EXISTS job_schedule_audit_created_at_idx;
-- Keep company_idx for tenant isolation queries

-- ============================================================================
-- Verification Queries (run after migration to verify index usage)
-- ============================================================================
--
-- EXPLAIN ANALYZE SELECT * FROM jobs
--   WHERE company_id = 'test-uuid'
--   AND deleted_at IS NULL
--   AND scheduled_start >= '2026-01-01'
--   AND scheduled_start < '2026-02-01';
--
-- EXPLAIN ANALYZE SELECT * FROM job_schedule_audit
--   WHERE job_id = 'test-uuid'
--   ORDER BY created_at DESC
--   LIMIT 10;
