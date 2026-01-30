-- Add recurrence linkage columns to jobs table
-- Links generated jobs back to their recurring template and instance date

-- Add columns for recurrence tracking
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS recurrence_template_id VARCHAR,
  ADD COLUMN IF NOT EXISTS recurrence_instance_date DATE;

-- Index for finding jobs by template
CREATE INDEX IF NOT EXISTS jobs_recurrence_template_idx
  ON jobs (recurrence_template_id)
  WHERE recurrence_template_id IS NOT NULL;

-- Comment: Foreign key not added here since recurring_job_templates
-- may not exist in older databases. Data integrity is ensured by
-- the generation logic in server/domain/recurrence.ts.
