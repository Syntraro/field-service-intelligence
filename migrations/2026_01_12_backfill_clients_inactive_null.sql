-- Backfill NULL inactive values to false (active)
-- This is a safe, idempotent migration that ensures all clients have an explicit inactive value
--
-- Context: The inactive filter was using eq(inactive, false) which excludes NULL values,
-- resulting in 0 results when clients have inactive = NULL. This migration ensures all
-- legacy records have an explicit value.
--
-- Run: psql $DATABASE_URL -f migrations/2026_01_12_backfill_clients_inactive_null.sql

-- Backfill: Set inactive = false for all rows where inactive IS NULL
-- This treats NULL as "active" (the default intended behavior)
-- Note: Table was renamed from "clients" to "client_locations"
UPDATE client_locations
SET inactive = false
WHERE inactive IS NULL;

-- Verify: Count should be 0 after running
-- SELECT COUNT(*) FROM client_locations WHERE inactive IS NULL;
