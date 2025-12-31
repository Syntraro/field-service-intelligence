-- ============================================================================
-- MONEY TYPE FIX MIGRATION
-- Converts TEXT money fields to NUMERIC(12,2) for proper financial handling
-- 
-- CRITICAL: This is a breaking change - requires code updates
-- Run during maintenance window with database backup
-- ============================================================================

-- STEP 1: Add new NUMERIC columns
-- ============================================================================

-- Companies table
ALTER TABLE companies 
  ADD COLUMN default_tax_rate_new NUMERIC(5,2) DEFAULT 13.00;

-- Parts table (products/services)
ALTER TABLE parts 
  ADD COLUMN cost_new NUMERIC(12,2),
  ADD COLUMN markup_percent_new NUMERIC(5,2),
  ADD COLUMN unit_price_new NUMERIC(12,2);

-- Invoices table
ALTER TABLE invoices 
  ADD COLUMN subtotal_new NUMERIC(12,2) DEFAULT 0.00,
  ADD COLUMN tax_total_new NUMERIC(12,2) DEFAULT 0.00,
  ADD COLUMN total_new NUMERIC(12,2) DEFAULT 0.00,
  ADD COLUMN amount_paid_new NUMERIC(12,2) DEFAULT 0.00,
  ADD COLUMN balance_new NUMERIC(12,2) DEFAULT 0.00;

-- Invoice lines table
ALTER TABLE invoice_lines 
  ADD COLUMN unit_cost_new NUMERIC(12,2),
  ADD COLUMN unit_price_new NUMERIC(12,2) DEFAULT 0.00,
  ADD COLUMN tax_rate_new NUMERIC(5,4) DEFAULT 0.0000,
  ADD COLUMN line_subtotal_new NUMERIC(12,2) DEFAULT 0.00,
  ADD COLUMN tax_amount_new NUMERIC(12,2) DEFAULT 0.00,
  ADD COLUMN line_total_new NUMERIC(12,2) DEFAULT 0.00;

-- Payments table
ALTER TABLE payments 
  ADD COLUMN amount_new NUMERIC(12,2);

-- Job parts table
ALTER TABLE job_parts 
  ADD COLUMN unit_cost_new NUMERIC(12,2),
  ADD COLUMN unit_price_new NUMERIC(12,2);

-- Technician profiles table
ALTER TABLE technician_profiles 
  ADD COLUMN labor_cost_per_hour_new NUMERIC(8,2),
  ADD COLUMN billable_rate_per_hour_new NUMERIC(8,2);

-- Recurring job phases table (if exists)
DO $$ 
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'recurring_job_phases' 
    AND column_name = 'unit_price_override'
  ) THEN
    ALTER TABLE recurring_job_phases 
      ADD COLUMN unit_price_override_new NUMERIC(12,2);
  END IF;
END $$;

-- STEP 2: Migrate data from TEXT to NUMERIC
-- ============================================================================

-- Companies: Convert tax rate (e.g., "13" → 13.00)
UPDATE companies 
SET default_tax_rate_new = 
  CASE 
    WHEN default_tax_rate::text ~ '^\d+\.?\d*$' THEN default_tax_rate::NUMERIC(5,2)
    ELSE 13.00
  END;

-- Parts: Convert prices
UPDATE parts 
SET 
  cost_new = CASE WHEN cost::text ~ '^\d+\.?\d*$' THEN cost::NUMERIC(12,2) ELSE NULL END,
  markup_percent_new = CASE WHEN markup_percent::text ~ '^\d+\.?\d*$' THEN markup_percent::NUMERIC(5,2) ELSE NULL END,
  unit_price_new = CASE WHEN unit_price::text ~ '^\d+\.?\d*$' THEN unit_price::NUMERIC(12,2) ELSE NULL END;

-- Invoices: Convert all money fields
UPDATE invoices 
SET 
  subtotal_new = CASE WHEN subtotal::text ~ '^\d+\.?\d*$' THEN subtotal::NUMERIC(12,2) ELSE 0.00 END,
  tax_total_new = CASE WHEN tax_total::text ~ '^\d+\.?\d*$' THEN tax_total::NUMERIC(12,2) ELSE 0.00 END,
  total_new = CASE WHEN total::text ~ '^\d+\.?\d*$' THEN total::NUMERIC(12,2) ELSE 0.00 END,
  amount_paid_new = CASE WHEN amount_paid::text ~ '^\d+\.?\d*$' THEN amount_paid::NUMERIC(12,2) ELSE 0.00 END,
  balance_new = CASE WHEN balance::text ~ '^\d+\.?\d*$' THEN balance::NUMERIC(12,2) ELSE 0.00 END;

-- Invoice Lines: Convert all money fields
UPDATE invoice_lines 
SET 
  unit_cost_new = CASE WHEN unit_cost::text ~ '^\d+\.?\d*$' THEN unit_cost::NUMERIC(12,2) ELSE NULL END,
  unit_price_new = CASE WHEN unit_price::text ~ '^\d+\.?\d*$' THEN unit_price::NUMERIC(12,2) ELSE 0.00 END,
  tax_rate_new = CASE WHEN tax_rate::text ~ '^\d+\.?\d*$' THEN tax_rate::NUMERIC(5,4) ELSE 0.0000 END,
  line_subtotal_new = CASE WHEN line_subtotal::text ~ '^\d+\.?\d*$' THEN line_subtotal::NUMERIC(12,2) ELSE 0.00 END,
  tax_amount_new = CASE WHEN tax_amount::text ~ '^\d+\.?\d*$' THEN tax_amount::NUMERIC(12,2) ELSE 0.00 END,
  line_total_new = CASE WHEN line_total::text ~ '^\d+\.?\d*$' THEN line_total::NUMERIC(12,2) ELSE 0.00 END;

-- Payments: Convert amount
UPDATE payments 
SET amount_new = CASE WHEN amount::text ~ '^\d+\.?\d*$' THEN amount::NUMERIC(12,2) ELSE NULL END;

-- Job Parts: Convert prices
UPDATE job_parts 
SET 
  unit_cost_new = CASE WHEN unit_cost::text ~ '^\d+\.?\d*$' THEN unit_cost::NUMERIC(12,2) ELSE NULL END,
  unit_price_new = CASE WHEN unit_price::text ~ '^\d+\.?\d*$' THEN unit_price::NUMERIC(12,2) ELSE NULL END;

-- Technician Profiles: Convert rates
UPDATE technician_profiles 
SET 
  labor_cost_per_hour_new = CASE WHEN labor_cost_per_hour::text ~ '^\d+\.?\d*$' THEN labor_cost_per_hour::NUMERIC(8,2) ELSE NULL END,
  billable_rate_per_hour_new = CASE WHEN billable_rate_per_hour::text ~ '^\d+\.?\d*$' THEN billable_rate_per_hour::NUMERIC(8,2) ELSE NULL END;

-- Recurring Job Phases: Convert price override
DO $$ 
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'recurring_job_phases' 
    AND column_name = 'unit_price_override'
  ) THEN
    UPDATE recurring_job_phases 
    SET unit_price_override_new = CASE WHEN unit_price_override::text ~ '^\d+\.?\d*$' THEN unit_price_override::NUMERIC(12,2) ELSE NULL END;
  END IF;
END $$;

-- STEP 3: Verify data integrity
-- ============================================================================

SELECT 'companies' as table_name, 
  COUNT(*) as total_rows,
  COUNT(default_tax_rate) as old_not_null,
  COUNT(default_tax_rate_new) as new_not_null,
  COUNT(*) - COUNT(default_tax_rate_new) as failed_conversions
FROM companies
UNION ALL
SELECT 'parts',
  COUNT(*),
  COUNT(unit_price),
  COUNT(unit_price_new),
  COUNT(unit_price) - COUNT(unit_price_new)
FROM parts WHERE unit_price IS NOT NULL
UNION ALL
SELECT 'invoices',
  COUNT(*),
  COUNT(total),
  COUNT(total_new),
  COUNT(total) - COUNT(total_new)
FROM invoices WHERE total IS NOT NULL
UNION ALL
SELECT 'invoice_lines',
  COUNT(*),
  COUNT(unit_price),
  COUNT(unit_price_new),
  COUNT(unit_price) - COUNT(unit_price_new)
FROM invoice_lines WHERE unit_price IS NOT NULL
UNION ALL
SELECT 'payments',
  COUNT(*),
  COUNT(amount),
  COUNT(amount_new),
  COUNT(amount) - COUNT(amount_new)
FROM payments WHERE amount IS NOT NULL;

-- ⚠️ STOP HERE AND REVIEW VERIFICATION RESULTS ⚠️
-- If failed_conversions > 0, investigate before proceeding!

-- ============================================================================
-- STEP 4: Drop old columns and rename (RUN AFTER CODE IS UPDATED)
-- ============================================================================
-- ⚠️ ONLY RUN THIS AFTER ALL CODE IS UPDATED TO USE NUMERIC TYPES ⚠️

-- Uncomment when ready:

-- -- Companies
-- ALTER TABLE companies DROP COLUMN default_tax_rate;
-- ALTER TABLE companies RENAME COLUMN default_tax_rate_new TO default_tax_rate;
-- ALTER TABLE companies ALTER COLUMN default_tax_rate SET NOT NULL;

-- -- Parts
-- ALTER TABLE parts DROP COLUMN cost;
-- ALTER TABLE parts DROP COLUMN markup_percent;
-- ALTER TABLE parts DROP COLUMN unit_price;
-- ALTER TABLE parts RENAME COLUMN cost_new TO cost;
-- ALTER TABLE parts RENAME COLUMN markup_percent_new TO markup_percent;
-- ALTER TABLE parts RENAME COLUMN unit_price_new TO unit_price;

-- -- Invoices
-- ALTER TABLE invoices DROP COLUMN subtotal;
-- ALTER TABLE invoices DROP COLUMN tax_total;
-- ALTER TABLE invoices DROP COLUMN total;
-- ALTER TABLE invoices DROP COLUMN amount_paid;
-- ALTER TABLE invoices DROP COLUMN balance;
-- ALTER TABLE invoices RENAME COLUMN subtotal_new TO subtotal;
-- ALTER TABLE invoices RENAME COLUMN tax_total_new TO tax_total;
-- ALTER TABLE invoices RENAME COLUMN total_new TO total;
-- ALTER TABLE invoices RENAME COLUMN amount_paid_new TO amount_paid;
-- ALTER TABLE invoices RENAME COLUMN balance_new TO balance;
-- ALTER TABLE invoices ALTER COLUMN subtotal SET NOT NULL;
-- ALTER TABLE invoices ALTER COLUMN tax_total SET NOT NULL;
-- ALTER TABLE invoices ALTER COLUMN total SET NOT NULL;
-- ALTER TABLE invoices ALTER COLUMN amount_paid SET NOT NULL;
-- ALTER TABLE invoices ALTER COLUMN balance SET NOT NULL;

-- -- Invoice Lines
-- ALTER TABLE invoice_lines DROP COLUMN unit_cost;
-- ALTER TABLE invoice_lines DROP COLUMN unit_price;
-- ALTER TABLE invoice_lines DROP COLUMN tax_rate;
-- ALTER TABLE invoice_lines DROP COLUMN line_subtotal;
-- ALTER TABLE invoice_lines DROP COLUMN tax_amount;
-- ALTER TABLE invoice_lines DROP COLUMN line_total;
-- ALTER TABLE invoice_lines RENAME COLUMN unit_cost_new TO unit_cost;
-- ALTER TABLE invoice_lines RENAME COLUMN unit_price_new TO unit_price;
-- ALTER TABLE invoice_lines RENAME COLUMN tax_rate_new TO tax_rate;
-- ALTER TABLE invoice_lines RENAME COLUMN line_subtotal_new TO line_subtotal;
-- ALTER TABLE invoice_lines RENAME COLUMN tax_amount_new TO tax_amount;
-- ALTER TABLE invoice_lines RENAME COLUMN line_total_new TO line_total;
-- ALTER TABLE invoice_lines ALTER COLUMN unit_price SET NOT NULL;
-- ALTER TABLE invoice_lines ALTER COLUMN tax_rate SET NOT NULL;
-- ALTER TABLE invoice_lines ALTER COLUMN line_subtotal SET NOT NULL;
-- ALTER TABLE invoice_lines ALTER COLUMN line_total SET NOT NULL;

-- -- Payments
-- ALTER TABLE payments DROP COLUMN amount;
-- ALTER TABLE payments RENAME COLUMN amount_new TO amount;
-- ALTER TABLE payments ALTER COLUMN amount SET NOT NULL;

-- -- Job Parts
-- ALTER TABLE job_parts DROP COLUMN unit_cost;
-- ALTER TABLE job_parts DROP COLUMN unit_price;
-- ALTER TABLE job_parts RENAME COLUMN unit_cost_new TO unit_cost;
-- ALTER TABLE job_parts RENAME COLUMN unit_price_new TO unit_price;

-- -- Technician Profiles
-- ALTER TABLE technician_profiles DROP COLUMN labor_cost_per_hour;
-- ALTER TABLE technician_profiles DROP COLUMN billable_rate_per_hour;
-- ALTER TABLE technician_profiles RENAME COLUMN labor_cost_per_hour_new TO labor_cost_per_hour;
-- ALTER TABLE technician_profiles RENAME COLUMN billable_rate_per_hour_new TO billable_rate_per_hour;

-- ============================================================================
-- ROLLBACK PLAN (if something goes wrong)
-- ============================================================================

-- To rollback:
-- ALTER TABLE companies DROP COLUMN IF EXISTS default_tax_rate_new;
-- ALTER TABLE parts DROP COLUMN IF EXISTS cost_new, DROP COLUMN IF EXISTS markup_percent_new, DROP COLUMN IF EXISTS unit_price_new;
-- ALTER TABLE invoices DROP COLUMN IF EXISTS subtotal_new, DROP COLUMN IF EXISTS tax_total_new, DROP COLUMN IF EXISTS total_new, DROP COLUMN IF EXISTS amount_paid_new, DROP COLUMN IF EXISTS balance_new;
-- ALTER TABLE invoice_lines DROP COLUMN IF EXISTS unit_cost_new, DROP COLUMN IF EXISTS unit_price_new, DROP COLUMN IF EXISTS tax_rate_new, DROP COLUMN IF EXISTS line_subtotal_new, DROP COLUMN IF EXISTS tax_amount_new, DROP COLUMN IF EXISTS line_total_new;
-- ALTER TABLE payments DROP COLUMN IF EXISTS amount_new;
-- ALTER TABLE job_parts DROP COLUMN IF EXISTS unit_cost_new, DROP COLUMN IF EXISTS unit_price_new;
-- ALTER TABLE technician_profiles DROP COLUMN IF EXISTS labor_cost_per_hour_new, DROP COLUMN IF EXISTS billable_rate_per_hour_new;
