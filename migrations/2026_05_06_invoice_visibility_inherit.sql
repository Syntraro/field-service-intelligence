-- ============================================================================
-- 2026-05-06: Invoice visibility — null = "inherit tenant default"
-- ============================================================================
-- Companion to 2026-05-05 tenant Invoice Display Settings.
--
-- Root cause being addressed:
--   The five invoice-level visibility columns were `NOT NULL DEFAULT true`,
--   so every invoice (old and new) carried explicit booleans. The canonical
--   resolver in `shared/invoiceDisplayPolicy.ts::pick()` prefers the
--   invoice flag whenever it is a real boolean, so tenant defaults never
--   reached the renderer for any invoice. The resolver's null-fallback
--   logic was already correct — there was just no way for the columns to
--   actually be NULL.
--
-- Fix:
--   Drop NOT NULL and the column DEFAULT on the five flags so:
--     • NULL          → inherit tenant default (resolved by `pick()`)
--     • explicit true → invoice override "show this"
--     • explicit false → invoice override "hide this"
--   New invoices created after this migration leave these columns NULL
--   (the storage `createInvoiceShell` does not set them) and so inherit
--   tenant defaults end-to-end.
--
-- Existing rows are intentionally unchanged. They keep their current
-- boolean values so behavior is preserved exactly: the rendering path
-- continues to consume those explicit overrides for legacy invoices.
-- Operators can use the new "Reset to defaults" affordance per-invoice
-- to clear an existing override and let it inherit the tenant policy.
--
-- Apply with: npm run db:migrate:one -- migrations/2026_05_06_invoice_visibility_inherit.sql
-- ============================================================================

ALTER TABLE invoices ALTER COLUMN show_quantity        DROP NOT NULL;
ALTER TABLE invoices ALTER COLUMN show_quantity        DROP DEFAULT;
ALTER TABLE invoices ALTER COLUMN show_unit_price      DROP NOT NULL;
ALTER TABLE invoices ALTER COLUMN show_unit_price      DROP DEFAULT;
ALTER TABLE invoices ALTER COLUMN show_line_totals     DROP NOT NULL;
ALTER TABLE invoices ALTER COLUMN show_line_totals     DROP DEFAULT;
ALTER TABLE invoices ALTER COLUMN show_line_items      DROP NOT NULL;
ALTER TABLE invoices ALTER COLUMN show_line_items      DROP DEFAULT;
ALTER TABLE invoices ALTER COLUMN show_job_description DROP NOT NULL;
ALTER TABLE invoices ALTER COLUMN show_job_description DROP DEFAULT;

-- show_balance is intentionally left NOT NULL DEFAULT true — it gates the
-- mandatory "Balance due" surface and is not part of the tenant Invoice
-- Display catalog.
