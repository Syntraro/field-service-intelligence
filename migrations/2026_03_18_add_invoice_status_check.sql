-- 2026-03-18: Add CHECK constraint for invoice status vocabulary.
--
-- Canonical invoice statuses (6 values):
--   draft, awaiting_payment, sent, partial_paid, paid, voided
--
-- "sent" is a legacy alias for "awaiting_payment" — kept for backward compatibility
-- with any existing persisted data. The send-invoice endpoint writes "awaiting_payment".
--
-- Run: psql "$DATABASE_URL" -f migrations/2026_03_18_add_invoice_status_check.sql

ALTER TABLE invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'awaiting_payment', 'sent', 'partial_paid', 'paid', 'voided'));
