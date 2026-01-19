-- Time Tracking Phase 4: Time Approvals table for payroll approval workflow
-- Run this migration manually: psql $DATABASE_URL < migrations/2026_01_17_add_time_approvals.sql

-- Create time_approvals table
CREATE TABLE IF NOT EXISTS time_approvals (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    technician_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Week boundaries (Monday to Sunday)
    week_start TEXT NOT NULL, -- YYYY-MM-DD (Monday)
    week_end TEXT NOT NULL,   -- YYYY-MM-DD (Sunday)
    -- Approval info
    approved_by_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    approved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Unique constraint: one approval per technician per week per company
    UNIQUE(company_id, technician_id, week_start)
);

-- Index for fetching approvals by week
CREATE INDEX IF NOT EXISTS time_approvals_week_idx
    ON time_approvals(company_id, week_start);

-- Index for fetching approvals by technician
CREATE INDEX IF NOT EXISTS time_approvals_tech_week_idx
    ON time_approvals(company_id, technician_id, week_start);

-- Comments
COMMENT ON TABLE time_approvals IS 'Weekly payroll approvals for technicians. Once approved, time entries and work sessions for that week are locked.';
COMMENT ON COLUMN time_approvals.week_start IS 'Monday of the approved week in YYYY-MM-DD format';
COMMENT ON COLUMN time_approvals.week_end IS 'Sunday of the approved week in YYYY-MM-DD format';
COMMENT ON COLUMN time_approvals.approved_by_user_id IS 'Manager who approved this week';
