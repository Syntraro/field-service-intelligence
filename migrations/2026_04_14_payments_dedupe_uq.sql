-- Phase 1 next-frontier cleanup (2026-04-14): duplicate-payment guard.
--
-- Partial unique index — blocks double-submits when a reference is provided
-- (cheque number, transaction id, receipt id). Cash/other payments without
-- a reference remain unconstrained; a double-submit there is rare and
-- handled manually.
--
-- Run: npm run db:migrate:one -- migrations/2026_04_14_payments_dedupe_uq.sql

CREATE UNIQUE INDEX IF NOT EXISTS payments_company_invoice_reference_uq
  ON payments (company_id, invoice_id, reference)
  WHERE reference IS NOT NULL AND reference <> '';
