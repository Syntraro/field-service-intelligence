-- Migration: Add job_visits table for tracking site visits
-- Date: 2026-01-08
-- Feature: Job Visits - Track multiple scheduled visits per job

-- ==============================================================================
-- CREATE JOB_VISITS TABLE
-- ==============================================================================

CREATE TABLE job_visits (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id VARCHAR NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  
  -- Scheduling
  scheduled_date TIMESTAMP NOT NULL,
  estimated_duration_minutes INTEGER DEFAULT 60,
  
  -- Assignment
  assigned_technician_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'scheduled',
  
  -- Time tracking
  checked_in_at TIMESTAMP,
  checked_out_at TIMESTAMP,
  actual_duration_minutes INTEGER,
  
  -- Notes
  visit_notes TEXT,
  
  -- Soft deletion
  is_active BOOLEAN NOT NULL DEFAULT true,
  
  -- Optimistic locking
  version INTEGER NOT NULL DEFAULT 0,
  
  -- Audit timestamps
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP
);

-- ==============================================================================
-- CREATE INDEXES FOR COMMON QUERIES
-- ==============================================================================

CREATE INDEX idx_job_visits_company ON job_visits(company_id);
CREATE INDEX idx_job_visits_job ON job_visits(job_id);
CREATE INDEX idx_job_visits_technician ON job_visits(assigned_technician_id);
CREATE INDEX idx_job_visits_scheduled_date ON job_visits(scheduled_date);
CREATE INDEX idx_job_visits_status ON job_visits(status);

-- ==============================================================================
-- ADD COMMENTS
-- ==============================================================================

COMMENT ON TABLE job_visits IS 'Tracks individual scheduled visits/appointments for jobs';
COMMENT ON COLUMN job_visits.actual_duration_minutes IS 'Auto-calculated on check-out from checked_in_at to checked_out_at';
COMMENT ON COLUMN job_visits.version IS 'Optimistic locking version counter - incremented on every update';
COMMENT ON COLUMN job_visits.is_active IS 'Soft delete flag - false = deleted';

-- ==============================================================================
-- VERIFICATION
-- ==============================================================================

SELECT 'job_visits table created successfully' AS status;
SELECT COUNT(*) AS row_count FROM job_visits;

-- ==============================================================================
-- ROLLBACK INSTRUCTIONS (IF NEEDED)
-- ==============================================================================

-- To rollback this migration, run:
-- DROP TABLE IF EXISTS job_visits CASCADE;

-- ==============================================================================
-- MIGRATION COMPLETE
-- ==============================================================================
