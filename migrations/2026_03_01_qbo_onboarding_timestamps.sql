-- Add QBO onboarding timestamps to companies table.
-- Stamped once on first successful catalog/customer import run (fetched > 0).
-- Used by the UI to distinguish onboarding vs reconciliation mode.
-- Run: psql "$DATABASE_URL" -f migrations/2026_03_01_qbo_onboarding_timestamps.sql

ALTER TABLE companies ADD COLUMN IF NOT EXISTS qbo_onboarding_catalog_imported_at TIMESTAMP;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS qbo_onboarding_customers_imported_at TIMESTAMP;
