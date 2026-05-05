-- ============================================================================
-- 2026-05-05: Tenant-level Invoice Display Settings
-- ============================================================================
-- Adds canonical tenant-level visibility policy for invoice PDFs, invoice
-- emails, and the client portal invoice view. All renderers consume the
-- resolved policy from `shared/invoiceDisplayPolicy.ts`. Per-invoice
-- visibility flags on `invoices` (showLineItems, showQuantity, etc.) are
-- preserved and continue to override tenant defaults at the resolver level.
--
-- Defaults are chosen to MATCH CURRENT BEHAVIOR for already-existing
-- invoices — flipping nothing on/off by surprise:
--   * Company logo / website default off (no current renderer).
--   * Company address / phone / email / tax number default on (currently
--     rendered when present).
--   * Job number / summary default off (currently not rendered).
--   * Job description / line items / quantities / prices / totals default
--     on (per-invoice flags already default on).
--   * Client message default on (existing invoices with content keep
--     rendering); default text is NULL until tenant fills it in.
--
-- Apply with:  npm run db:migrate:one -- migrations/2026_05_05_invoice_display_settings.sql
-- ============================================================================

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS invoice_show_logo               boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS invoice_show_company_address    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS invoice_show_company_phone      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS invoice_show_company_email      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS invoice_show_company_website    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS invoice_show_tax_number         boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS invoice_show_billing_address    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS invoice_show_service_address    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS invoice_show_location_name      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS invoice_show_job_number         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS invoice_show_summary            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS invoice_show_job_description    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS invoice_show_client_message     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS invoice_default_client_message  text,
  ADD COLUMN IF NOT EXISTS invoice_show_line_items         boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS invoice_show_quantities         boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS invoice_show_unit_prices        boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS invoice_show_line_totals        boolean NOT NULL DEFAULT true;
