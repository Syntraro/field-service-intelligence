-- Migration: backfill invoice client_message from notes_customer
-- Run: npm run db:migrate:one -- migrations/2026_05_13_backfill_invoice_client_message.sql
--
-- Copies notes_customer → client_message for rows where client_message is NULL
-- and notes_customer is not blank. After this migration, the PDF / QBO / portal
-- code can safely read client_message without a ?? notesCustomer fallback.
-- notes_customer is NOT dropped here — that is Phase 2 after verifying no writes remain.

UPDATE invoices
SET client_message = notes_customer
WHERE client_message IS NULL
  AND notes_customer IS NOT NULL
  AND TRIM(notes_customer) <> '';
