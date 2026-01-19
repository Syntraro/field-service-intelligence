-- Time Tracking Phase 8: Billing Rules + Rounding + Invoice Accuracy
-- Migration: Add time_billing_rules table and extend time_entries with billing snapshots

-- ============================================================================
-- TIME BILLING RULES
-- ============================================================================

CREATE TABLE IF NOT EXISTS time_billing_rules (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR(255) NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  -- Rounding settings
  rounding_increment_minutes INTEGER NOT NULL DEFAULT 15,
  rounding_mode TEXT NOT NULL DEFAULT 'up',  -- up | nearest | down
  minimum_billable_minutes INTEGER NOT NULL DEFAULT 15,
  -- Type-specific billing toggles
  bill_travel BOOLEAN NOT NULL DEFAULT true,
  bill_supplier_run BOOLEAN NOT NULL DEFAULT true,
  bill_admin BOOLEAN NOT NULL DEFAULT false,
  -- Rate multipliers (stored as decimal strings for precision)
  travel_rate_multiplier TEXT NOT NULL DEFAULT '1.0',
  on_site_rate_multiplier TEXT NOT NULL DEFAULT '1.0',
  -- Optional caps
  max_travel_minutes_per_job_per_day INTEGER,  -- NULL = no cap
  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP
);

-- ============================================================================
-- EXTEND TIME_ENTRIES WITH BILLING SNAPSHOTS
-- ============================================================================

-- Add billing rule snapshots to time_entries (captured at invoice time for audit trail)
ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS billed_minutes_snapshot INTEGER,
  ADD COLUMN IF NOT EXISTS billed_rate_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS billing_rules_hash TEXT;

-- Add comment for documentation
COMMENT ON COLUMN time_entries.billed_minutes_snapshot IS 'Final minutes after billing rules applied (rounding, minimums, caps)';
COMMENT ON COLUMN time_entries.billed_rate_snapshot IS 'Final hourly rate after multipliers applied';
COMMENT ON COLUMN time_entries.billing_rules_hash IS 'Hash of billing rules used at invoice time for audit trail';
