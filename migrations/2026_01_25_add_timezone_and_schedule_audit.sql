-- Migration: Add timezone to company_settings and job_schedule_audit table
-- Date: 2026-01-25
-- Purpose: Timezone-aware scheduling and scheduling audit trail

-- Add timezone column to company_settings
ALTER TABLE company_settings
ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Toronto';

-- Add comment for clarity
COMMENT ON COLUMN company_settings.timezone IS 'IANA timezone string for scheduling (e.g., America/Toronto, America/New_York)';

-- Create job_schedule_audit table for tracking scheduling changes
CREATE TABLE IF NOT EXISTS job_schedule_audit (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  context_label TEXT NOT NULL,
  old_fields JSONB,
  new_fields JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add index for querying audit by job
CREATE INDEX IF NOT EXISTS idx_job_schedule_audit_job_id ON job_schedule_audit(job_id);

-- Add index for querying audit by company
CREATE INDEX IF NOT EXISTS idx_job_schedule_audit_company_id ON job_schedule_audit(company_id);

-- Add index for querying audit by timestamp
CREATE INDEX IF NOT EXISTS idx_job_schedule_audit_created_at ON job_schedule_audit(created_at DESC);

-- Add comment for the audit table
COMMENT ON TABLE job_schedule_audit IS 'Audit trail for job scheduling changes (schedule, status derived from schedule)';
