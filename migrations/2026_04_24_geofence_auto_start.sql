-- Geofence Auto-Start — Phase 1 (2026-04-24)
-- Seeds the canonical feature-catalog entry and adds three tenant-config
-- columns on company_settings. No parallel lifecycle or timer logic —
-- the existing POST /api/tech/visits/:visitId/start endpoint gains an
-- optional `source` field instead.
--
-- Run: npm run db:migrate:one -- migrations/2026_04_24_geofence_auto_start.sql

BEGIN;

-- 1. Canonical entitlement feature key. Category `technician_app` matches
--    peer feature keys seeded by 2026_04_19_seed_entitlement_feature_catalog.
--    limit_type=none because radius lives on company_settings, not here.
INSERT INTO subscription_features
  (feature_key, display_name, description, category, limit_type, is_core, active, sort_order)
VALUES
  (
    'geofence_auto_start',
    'Geofence-Assisted Visit Start',
    'Prompt technicians to start a visit when they enter a configurable radius of the service location.',
    'technician_app',
    'none',
    false,
    true,
    360
  )
ON CONFLICT (feature_key) DO UPDATE SET
  display_name  = EXCLUDED.display_name,
  description   = EXCLUDED.description,
  category      = EXCLUDED.category,
  limit_type    = EXCLUDED.limit_type,
  is_core       = EXCLUDED.is_core,
  active        = EXCLUDED.active,
  sort_order    = EXCLUDED.sort_order,
  updated_at    = CURRENT_TIMESTAMP;

-- 2. Tenant-facing config on company_settings. Functional configuration
--    (not policy) — lives with existing peer toggles like
--    invoice_reminders_enabled. Defaults keep the feature off.
ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS geofence_auto_start_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS geofence_auto_start_radius_meters INTEGER NOT NULL DEFAULT 100;

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS geofence_require_manual_confirm BOOLEAN NOT NULL DEFAULT true;

-- Range guard on radius — ties to the same 25–1000 range the UI validates.
ALTER TABLE company_settings
  DROP CONSTRAINT IF EXISTS cs_geofence_radius_range;

ALTER TABLE company_settings
  ADD CONSTRAINT cs_geofence_radius_range
    CHECK (geofence_auto_start_radius_meters BETWEEN 25 AND 1000);

COMMIT;
