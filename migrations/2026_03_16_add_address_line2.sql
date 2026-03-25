-- Migration: Add address line 2 support for billing and service addresses
-- Run: npm run db:migrate:one -- migrations/2026_03_16_add_address_line2.sql
--
-- Adds billingStreet2 to customer_companies (billing address line 2)
-- Adds address2 to client_locations (service address line 2)
-- Both columns are nullable text, additive-only, no data migration needed.

ALTER TABLE customer_companies ADD COLUMN IF NOT EXISTS billing_street2 TEXT;

ALTER TABLE client_locations ADD COLUMN IF NOT EXISTS address2 TEXT;
