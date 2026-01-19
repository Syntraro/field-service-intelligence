-- Phase 10A: QBO Sync Lock + Out-of-Sync Flagging
-- Migration: Add billing lock and out-of-sync tracking columns to invoices

-- ============================================================================
-- ADD NEW COLUMNS
-- ============================================================================

-- Billing lock columns
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_locked_at TIMESTAMP;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_lock_reason TEXT;

-- Out-of-sync tracking columns
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS qbo_out_of_sync BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS qbo_out_of_sync_at TIMESTAMP;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS qbo_out_of_sync_reason TEXT;

-- Audit columns for billing edits
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS last_billing_edit_at TIMESTAMP;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS last_billing_edit_by VARCHAR(255);

-- ============================================================================
-- BACKFILL BILLING LOCK FOR ALREADY SYNCED INVOICES
-- ============================================================================

-- If qbo_invoice_id is set OR qbo_last_synced_at is set, the invoice is synced
-- Set billing_locked_at = qbo_last_synced_at (or now() if null but qbo_invoice_id exists)
-- Set billing_lock_reason = 'QBO_SYNCED'

UPDATE invoices
SET
  billing_locked_at = COALESCE(qbo_last_synced_at, CURRENT_TIMESTAMP),
  billing_lock_reason = 'QBO_SYNCED'
WHERE
  billing_locked_at IS NULL
  AND (qbo_invoice_id IS NOT NULL OR qbo_last_synced_at IS NOT NULL);

-- ============================================================================
-- INDEXES FOR EFFICIENT LOOKUPS
-- ============================================================================

-- Index for finding out-of-sync invoices by company
CREATE INDEX IF NOT EXISTS invoices_company_qbo_out_of_sync_idx
ON invoices(company_id, qbo_out_of_sync);

-- Index for finding synced invoices by company
CREATE INDEX IF NOT EXISTS invoices_company_qbo_synced_at_idx
ON invoices(company_id, qbo_last_synced_at);

-- Index for QBO invoice ID lookups
CREATE INDEX IF NOT EXISTS invoices_qbo_invoice_id_idx
ON invoices(qbo_invoice_id);

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON COLUMN invoices.billing_locked_at IS 'Timestamp when billing was locked (typically on QBO sync)';
COMMENT ON COLUMN invoices.billing_lock_reason IS 'Reason for billing lock: QBO_SYNCED or other reason';
COMMENT ON COLUMN invoices.qbo_out_of_sync IS 'True if invoice was edited after QBO sync (requires manual reconciliation)';
COMMENT ON COLUMN invoices.qbo_out_of_sync_at IS 'Timestamp when invoice went out of sync with QBO';
COMMENT ON COLUMN invoices.qbo_out_of_sync_reason IS 'User-provided reason for the out-of-sync edit';
COMMENT ON COLUMN invoices.last_billing_edit_at IS 'Timestamp of last billing-impacting edit';
COMMENT ON COLUMN invoices.last_billing_edit_by IS 'User ID who made the last billing-impacting edit';
