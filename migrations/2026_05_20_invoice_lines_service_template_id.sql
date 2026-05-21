-- Migration: Add service_template_id to invoice_lines
-- Run: npm run db:migrate:one -- migrations/2026_05_20_invoice_lines_service_template_id.sql
--
-- Adds flat-rate service template attribution to invoice lines, matching the
-- equivalent column already present on job_parts and quote_lines.
--
-- The column is attribution metadata only. It does not affect totals, tax,
-- QBO sync, or PDF rendering. ON DELETE SET NULL preserves the invoice line
-- if the template is later archived or deleted.
--
-- No index: no query filters on this column (reads are always scoped to
-- invoiceId + companyId). No backfill: historical lines have no attribution.

ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS service_template_id UUID
    REFERENCES service_templates(id) ON DELETE SET NULL;
