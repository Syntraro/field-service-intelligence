-- Migration: Seed HST 13% tax rate and default tax group for pilot tenant
-- Date: 2026-03-15
-- Purpose: Create the minimum tax configuration required for invoice generation
--          during Phase 1 pilot. Without this, all invoices are created at 0% tax.
--
-- Run: npm run db:migrate:one -- migrations/2026_03_15_seed_pilot_tax_config.sql
--
-- Target tenant: 617dac31-2c3d-49f7-bc49-6b1bfedd37d4 (Samcor Mechanical production tenant)
--
-- Creates:
--   1. company_tax_rates: HST 13% rate
--   2. company_tax_groups: "HST" group (is_default = true)
--   3. company_tax_group_rates: junction linking group → rate
--
-- Safe to re-run: Uses ON CONFLICT DO NOTHING patterns where possible.
-- Idempotent: Checks for existing records before inserting.

-- Step 0: Preview current state (run manually to verify empty)
-- SELECT * FROM company_tax_rates WHERE company_id = '617dac31-2c3d-49f7-bc49-6b1bfedd37d4';
-- SELECT * FROM company_tax_groups WHERE company_id = '617dac31-2c3d-49f7-bc49-6b1bfedd37d4';

-- Step 1: Insert HST 13% tax rate (skip if already exists)
INSERT INTO company_tax_rates (id, company_id, name, rate, description, active)
SELECT
  gen_random_uuid(),
  '617dac31-2c3d-49f7-bc49-6b1bfedd37d4',
  'HST',
  '13.0000',
  'Harmonized Sales Tax (Ontario) — 13%',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM company_tax_rates
  WHERE company_id = '617dac31-2c3d-49f7-bc49-6b1bfedd37d4'
    AND name = 'HST'
    AND active = true
);

-- Step 2: Insert default tax group (skip if already exists)
INSERT INTO company_tax_groups (id, company_id, name, description, is_default, active)
SELECT
  gen_random_uuid(),
  '617dac31-2c3d-49f7-bc49-6b1bfedd37d4',
  'HST',
  'Default tax group — HST 13%',
  true,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM company_tax_groups
  WHERE company_id = '617dac31-2c3d-49f7-bc49-6b1bfedd37d4'
    AND name = 'HST'
    AND active = true
);

-- Step 3: Link group to rate via junction table
INSERT INTO company_tax_group_rates (id, group_id, tax_rate_id)
SELECT
  gen_random_uuid(),
  g.id,
  r.id
FROM company_tax_groups g
JOIN company_tax_rates r
  ON r.company_id = g.company_id AND r.name = 'HST' AND r.active = true
WHERE g.company_id = '617dac31-2c3d-49f7-bc49-6b1bfedd37d4'
  AND g.name = 'HST'
  AND g.active = true
  AND NOT EXISTS (
    SELECT 1 FROM company_tax_group_rates cgr
    WHERE cgr.group_id = g.id AND cgr.tax_rate_id = r.id
  );

-- Step 4: Verify (run manually)
-- SELECT g.id AS group_id, g.name AS group_name, g.is_default,
--        r.id AS rate_id, r.name AS rate_name, r.rate
-- FROM company_tax_groups g
-- JOIN company_tax_group_rates cgr ON cgr.group_id = g.id
-- JOIN company_tax_rates r ON r.id = cgr.tax_rate_id
-- WHERE g.company_id = '617dac31-2c3d-49f7-bc49-6b1bfedd37d4';
