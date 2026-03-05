-- Migration: Add compound index for job_visits schedule queries
-- Run: npm run db:migrate:one -- migrations/2026_03_05_job_visits_schedule_index.sql
--
-- Covers the hot query pattern used by:
--   GET /api/map/day   → WHERE company_id = ? AND is_active = true AND scheduled_start >= ? AND scheduled_start < ?
--   calendar.ts        → WHERE company_id = ? AND is_active = true AND scheduled_start IS NOT NULL
--   eligible visit     → WHERE company_id = ? AND is_active = true AND scheduled_start ...
--
-- The existing single-column indexes (idx_job_visits_company, idx_job_visits_scheduled_date)
-- cannot satisfy these multi-predicate filters efficiently. This compound index lets
-- Postgres do a single index range scan instead of a bitmap AND across separate indexes.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_visits_company_active_start
ON job_visits (company_id, is_active, scheduled_start);
