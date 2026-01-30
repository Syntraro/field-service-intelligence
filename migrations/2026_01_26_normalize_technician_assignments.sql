-- Migration: Normalize Technician Assignments
-- Phase 1 Step 3: Team & Technician Consistency
--
-- CANONICAL INVARIANT:
-- If primaryTechnicianId is set, it MUST be included in assignedTechnicianIds.
-- assignedTechnicianIds is THE array of all assigned techs.
-- assignedTechnicianIds must never be NULL (use empty array).
--
-- EXECUTION: Run without transaction wrapper (no -1 flag)
-- psql "$DATABASE_URL" -f migrations/2026_01_26_normalize_technician_assignments.sql

-- Step 1: Convert NULL assignedTechnicianIds to empty array
UPDATE jobs
SET assigned_technician_ids = ARRAY[]::varchar[]
WHERE assigned_technician_ids IS NULL;

-- Step 2: Ensure primaryTechnicianId is in assignedTechnicianIds
-- If primary is set but not in the array, add it
UPDATE jobs
SET assigned_technician_ids = array_append(assigned_technician_ids, primary_technician_id)
WHERE primary_technician_id IS NOT NULL
  AND NOT (primary_technician_id = ANY(assigned_technician_ids));

-- Step 3: Remove duplicates from assignedTechnicianIds
-- Use a subquery to get unique values while preserving order
UPDATE jobs
SET assigned_technician_ids = (
  SELECT ARRAY(SELECT DISTINCT unnest(assigned_technician_ids))
)
WHERE array_length(assigned_technician_ids, 1) > 1
  AND array_length(assigned_technician_ids, 1) != array_length(
    (SELECT ARRAY(SELECT DISTINCT unnest(assigned_technician_ids))), 1
  );

-- Step 4: Verify the invariant holds (should return 0 rows)
-- This is a diagnostic query - any results indicate a violation
SELECT
  id,
  job_number,
  primary_technician_id,
  assigned_technician_ids,
  'PRIMARY NOT IN ASSIGNED' as violation
FROM jobs
WHERE primary_technician_id IS NOT NULL
  AND NOT (primary_technician_id = ANY(assigned_technician_ids))
  AND deleted_at IS NULL;

-- Summary of changes
SELECT
  'Jobs with NULL assignedTechnicianIds (before)' as metric,
  COUNT(*) as count
FROM jobs
WHERE assigned_technician_ids IS NULL

UNION ALL

SELECT
  'Jobs with primary not in assigned (should be 0)' as metric,
  COUNT(*) as count
FROM jobs
WHERE primary_technician_id IS NOT NULL
  AND NOT (primary_technician_id = ANY(COALESCE(assigned_technician_ids, ARRAY[]::varchar[])))
  AND deleted_at IS NULL;
