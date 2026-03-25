-- Migration: Add compound partial index for job_visits per-job lookups
-- Run: npm run db:migrate:one -- migrations/2026_03_18_job_visits_job_company_index.sql
--
-- NOTE: CREATE INDEX CONCURRENTLY cannot run inside a transaction.
-- If the migration runner wraps in a transaction, run this manually.
--
-- Covers the hot query pattern used by:
--   jobVisits.ts listJobVisits()              → WHERE company_id = ? AND job_id = ? AND is_active = true
--   jobVisits.ts getCurrentEligibleVisit()    → scheduleEligibleVisitFilter(company_id, job_id)
--   jobVisits.ts getUncompletedVisits()       → uncompletedVisitFilter(company_id, job_id)
--   jobVisits.ts syncJobScheduleFromVisits()  → WHERE company_id = ? AND job_id = ? AND is_active = true
--   visitPredicates.ts all three predicates   → WHERE company_id = ? AND job_id = ? AND is_active = true ...
--
-- The existing single-column indexes (idx_job_visits_job, idx_job_visits_company)
-- require a bitmap AND for this common multi-predicate pattern.
-- This partial compound index lets Postgres do a single index scan.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_visits_job_company_active
ON job_visits (job_id, company_id)
WHERE is_active = true;
