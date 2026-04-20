-- 2026-04-19 Tenant-owned equipment_types catalog.
--
-- Replaces the hardcoded frontend EQUIPMENT_TYPES constant (HVAC-only:
-- Split System, Chiller, Boiler, etc.) with a per-tenant table so verticals
-- like refrigeration, plumbing, electrical, fire suppression, and general
-- field service can manage their own equipment vocabulary.
--
-- Backfill policy:
--   For every distinct non-empty `equipment_type` value already stored on
--   `location_equipment`, insert a corresponding `equipment_types` row for
--   that tenant. Legacy slug values (e.g. 'rtu', 'split_system') are
--   preserved as-is — no value rewriting on `location_equipment`. The
--   frontend keeps a small slug→label fallback map so legacy rows still
--   render as human labels in lists; new rows created via the combobox
--   write the human label directly.
--
-- Idempotent:
--   - `IF NOT EXISTS` guards on table + index.
--   - `ON CONFLICT DO NOTHING` on the backfill insert (case-insensitive
--     uniqueness per tenant).
--
-- Run via: npm run db:migrate

CREATE TABLE IF NOT EXISTS equipment_types (
  id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS equipment_types_company_name_lower_uq
  ON equipment_types (company_id, lower(name));

CREATE INDEX IF NOT EXISTS equipment_types_company_active_idx
  ON equipment_types (company_id, active);

-- Backfill from existing distinct equipment_type values.
INSERT INTO equipment_types (company_id, name)
  SELECT DISTINCT company_id, TRIM(equipment_type)
    FROM location_equipment
   WHERE equipment_type IS NOT NULL
     AND TRIM(equipment_type) <> ''
ON CONFLICT (company_id, lower(name)) DO NOTHING;
