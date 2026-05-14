-- Migration: drop legacy invoice note columns
-- Run: npm run db:migrate:one -- migrations/2026_05_14_drop_invoice_legacy_note_columns.sql
--
-- Removes notes_internal and notes_customer from the invoices table.
--
-- notes_customer was backfilled → client_message (2026_05_13_backfill_invoice_client_message.sql)
-- notes_internal was the QBO PrivateNote / import snapshot column. The import
--   adapter (InvoiceImportAdapter.ts) was updated 2026-05-14 to stop writing it.
--   The QBO mapper (server/qbo/mappers.ts) PrivateNote mapping was removed 2026-05-13.
--
-- Quote columns notes_internal / notes_customer are NOT touched — they are
-- intentional on the quotes table (description + internal note fields for quotes).

ALTER TABLE invoices DROP COLUMN IF EXISTS notes_internal;
ALTER TABLE invoices DROP COLUMN IF EXISTS notes_customer;
