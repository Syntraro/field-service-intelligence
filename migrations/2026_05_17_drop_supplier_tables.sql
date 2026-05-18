-- Migration: drop_supplier_tables
-- Run: npm run db:migrate:one -- migrations/2026_05_17_drop_supplier_tables.sql
--
-- Removes all supplier/vendor tables and the bill_supplier_run billing column.
-- tasks.type is TEXT (not a Postgres enum) so no enum migration is needed;
-- existing SUPPLIER_VISIT rows are backfilled to GENERAL before the task type
-- is removed from application code.
-- Existing time_entries rows with type = 'travel_to_supplier' or 'supplier_run'
-- are left as-is — no FK constraint exists on that column, they are historical
-- records only and will never be matched by application code.

-- Backfill any remaining SUPPLIER_VISIT task rows before retiring the type
UPDATE tasks SET type = 'GENERAL' WHERE type = 'SUPPLIER_VISIT';

-- Drop supplier detail / location / root tables (CASCADE handles FK children)
DROP TABLE IF EXISTS supplier_visit_details CASCADE;
DROP TABLE IF EXISTS supplier_locations CASCADE;
DROP TABLE IF EXISTS suppliers CASCADE;

-- Drop the bill_supplier_run column from time_billing_rules
ALTER TABLE time_billing_rules DROP COLUMN IF EXISTS bill_supplier_run;
