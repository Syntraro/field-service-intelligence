-- Reference Fields — Phase 2b (2026-04-22)
-- Extend the canonical reference-fields system beyond Jobs/Quotes/Invoices to
-- Clients (customer_company), Locations (client_location), and Products (item)
-- so the Import Center can create custom fields inline for every entity type.
--
-- Changes:
--   1. Add three applies_to_* boolean columns to reference_field_definitions
--   2. Drop the old 3-flag CHECK constraint and recreate it to allow any of 6
--   3. Drop the old entity_type CHECK on reference_field_values and recreate
--      it with the 6 allowed values
--
-- Field-value storage stays text-only (2026-04-10 lock); no column changes to
-- reference_field_values beyond the check constraint relaxation.
--
-- Run: npm run db:migrate:one -- migrations/2026_04_22_ref_fields_phase2b.sql

BEGIN;

-- ============================================================================
-- 1. Extend reference_field_definitions with new applies_to_* flags
-- ============================================================================

ALTER TABLE reference_field_definitions
  ADD COLUMN IF NOT EXISTS applies_to_customers BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE reference_field_definitions
  ADD COLUMN IF NOT EXISTS applies_to_locations BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE reference_field_definitions
  ADD COLUMN IF NOT EXISTS applies_to_products BOOLEAN NOT NULL DEFAULT false;

-- Replace the 3-flag "at least one applies-to" constraint with a 6-flag version
ALTER TABLE reference_field_definitions
  DROP CONSTRAINT IF EXISTS ref_field_defs_applies_to_check;

ALTER TABLE reference_field_definitions
  ADD CONSTRAINT ref_field_defs_applies_to_check
    CHECK (
      applies_to_jobs = true
      OR applies_to_quotes = true
      OR applies_to_invoices = true
      OR applies_to_customers = true
      OR applies_to_locations = true
      OR applies_to_products = true
    );

-- ============================================================================
-- 2. Relax reference_field_values.entity_type check to allow 6 entity types
-- ============================================================================

ALTER TABLE reference_field_values
  DROP CONSTRAINT IF EXISTS ref_field_vals_entity_type_check;

ALTER TABLE reference_field_values
  ADD CONSTRAINT ref_field_vals_entity_type_check
    CHECK (entity_type IN (
      'job',
      'quote',
      'invoice',
      'customer_company',
      'client_location',
      'item'
    ));

COMMIT;
