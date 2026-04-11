-- 2026-04-10: Add residential/mixed client identity fields to customer_companies.
-- Supports residential (person-only), commercial (company-only), and mixed workflows.
-- Validation: at least one of (first_name, name) must be non-empty — enforced by app layer.

-- Make company name nullable (was NOT NULL — residential clients may not have one)
ALTER TABLE customer_companies ALTER COLUMN name DROP NOT NULL;

-- Add person identity fields
ALTER TABLE customer_companies ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE customer_companies ADD COLUMN IF NOT EXISTS last_name text;

-- Boolean: when true, company name is primary display/billing identity; when false, person name is
ALTER TABLE customer_companies ADD COLUMN IF NOT EXISTS use_company_as_primary boolean NOT NULL DEFAULT true;

-- Backfill: existing records all have company names, so use_company_as_primary = true (default) is correct.
-- No destructive transformation needed.
