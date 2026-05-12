-- migrations/2026_05_12_timer_data_integrity_backstops.sql
-- Run: npm run db:migrate:one -- migrations/2026_05_12_timer_data_integrity_backstops.sql
--
-- PREFLIGHT — run these queries before applying and stop if any rows are returned.
-- Duplicates must be remediated manually; this migration does NOT auto-resolve them.
--
-- Detect duplicate running time_entries (end_at IS NULL) per tech:
--   SELECT company_id, technician_id, COUNT(*), array_agg(id) AS ids
--   FROM time_entries
--   WHERE end_at IS NULL
--   GROUP BY company_id, technician_id
--   HAVING COUNT(*) > 1;
--
-- Detect duplicate open work_sessions (clock_out_at IS NULL) per tech per day:
--   SELECT company_id, technician_id, work_date, COUNT(*), array_agg(id) AS ids
--   FROM work_sessions
--   WHERE clock_out_at IS NULL
--   GROUP BY company_id, technician_id, work_date
--   HAVING COUNT(*) > 1;
--
-- REMEDIATION (production only — do not run speculatively):
--   If duplicates exist, end all but the latest running entry per tech before applying:
--   UPDATE time_entries SET end_at = NOW(), duration_minutes = 0
--   WHERE end_at IS NULL
--     AND id NOT IN (
--       SELECT DISTINCT ON (company_id, technician_id) id
--       FROM time_entries
--       WHERE end_at IS NULL
--       ORDER BY company_id, technician_id, start_at DESC
--     );

-- ============================================================================
-- 1. DB backstop: enforce one running time entry per company+technician
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_one_running_per_tech
  ON time_entries (company_id, technician_id)
  WHERE end_at IS NULL;

-- ============================================================================
-- 2. DB backstop: enforce one open work session per company+technician per day
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS work_sessions_one_open_per_tech_per_day
  ON work_sessions (company_id, technician_id, work_date)
  WHERE clock_out_at IS NULL;

-- ============================================================================
-- 3. Idempotency key for offline note replay
--    Nullable — existing notes and non-offline creates have no key.
--    Unique per (company_id, idempotency_key) so replay cannot duplicate a note.
-- ============================================================================
ALTER TABLE job_notes
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS job_notes_company_idempotency_key_unique
  ON job_notes (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
