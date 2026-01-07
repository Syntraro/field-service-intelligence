-- Migration: Add time tracking and assignment capabilities to tasks
-- Description: Adds clientId, duration fields, and performance indexes to tasks table
-- Date: 2026-01-07

-- Add new columns for enhanced task tracking
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS client_id VARCHAR REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS estimated_duration_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS actual_duration_minutes INTEGER;

-- Create indexes for common query patterns (if they don't exist)
-- Note: Using CREATE INDEX IF NOT EXISTS for idempotency
CREATE INDEX IF NOT EXISTS tasks_company_assigned_idx ON tasks(company_id, assigned_to_user_id);
CREATE INDEX IF NOT EXISTS tasks_company_status_idx ON tasks(company_id, status);
CREATE INDEX IF NOT EXISTS tasks_company_job_idx ON tasks(company_id, job_id);
CREATE INDEX IF NOT EXISTS tasks_company_client_idx ON tasks(company_id, client_id);

-- Data cleanup: Ensure all tasks have valid status values
-- Map old status values to new enum if needed
UPDATE tasks SET status = 'pending' WHERE status NOT IN ('pending', 'in_progress', 'completed', 'cancelled');

-- Add comment for documentation
COMMENT ON COLUMN tasks.client_id IS 'Optional reference to client for task organization';
COMMENT ON COLUMN tasks.estimated_duration_minutes IS 'Estimated time to complete task in minutes';
COMMENT ON COLUMN tasks.actual_duration_minutes IS 'Actual time taken, auto-calculated from checkedInAt to checkedOutAt';
