-- Add is_schedulable column to users table
-- This column controls whether the user appears in calendar/scheduling dropdowns
-- Default is true (all users are schedulable by default)
-- Independent of role - schedulability is an explicit per-user setting

ALTER TABLE users
ADD COLUMN IF NOT EXISTS is_schedulable BOOLEAN NOT NULL DEFAULT true;

-- Add comment for documentation
COMMENT ON COLUMN users.is_schedulable IS 'If true, user appears in calendar/scheduling dropdowns for job assignment';
