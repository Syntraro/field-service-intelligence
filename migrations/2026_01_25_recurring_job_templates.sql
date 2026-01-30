-- Recurring Job Templates and Instances
-- Enables recurring job generation into the backlog

-- ============================================================================
-- RECURRING JOB TEMPLATES
-- ============================================================================
-- Stores recurring job patterns for automatic job generation

CREATE TABLE IF NOT EXISTS recurring_job_templates (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Optional client/location linkage
  client_id VARCHAR REFERENCES customer_companies(id) ON DELETE SET NULL,
  location_id VARCHAR REFERENCES client_locations(id) ON DELETE SET NULL,
  -- Job template details
  title TEXT NOT NULL,
  description TEXT,
  notes TEXT,
  default_duration_minutes INTEGER,
  preferred_technician_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  job_type TEXT NOT NULL DEFAULT 'maintenance',
  priority TEXT NOT NULL DEFAULT 'medium',
  -- Status for generated jobs (must be backlog-compatible: open, assigned, on_hold)
  status_default TEXT NOT NULL DEFAULT 'open',
  hold_reason TEXT, -- Required if status_default = 'on_hold'
  -- Active/inactive toggle
  is_active BOOLEAN NOT NULL DEFAULT true,
  -- Recurrence schedule
  start_date DATE NOT NULL,
  end_date DATE,
  timezone TEXT, -- IANA string, fallback to company_settings.timezone
  -- Recurrence pattern
  recurrence_kind TEXT NOT NULL DEFAULT 'weekly', -- 'weekly' | 'monthly'
  interval INTEGER NOT NULL DEFAULT 1, -- every N weeks/months
  days_of_week INTEGER[], -- 0=Sun..6=Sat, for weekly recurrence
  day_of_month INTEGER, -- 1..31, for monthly (null = use start_date day)
  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS recurring_job_templates_company_idx
  ON recurring_job_templates (company_id);

CREATE INDEX IF NOT EXISTS recurring_job_templates_company_active_idx
  ON recurring_job_templates (company_id, is_active);

-- ============================================================================
-- RECURRING JOB INSTANCES
-- ============================================================================
-- Tracks generated job instances for idempotency and history

CREATE TABLE IF NOT EXISTS recurring_job_instances (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  template_id VARCHAR NOT NULL REFERENCES recurring_job_templates(id) ON DELETE CASCADE,
  instance_date DATE NOT NULL,
  generated_job_id VARCHAR REFERENCES jobs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'generated', -- 'generated' | 'skipped' | 'canceled'
  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS recurring_job_instances_company_idx
  ON recurring_job_instances (company_id);

CREATE INDEX IF NOT EXISTS recurring_job_instances_template_idx
  ON recurring_job_instances (template_id);

-- Unique constraint for idempotency: one instance per template per date
CREATE UNIQUE INDEX IF NOT EXISTS recurring_job_instances_template_date_uniq
  ON recurring_job_instances (template_id, instance_date);
