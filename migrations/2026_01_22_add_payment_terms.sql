-- Migration: Add payment terms and due date workflow fields
-- Date: 2026-01-22
-- Description: Adds payment terms support to invoices and company settings

-- 1. Add defaultPaymentTermsDays to company_settings
ALTER TABLE company_settings
ADD COLUMN IF NOT EXISTS default_payment_terms_days INTEGER NOT NULL DEFAULT 30;

-- 2. Add payment terms fields to invoices
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER NOT NULL DEFAULT 30;

ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS issued_at TIMESTAMP;

ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS sent_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL;

-- 3. Backfill issued_at for existing invoices that have been sent
-- Use sentAt as the issued_at for backward compatibility
UPDATE invoices
SET issued_at = sent_at
WHERE sent_at IS NOT NULL AND issued_at IS NULL;

-- 4. Backfill due_date for invoices that don't have one
-- Use issued_at + payment_terms_days, or created_at + 30 days as fallback
UPDATE invoices
SET due_date = COALESCE(
  (COALESCE(issued_at, created_at)::date + INTERVAL '1 day' * payment_terms_days)::date,
  (created_at::date + INTERVAL '30 days')::date
)
WHERE due_date IS NULL;

-- 5. Create index for past due invoice queries
CREATE INDEX IF NOT EXISTS invoices_due_date_status_idx
ON invoices (company_id, due_date, status)
WHERE is_active = true OR is_active IS NULL;

COMMENT ON COLUMN company_settings.default_payment_terms_days IS 'Default payment terms in days for new invoices (e.g., 30 for Net 30)';
COMMENT ON COLUMN invoices.payment_terms_days IS 'Payment terms for this invoice in days (e.g., 30 for Net 30)';
COMMENT ON COLUMN invoices.issued_at IS 'When the invoice was officially issued (typically when sent)';
COMMENT ON COLUMN invoices.sent_by_user_id IS 'User who sent the invoice';
