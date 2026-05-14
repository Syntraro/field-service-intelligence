-- Run: npm run db:migrate:one -- migrations/2026_05_13_invoice_receivables_fields.sql
--
-- Adds three denormalized collection-state fields to invoices for fast view
-- filtering in the Receivables workspace. These fields are kept in sync by
-- the receivables_notes storage layer — never written directly via
-- PATCH /api/invoices/:id. The payment path clears promisedPaymentAt and
-- isDisputed when an invoice transitions to "paid".
--
-- followUpAt      — user-scheduled next-action timestamp. Set by the
--                   "Set follow-up" action in the rail. Cleared only by
--                   an explicit null write; NOT cleared when invoice is paid
--                   (Phase 2A decision — the user may still want the reminder).
-- promisedPaymentAt — timestamp of the customer's latest promise to pay.
--                   Set atomically when a promise_to_pay receivables_note is
--                   created. Cleared when invoice transitions to paid.
-- is_disputed     — fast-filter flag. Set atomically when a dispute
--                   receivables_note is created. Cleared when invoice
--                   transitions to paid.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS follow_up_at         timestamptz,
  ADD COLUMN IF NOT EXISTS promised_payment_at  timestamptz,
  ADD COLUMN IF NOT EXISTS is_disputed          boolean NOT NULL DEFAULT false;

-- Sparse partial indexes — only rows with these workflow fields set.
CREATE INDEX IF NOT EXISTS invoices_company_follow_up_at_idx
  ON invoices(company_id, follow_up_at)
  WHERE follow_up_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS invoices_company_promised_payment_at_idx
  ON invoices(company_id, promised_payment_at)
  WHERE promised_payment_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS invoices_company_is_disputed_idx
  ON invoices(company_id, is_disputed)
  WHERE is_disputed = true;

-- Supporting indexes for Receivables view queries.
CREATE INDEX IF NOT EXISTS invoices_company_due_date_status_idx
  ON invoices(company_id, due_date, status);

CREATE INDEX IF NOT EXISTS invoices_company_last_emailed_at_idx
  ON invoices(company_id, last_emailed_at)
  WHERE last_emailed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS invoices_company_sent_at_idx
  ON invoices(company_id, sent_at)
  WHERE sent_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS invoices_company_balance_status_idx
  ON invoices(company_id, balance, status);
