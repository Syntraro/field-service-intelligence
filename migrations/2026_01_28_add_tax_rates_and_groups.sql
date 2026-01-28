-- Migration: Create tax rates, tax groups, and junction tables for v1 multi-tax system
-- Run: psql "$DATABASE_URL" -f migrations/2026_01_28_add_tax_rates_and_groups.sql

-- Individual tax rates (e.g., GST 5%, PST 7%, HST 13%)
CREATE TABLE IF NOT EXISTS company_tax_rates (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rate NUMERIC(7,4) NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP
);

-- Tax groups (e.g., "GST+PST", "HST Only")
CREATE TABLE IF NOT EXISTS company_tax_groups (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP
);

-- One default group per company (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS company_tax_groups_default_uniq
  ON company_tax_groups (company_id)
  WHERE is_default = true AND active = true;

-- Junction: group <-> rates
CREATE TABLE IF NOT EXISTS company_tax_group_rates (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id VARCHAR NOT NULL REFERENCES company_tax_groups(id) ON DELETE CASCADE,
  tax_rate_id VARCHAR NOT NULL REFERENCES company_tax_rates(id) ON DELETE CASCADE,
  UNIQUE (group_id, tax_rate_id)
);

-- Add tax group reference to invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_group_id VARCHAR REFERENCES company_tax_groups(id) ON DELETE SET NULL;
