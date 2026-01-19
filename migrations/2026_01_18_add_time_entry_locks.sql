-- Time Tracking Phase 9: Time Entry Locking + Invoice Integrity
-- Migration: Add lock columns to time_entries table

-- ============================================================================
-- TIME ENTRY LOCK COLUMNS
-- ============================================================================

-- Add lock columns to time_entries
ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS locked_by_invoice_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS lock_reason TEXT;

-- Index for finding entries locked by a specific invoice
CREATE INDEX IF NOT EXISTS time_entries_locked_by_invoice_idx
ON time_entries(locked_by_invoice_id)
WHERE locked_by_invoice_id IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN time_entries.locked_at IS 'Timestamp when entry was locked (prevents edits)';
COMMENT ON COLUMN time_entries.locked_by_invoice_id IS 'Invoice ID that caused the lock (app-managed, no FK for safety)';
COMMENT ON COLUMN time_entries.lock_reason IS 'Reason for locking, e.g., INVOICED';

-- ============================================================================
-- BACKFILL: Lock existing invoiced entries
-- ============================================================================

-- Lock any time entries that have already been invoiced but don't have lock fields set
UPDATE time_entries
SET
  locked_at = invoiced_at,
  locked_by_invoice_id = invoice_id,
  lock_reason = 'INVOICED'
WHERE
  invoiced_at IS NOT NULL
  AND locked_at IS NULL;
