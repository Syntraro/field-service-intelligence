-- Migration: Add Invoice Discount Fields
-- Phase 11: Invoice Corrections + Discount Support
-- Created: 2026-01-19

-- Add discount columns to invoices table
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS discount_type TEXT,
ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5, 2),
ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12, 2),
ADD COLUMN IF NOT EXISTS discount_notes TEXT;

-- Add comment for documentation
COMMENT ON COLUMN invoices.discount_type IS 'PERCENT or AMOUNT - indicates which value was user-entered';
COMMENT ON COLUMN invoices.discount_percent IS 'Discount percentage (e.g., 10.00 for 10%)';
COMMENT ON COLUMN invoices.discount_amount IS 'Discount currency amount';
COMMENT ON COLUMN invoices.discount_notes IS 'Optional reason/description for the discount';

-- Verify columns were added
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'discount_type'
  ) THEN
    RAISE EXCEPTION 'Migration failed: discount_type column not created';
  END IF;
END $$;
