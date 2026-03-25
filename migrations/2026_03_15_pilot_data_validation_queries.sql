-- Pilot Data Validation Queries
-- Date: 2026-03-15
-- Purpose: Detect data integrity issues before Phase 1 pilot rollout (10–25 customers).
--          These are READ-ONLY diagnostic queries. No data is modified.
--
-- Run each query individually to check for issues.
-- All queries are tenant-safe (filter by company_id where applicable).

-- ============================================================================
-- 1. Duplicate customer company names (within same tenant)
-- ============================================================================
SELECT company_id, LOWER(TRIM(name)) AS normalized_name, COUNT(*) AS cnt,
       ARRAY_AGG(id ORDER BY created_at) AS ids
FROM customer_companies
WHERE deleted_at IS NULL
GROUP BY company_id, LOWER(TRIM(name))
HAVING COUNT(*) > 1;

-- ============================================================================
-- 2. Customer companies without any locations
-- ============================================================================
SELECT cc.id, cc.company_id, cc.name
FROM customer_companies cc
LEFT JOIN client_locations cl
  ON cl.parent_company_id = cc.id AND cl.deleted_at IS NULL
WHERE cc.deleted_at IS NULL
  AND cl.id IS NULL;

-- ============================================================================
-- 3. Locations without a parent customer company
--    (parentCompanyId IS NULL — standalone locations)
-- ============================================================================
SELECT cl.id, cl.company_id, cl.company_name, cl.location, cl.parent_company_id
FROM client_locations cl
WHERE cl.deleted_at IS NULL
  AND cl.parent_company_id IS NULL;

-- ============================================================================
-- 4. Contacts without a valid customer company
-- ============================================================================
SELECT cc2.id AS contact_id, cc2.customer_company_id, cc2.first_name, cc2.last_name
FROM client_contacts cc2
LEFT JOIN customer_companies cco
  ON cco.id = cc2.customer_company_id
WHERE cco.id IS NULL OR cco.deleted_at IS NOT NULL;

-- ============================================================================
-- 5. Orphan equipment (location deleted or missing)
-- ============================================================================
SELECT le.id, le.company_id, le.location_id, le.name
FROM location_equipment le
LEFT JOIN client_locations cl ON cl.id = le.location_id
WHERE le.deleted_at IS NULL
  AND (cl.id IS NULL OR cl.deleted_at IS NOT NULL);

-- ============================================================================
-- 6. Orphan jobs (location deleted or missing)
-- ============================================================================
SELECT j.id, j.company_id, j.job_number, j.location_id, j.status
FROM jobs j
LEFT JOIN client_locations cl ON cl.id = j.location_id
WHERE j.deleted_at IS NULL
  AND (cl.id IS NULL OR cl.deleted_at IS NOT NULL);

-- ============================================================================
-- 7. Orphan visits (job deleted or missing)
-- ============================================================================
SELECT jv.id, jv.company_id, jv.job_id, jv.status
FROM job_visits jv
LEFT JOIN jobs j ON j.id = jv.job_id
WHERE jv.is_active = true
  AND (j.id IS NULL OR j.deleted_at IS NOT NULL);
