-- Migration: Add invoice_tax_lines snapshot table
-- Purpose: Freeze tax group composition at invoice creation time so later
--          edits to tax rates/groups do NOT retroactively change historical invoices.
--
-- Run: psql "$DATABASE_URL" -f migrations/2026_01_28_add_invoice_tax_lines.sql

CREATE TABLE IF NOT EXISTS invoice_tax_lines (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id VARCHAR NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  tax_rate_id VARCHAR REFERENCES company_tax_rates(id) ON DELETE SET NULL,
  tax_rate_name TEXT NOT NULL,
  rate_percent NUMERIC(7, 4) NOT NULL,
  taxable_amount NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  tax_amount NUMERIC(12, 2) NOT NULL DEFAULT '0.00',
  tax_group_id VARCHAR,
  tax_group_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS invoice_tax_lines_invoice_idx ON invoice_tax_lines(invoice_id);
CREATE INDEX IF NOT EXISTS invoice_tax_lines_company_idx ON invoice_tax_lines(company_id);
