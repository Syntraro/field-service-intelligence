-- Add claimed_at column for stale claim recovery
-- Tracks when an instance transitioned to "claiming" status

ALTER TABLE recurring_job_instances
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP;

-- Index for finding stale claims efficiently
CREATE INDEX IF NOT EXISTS recurring_job_instances_stale_claims_idx
  ON recurring_job_instances (status, claimed_at)
  WHERE status = 'claiming';
