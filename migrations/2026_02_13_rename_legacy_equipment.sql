-- Rename legacy equipment table to deprecated
-- Phase 6 D3: Equipment table consolidation
--
-- The legacy `equipment` table has been superseded by `location_equipment`.
-- All application code now uses `location_equipment` exclusively.
-- This table had 0 records at time of migration.
--
-- Execution: psql "$DATABASE_URL" -f migrations/2026_02_13_rename_legacy_equipment.sql
-- Already executed: 2026-02-13

ALTER TABLE equipment RENAME TO equipment_legacy_deprecated;

-- After a comfort period (2+ weeks), drop with:
-- DROP TABLE IF EXISTS equipment_legacy_deprecated;
