-- Migration: Add soft-delete archive columns to job_visits
-- Run: npm run db:migrate:one -- migrations/2026_03_05_job_visits_archived_columns.sql
--
-- Adds archivedAt, archivedByUserId, archivedReason columns for proper
-- soft-delete archival distinct from the existing isActive flag.
-- archivedAt IS NULL means "not archived" (default for all queries).

ALTER TABLE job_visits
  ADD COLUMN IF NOT EXISTS archived_at      TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS archived_by_user_id VARCHAR DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS archived_reason   TEXT DEFAULT NULL;

-- Partial index for efficient filtering (non-concurrent for transaction compat)
CREATE INDEX IF NOT EXISTS idx_job_visits_archived_at
  ON job_visits (archived_at)
  WHERE archived_at IS NULL;
