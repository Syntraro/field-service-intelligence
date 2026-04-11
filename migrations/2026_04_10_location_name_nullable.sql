-- Location Name Nullable
-- 2026-04-10: Allow client_locations.company_name to be null.
-- When null, UI falls back to customer_companies.name via canonical COALESCE.
-- Existing locationDisplayNameExpr already handles this correctly.
--
-- Run: npm run db:migrate:one -- migrations/2026_04_10_location_name_nullable.sql

ALTER TABLE client_locations
  ALTER COLUMN company_name DROP NOT NULL;
