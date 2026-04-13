-- 2026_04_12_drop_job_tech_assignment.sql
-- Final schema cleanup for the Option A assignment refactor (2026-04-12).
--
-- Run instructions:
--   npm run db:migrate:one -- migrations/2026_04_12_drop_job_tech_assignment.sql
--
-- Background:
--   Over Waves 1–4 (CHANGELOG "Job-level assignment removed — visits are
--   canonical"), every read and write of jobs.primary_technician_id and
--   jobs.assigned_technician_ids was removed from the codebase and replaced
--   with visit-derived logic (server/storage/visitCrew.ts). The columns have
--   been quiescent — not read, not written — for the duration of the refactor.
--   Tests cover this both at the code level (guard suite
--   tests/job-assignment-visit-authority.test.ts) and at the SQL level (the
--   stale-data guard test populates stale values via raw SQL and verifies the
--   derived resolver ignores them).
--
--   Visits remain the canonical source of technician assignment via
--   job_visits.assigned_technician_ids. Tasks are untouched.
--
-- Schema impact:
--   - Drops dead FK + column jobs.primary_technician_id (→ users.id).
--   - Drops dead column jobs.assigned_technician_ids (varchar[]).
--   - Drops unused composite index jobs_technician_schedule_idx
--     (company_id, primary_technician_id, scheduled_start) — no remaining
--     query uses primary_technician_id as a filter key; calendar/"my jobs"
--     filters traverse job_visits.assigned_technician_ids via EXISTS, which
--     hits the existing idx_job_visits_job_company_active index.
--
-- Data impact:
--   - Any stale values in these columns are discarded. The stale-data guard
--     test already proved no live code path reads them.
--
-- Rollback:
--   BEGIN;
--     ALTER TABLE jobs
--       ADD COLUMN primary_technician_id varchar
--         REFERENCES users(id) ON DELETE SET NULL,
--       ADD COLUMN assigned_technician_ids varchar[];
--     CREATE INDEX jobs_technician_schedule_idx
--       ON jobs (company_id, primary_technician_id, scheduled_start);
--   COMMIT;
--   NOTE: rollback restores empty columns only. The historical assignment
--   data was never authoritative and has been derivable from job_visits
--   since before this refactor — nothing to backfill.

BEGIN;

-- 1. Drop the composite index that keyed off primary_technician_id.
DROP INDEX IF EXISTS jobs_technician_schedule_idx;

-- 2. Drop the two dead columns. Drizzle's FK auto-named
--    jobs_primary_technician_id_fkey — use IF EXISTS on the column drop to
--    avoid coupling the migration to the constraint's exact name. Postgres
--    will drop the constraint automatically when the column is dropped.
ALTER TABLE jobs
  DROP COLUMN IF EXISTS primary_technician_id,
  DROP COLUMN IF EXISTS assigned_technician_ids;

COMMIT;
