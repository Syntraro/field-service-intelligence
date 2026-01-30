-- Migration: Fix Missing Invoice Columns
-- Root Cause: Migration 2026_01_18_add_invoice_qbo_lock_out_of_sync.sql was partially applied
-- This migration adds ONLY the columns that are missing from the database
-- Created: 2026-01-21

-- ============================================================================
-- ADD MISSING COLUMNS (idempotent - uses IF NOT EXISTS)
-- ============================================================================

-- billing_lock_reason: Missing from partial migration
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_lock_reason TEXT;

-- qbo_out_of_sync_at: Missing from partial migration
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS qbo_out_of_sync_at TIMESTAMP;

-- qbo_out_of_sync_reason: Missing from partial migration
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS qbo_out_of_sync_reason TEXT;

-- last_billing_edit_at: Missing from partial migration
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS last_billing_edit_at TIMESTAMP;

-- last_billing_edit_by: Missing from partial migration
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS last_billing_edit_by VARCHAR(255);

-- ============================================================================
-- BACKFILL BILLING LOCK REASON FOR ALREADY LOCKED INVOICES
-- ============================================================================

-- If billing_locked_at is set but billing_lock_reason is NULL, set a default reason
UPDATE invoices
SET billing_lock_reason = 'QBO_SYNCED'
WHERE billing_locked_at IS NOT NULL
  AND billing_lock_reason IS NULL;

-- ============================================================================
-- VERIFICATION BLOCK
-- ============================================================================

DO $$
DECLARE
  missing_cols TEXT[];
  col TEXT;
BEGIN
  missing_cols := ARRAY[]::TEXT[];

  -- Check each required column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'billing_lock_reason') THEN
    missing_cols := array_append(missing_cols, 'billing_lock_reason');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'qbo_out_of_sync_at') THEN
    missing_cols := array_append(missing_cols, 'qbo_out_of_sync_at');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'qbo_out_of_sync_reason') THEN
    missing_cols := array_append(missing_cols, 'qbo_out_of_sync_reason');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'last_billing_edit_at') THEN
    missing_cols := array_append(missing_cols, 'last_billing_edit_at');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'last_billing_edit_by') THEN
    missing_cols := array_append(missing_cols, 'last_billing_edit_by');
  END IF;

  IF array_length(missing_cols, 1) > 0 THEN
    RAISE EXCEPTION 'Migration failed: Missing columns: %', array_to_string(missing_cols, ', ');
  END IF;

  RAISE NOTICE 'Migration successful: All required invoice columns exist';
END $$;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON COLUMN invoices.billing_lock_reason IS 'Reason for billing lock: QBO_SYNCED or other reason';
COMMENT ON COLUMN invoices.qbo_out_of_sync_at IS 'Timestamp when invoice went out of sync with QBO';
COMMENT ON COLUMN invoices.qbo_out_of_sync_reason IS 'User-provided reason for the out-of-sync edit';
COMMENT ON COLUMN invoices.last_billing_edit_at IS 'Timestamp of last billing-impacting edit';
COMMENT ON COLUMN invoices.last_billing_edit_by IS 'User ID who made the last billing-impacting edit';
