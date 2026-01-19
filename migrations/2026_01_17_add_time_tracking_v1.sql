-- Time Tracking V1 Migration
-- Adds work_sessions, time_entries, and technician_job_status_events tables
-- Run this migration manually against the database

-- ============================================================================
-- WORK SESSIONS - Daily clock in/out for payroll
-- ============================================================================
CREATE TABLE IF NOT EXISTS work_sessions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  technician_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Work date (YYYY-MM-DD format)
  work_date TEXT NOT NULL,
  -- Time tracking
  clock_in_at TIMESTAMPTZ NOT NULL,
  clock_out_at TIMESTAMPTZ,
  break_minutes INTEGER,
  -- Metadata
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'web', -- 'mobile' | 'web' | 'import'
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ
);

-- Indexes for work_sessions
CREATE INDEX IF NOT EXISTS work_sessions_tech_date_idx
  ON work_sessions(company_id, technician_id, work_date);
CREATE INDEX IF NOT EXISTS work_sessions_open_idx
  ON work_sessions(company_id, technician_id);

-- ============================================================================
-- TIME ENTRIES - Granular time tracking for billing and operations
-- ============================================================================
CREATE TABLE IF NOT EXISTS time_entries (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  technician_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Optional links
  work_session_id VARCHAR REFERENCES work_sessions(id) ON DELETE SET NULL,
  job_id VARCHAR REFERENCES jobs(id) ON DELETE SET NULL,
  -- Entry type: travel_to_job, on_site, travel_to_supplier, supplier_run, travel_between_jobs, admin, break, other
  type TEXT NOT NULL,
  -- Time tracking
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ, -- NULL = currently running
  duration_minutes INTEGER, -- Computed on stop
  -- Billing
  billable BOOLEAN NOT NULL DEFAULT TRUE,
  billable_rate_snapshot TEXT, -- Snapshot of hourly rate at entry start (stored as decimal string)
  cost_rate_snapshot TEXT, -- Optional: cost rate snapshot
  -- Notes
  notes TEXT,
  -- Invoice linkage (prevents double-invoicing)
  invoice_id VARCHAR REFERENCES invoices(id) ON DELETE SET NULL,
  invoice_line_id VARCHAR, -- Reference to specific line item
  invoiced_at TIMESTAMPTZ, -- When this entry was invoiced
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ
);

-- Indexes for time_entries
CREATE INDEX IF NOT EXISTS time_entries_tech_start_idx
  ON time_entries(company_id, technician_id, start_at);
CREATE INDEX IF NOT EXISTS time_entries_job_idx
  ON time_entries(company_id, job_id);
CREATE INDEX IF NOT EXISTS time_entries_invoice_idx
  ON time_entries(company_id, invoice_id);
CREATE INDEX IF NOT EXISTS time_entries_running_idx
  ON time_entries(company_id, technician_id);

-- ============================================================================
-- TECHNICIAN JOB STATUS EVENTS - Mobile status updates that drive time entries
-- ============================================================================
CREATE TABLE IF NOT EXISTS technician_job_status_events (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id VARCHAR NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  technician_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Status reported by technician: dispatched, en_route, arrived, paused, completed
  status TEXT NOT NULL,
  -- When the status was reported (may differ from created_at if backfilled)
  at TIMESTAMPTZ NOT NULL,
  -- Source and notes
  source TEXT NOT NULL DEFAULT 'mobile', -- 'mobile' | 'web'
  notes TEXT,
  -- Link to time entry created/stopped by this event
  time_entry_id VARCHAR REFERENCES time_entries(id) ON DELETE SET NULL,
  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for technician_job_status_events
CREATE INDEX IF NOT EXISTS technician_job_status_events_job_at_idx
  ON technician_job_status_events(company_id, job_id, at DESC);
CREATE INDEX IF NOT EXISTS technician_job_status_events_tech_at_idx
  ON technician_job_status_events(company_id, technician_id, at DESC);

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE work_sessions IS 'Daily clock in/out records for technician payroll tracking';
COMMENT ON TABLE time_entries IS 'Granular time entries for billing - travel, on-site, admin, breaks, etc.';
COMMENT ON TABLE technician_job_status_events IS 'Mobile-initiated job status events that auto-create time entries';

COMMENT ON COLUMN time_entries.type IS 'Entry type: travel_to_job, on_site, travel_to_supplier, supplier_run, travel_between_jobs, admin, break, other';
COMMENT ON COLUMN time_entries.billable_rate_snapshot IS 'Hourly billable rate captured at entry start for consistent invoicing';
COMMENT ON COLUMN time_entries.invoiced_at IS 'Timestamp when entry was linked to invoice - prevents double-invoicing';

COMMENT ON COLUMN technician_job_status_events.status IS 'Technician job status: dispatched, en_route, arrived, paused, completed';
COMMENT ON COLUMN technician_job_status_events.time_entry_id IS 'Link to time entry created or stopped by this status event';
