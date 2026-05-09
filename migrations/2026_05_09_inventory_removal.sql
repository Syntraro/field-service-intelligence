-- Inventory module removal (2026-05-09)
-- Run: npm run db:migrate:one -- migrations/2026_05_09_inventory_removal.sql
--
-- Drops all inventory tables in safe FK order (child → parent),
-- removes inventory-only columns from items, and cleans up the
-- permissions + subscription_features seed rows.

DROP TABLE IF EXISTS inventory_reservations;
DROP TABLE IF EXISTS job_inventory_usage;
DROP TABLE IF EXISTS inventory_transactions;
DROP TABLE IF EXISTS inventory_quantities;
DROP TABLE IF EXISTS inventory_locations;

ALTER TABLE items DROP COLUMN IF EXISTS track_inventory;
ALTER TABLE items DROP COLUMN IF EXISTS model;

DELETE FROM permissions WHERE key IN ('inventory.view', 'inventory.manage');
DELETE FROM subscription_features WHERE feature_key = 'inventory_core';
