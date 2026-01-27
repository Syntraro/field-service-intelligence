-- Migration: Add GIN index on jobs.assigned_technician_ids for array containment queries
-- Purpose: Performance optimization for technician-based calendar filtering
--
-- IMPORTANT: Run WITHOUT transaction wrapper (CONCURRENTLY cannot run in transaction)
-- Run with: psql "$DATABASE_URL" -f migrations/2026_01_27_add_gin_index_assigned_technician_ids.sql
--
-- DO NOT use: psql "$DATABASE_URL" -1 -f ... (the -1 flag wraps in transaction)

-- Create GIN index for array containment queries (@>, &&, etc.)
-- Uses gin_array_ops operator class for varchar[] arrays
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_assigned_technician_ids_gin
  ON jobs USING gin (assigned_technician_ids);

-- Verify index was created
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'jobs' AND indexname = 'idx_jobs_assigned_technician_ids_gin'
  ) THEN
    RAISE NOTICE 'SUCCESS: GIN index idx_jobs_assigned_technician_ids_gin created';
  ELSE
    RAISE WARNING 'Index creation may have failed - please verify';
  END IF;
END $$;
