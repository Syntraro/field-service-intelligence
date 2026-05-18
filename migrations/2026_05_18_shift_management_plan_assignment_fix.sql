-- Run: npm run db:migrate:one -- migrations/2026_05_18_shift_management_plan_assignment_fix.sql
--
-- Fix: 2026_05_18_shift_management_feature_catalog.sql referenced plan name
-- 'professional' which does not exist; only 'pro' and 'enterprise' are live.
-- This adds the feature to the 'pro' plan and creates a dev-only tenant
-- override for "Samcor Mechanical Inc." so the development company can
-- access Shift Management while on the 'trial' plan.

BEGIN;

-- Assign technician_shift_management to the 'pro' plan
-- (the original migration used 'professional' which has no matching row).
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled, limit_value)
SELECT p.id, f.id, true, NULL
FROM subscription_plans p
CROSS JOIN subscription_features f
WHERE f.feature_key = 'technician_shift_management'
  AND p.name IN ('pro', 'enterprise')
  AND p.active = true
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = true;

-- Dev-only: tenant_feature_override for "Samcor Mechanical Inc." (trial plan).
-- Keeps shift management accessible in development regardless of plan tier.
-- Safe to leave in production — overrides a single tenant, no cross-tenant impact.
INSERT INTO tenant_feature_overrides (company_id, feature_id, enabled, reason)
SELECT c.id, f.id, true, 'dev seed — shift management enabled for development tenant'
FROM companies c
CROSS JOIN subscription_features f
WHERE c.name = 'Samcor Mechanical Inc.'
  AND f.feature_key = 'technician_shift_management'
ON CONFLICT (company_id, feature_id) DO UPDATE
  SET enabled = true,
      reason  = EXCLUDED.reason,
      updated_at = CURRENT_TIMESTAMP;

COMMIT;
