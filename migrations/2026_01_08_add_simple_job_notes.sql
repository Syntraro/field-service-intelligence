-- Migration: Add simple_job_notes table for job comments
-- Date: 2026-01-08
-- Feature: Job Notes - Simple notes/comments on jobs

-- ==============================================================================
-- CREATE SIMPLE_JOB_NOTES TABLE
-- ==============================================================================

CREATE TABLE simple_job_notes (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id VARCHAR NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_text TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP
);

-- ==============================================================================
-- CREATE INDEXES FOR COMMON QUERIES
-- ==============================================================================

CREATE INDEX idx_simple_job_notes_company ON simple_job_notes(company_id);
CREATE INDEX idx_simple_job_notes_job ON simple_job_notes(job_id);
CREATE INDEX idx_simple_job_notes_user ON simple_job_notes(user_id);
CREATE INDEX idx_simple_job_notes_created ON simple_job_notes(created_at DESC);

-- ==============================================================================
-- ADD COMMENTS
-- ==============================================================================

COMMENT ON TABLE simple_job_notes IS 'Simple notes/comments on jobs for tracking details and communication';
COMMENT ON COLUMN simple_job_notes.is_active IS 'Soft delete flag - false = deleted';

-- ==============================================================================
-- VERIFICATION
-- ==============================================================================

SELECT 'simple_job_notes table created successfully' AS status;
SELECT COUNT(*) AS row_count FROM simple_job_notes;

-- ==============================================================================
-- ROLLBACK INSTRUCTIONS (IF NEEDED)
-- ==============================================================================

-- To rollback this migration, run:
-- DROP TABLE IF EXISTS simple_job_notes CASCADE;

-- ==============================================================================
-- MIGRATION COMPLETE
-- ==============================================================================
