-- Run: npm run db:migrate:one -- migrations/2026_05_18_shift_management_feature_catalog.sql

-- Feature catalog entry for Technician Shift Management (Phase 1).
-- Assigns the feature to professional and enterprise subscription plans.

BEGIN;

INSERT INTO subscription_features
  (feature_key, display_name, description, category, limit_type, is_core, active, sort_order)
VALUES
  (
    'technician_shift_management',
    'Technician Shift Management',
    'Recurring shift templates, on-call blocks, and time-off management with a canonical Availability Engine.',
    'scheduling',
    'none',
    false,
    true,
    410
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

-- Assign to professional and enterprise plans.
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled, limit_value)
SELECT p.id, f.id, true, NULL
FROM subscription_plans p
CROSS JOIN subscription_features f
WHERE f.feature_key = 'technician_shift_management'
  AND p.name IN ('professional', 'enterprise')
  AND p.active = true
ON CONFLICT (plan_id, feature_id) DO NOTHING;

COMMIT;
