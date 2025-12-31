-- Money/Quantity type migration: TEXT -> NUMERIC
-- Assumes values are clean numeric strings (e.g., '45', '90.00', '0.13').

BEGIN;

-- Companies: default_tax_rate (stored as percent string like '13') -> decimal numeric (0.13)
ALTER TABLE companies
  ALTER COLUMN default_tax_rate DROP DEFAULT;

ALTER TABLE companies
  ALTER COLUMN default_tax_rate TYPE numeric(6,4)
  USING (
    CASE
      WHEN default_tax_rate IS NULL OR default_tax_rate = '' THEN 0.1300
      WHEN default_tax_rate::numeric > 1 THEN (default_tax_rate::numeric / 100.0) -- "13" -> 0.13
      ELSE default_tax_rate::numeric
    END
  );

ALTER TABLE companies
  ALTER COLUMN default_tax_rate SET DEFAULT 0.1300;


-- Invoices totals
ALTER TABLE invoice_lines
  ALTER COLUMN quantity DROP DEFAULT,
  ALTER COLUMN unit_price DROP DEFAULT,
  ALTER COLUMN unit_cost DROP DEFAULT,
  ALTER COLUMN tax_rate DROP DEFAULT,
  ALTER COLUMN line_subtotal DROP DEFAULT;

ALTER TABLE invoice_lines
  ALTER COLUMN quantity TYPE numeric(12,4) USING NULLIF(quantity,'')::numeric,
  ALTER COLUMN unit_price TYPE numeric(12,2) USING NULLIF(unit_price,'')::numeric,
  ALTER COLUMN unit_cost TYPE numeric(12,2) USING NULLIF(unit_cost,'')::numeric,
  ALTER COLUMN tax_rate TYPE numeric(6,4) USING NULLIF(tax_rate,'')::numeric,
  ALTER COLUMN line_subtotal TYPE numeric(12,2) USING NULLIF(line_subtotal,'')::numeric;

ALTER TABLE invoice_lines
  ALTER COLUMN quantity SET DEFAULT 0,
  ALTER COLUMN unit_price SET DEFAULT 0,
  ALTER COLUMN unit_cost SET DEFAULT 0,
  ALTER COLUMN tax_rate SET DEFAULT 0,
  ALTER COLUMN line_subtotal SET DEFAULT 0;


-- Parts
ALTER TABLE parts
  ALTER COLUMN cost DROP DEFAULT,
  ALTER COLUMN unit_price DROP DEFAULT;

ALTER TABLE parts
  ALTER COLUMN cost TYPE numeric(12,2) USING NULLIF(cost,'')::numeric,
  ALTER COLUMN unit_price TYPE numeric(12,2) USING NULLIF(unit_price,'')::numeric;

ALTER TABLE parts
  ALTER COLUMN cost SET DEFAULT 0,
  ALTER COLUMN unit_price SET DEFAULT 0;

-- Job parts
ALTER TABLE job_parts
  ALTER COLUMN quantity TYPE numeric(12,4) USING NULLIF(quantity,'')::numeric,
  ALTER COLUMN unit_price TYPE numeric(12,2) USING NULLIF(unit_price,'')::numeric,
  ALTER COLUMN unit_cost TYPE numeric(12,2) USING NULLIF(unit_cost,'')::numeric;

-- Job template line items
ALTER TABLE job_template_line_items
  ALTER COLUMN quantity DROP DEFAULT,
  ALTER COLUMN unit_price_override DROP DEFAULT;

ALTER TABLE job_template_line_items
  ALTER COLUMN quantity TYPE numeric(12,4) USING NULLIF(quantity,'')::numeric,
  ALTER COLUMN unit_price_override TYPE numeric(12,2) USING NULLIF(unit_price_override,'')::numeric;

ALTER TABLE job_template_line_items
  ALTER COLUMN quantity SET DEFAULT 1;

-- Location PM part templates
ALTER TABLE location_pm_part_templates
  ALTER COLUMN quantity_per_visit TYPE numeric(12,4) USING quantity_per_visit::numeric;

-- Payments
ALTER TABLE payments
  ALTER COLUMN amount TYPE numeric(12,2) USING amount::numeric;

COMMIT;
