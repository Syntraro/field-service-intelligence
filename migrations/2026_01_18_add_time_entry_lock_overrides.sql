-- Time Tracking Phase 9 Finalization: Lock Override Audit Trail
-- Migration: Add time_entry_lock_overrides table

-- ============================================================================
-- TIME ENTRY LOCK OVERRIDES - Audit trail for manager lock overrides
-- ============================================================================

CREATE TABLE IF NOT EXISTS time_entry_lock_overrides (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR(255) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  time_entry_id VARCHAR(255) NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
  invoice_id VARCHAR(255), -- The invoice that had locked the entry (if applicable)
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL, -- Required reason for override
  before_json TEXT, -- Snapshot of entry before change (minimal fields)
  after_json TEXT, -- Snapshot of entry after change (minimal fields)
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS time_entry_lock_overrides_company_idx
ON time_entry_lock_overrides(company_id);

CREATE INDEX IF NOT EXISTS time_entry_lock_overrides_entry_idx
ON time_entry_lock_overrides(time_entry_id);

CREATE INDEX IF NOT EXISTS time_entry_lock_overrides_created_idx
ON time_entry_lock_overrides(created_at);

-- Add comments for documentation
COMMENT ON TABLE time_entry_lock_overrides IS 'Audit trail for manager overrides of time entry invoice locks';
COMMENT ON COLUMN time_entry_lock_overrides.reason IS 'Required reason for why the lock was overridden';
COMMENT ON COLUMN time_entry_lock_overrides.before_json IS 'Minimal snapshot of entry state before the change';
COMMENT ON COLUMN time_entry_lock_overrides.after_json IS 'Minimal snapshot of entry state after the change';
