-- Migration: Add address line 2 support to supplier_locations
-- Run: npm run db:migrate:one -- migrations/2026_03_16_add_address_line2_supplier.sql
--
-- Adds address2 to supplier_locations (address line 2 for supplier locations)
-- Nullable text, additive-only, no data migration needed.

ALTER TABLE supplier_locations ADD COLUMN IF NOT EXISTS address2 TEXT;
