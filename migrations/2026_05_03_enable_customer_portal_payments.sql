-- ============================================================================
-- 2026-05-03 — Enable customer_portal + customer_portal_payments on every plan.
--
-- WHY:
--   The `customer_portal_payments` entitlement gates the "Pay securely
--   online" CTA in invoice / quote emails (templateDataBuilder.ts:230-240).
--   The audit `server/scripts/auditPaymentEntitlement.ts` confirmed both
--   `customer_portal` and `customer_portal_payments` are present in the
--   `subscription_features` catalog but are `enabled = false` on EVERY
--   subscription_plan_features row across all four plans (trial, pro,
--   starter, enterprise) — which is why the test send for invoice
--   #1181 came through without a payment link.
--
--   Stripe + portal flow are fully wired end-to-end (see
--   server/services/stripeAdapter, server/routes/portal.ts,
--   server/routes/stripeWebhook.ts). Only the entitlement gate
--   suppresses the link.
--
--   Flipping the feature ON at the plan_feature level is the canonical
--   path (per `entitlementService.ts:179-194` resolver precedence).
--   We do NOT add tenant overrides — that would hard-code specific
--   tenant ids and skip the plan-feature contract.
--
-- WHAT THIS DOES:
--   For every (plan, feature) pair where `feature_key` IN
--   ('customer_portal', 'customer_portal_payments'), set `enabled = true`.
--   Inserts the join row when missing; updates `enabled` when present.
--
-- SAFETY:
--   - Idempotent: re-runs are no-ops (uses the existing
--     `subscription_plan_features_plan_feature_unique` constraint on
--     (plan_id, feature_id)).
--   - No tenant ids hardcoded; works against whatever set of plans the
--     target DB has.
--   - Does not touch tenant_feature_overrides (no per-tenant
--     hardcoding).
--   - Does not modify the `subscription_features` catalog itself.
--
-- ROLLBACK:
--     UPDATE subscription_plan_features
--        SET enabled = false, updated_at = now()
--      WHERE feature_id IN (
--        SELECT id FROM subscription_features
--         WHERE feature_key IN ('customer_portal', 'customer_portal_payments')
--      );
--
-- HOW TO RUN:
--   npm run db:migrate:one -- migrations/2026_05_03_enable_customer_portal_payments.sql
-- ============================================================================

BEGIN;

-- For each (plan, feature) cross product, upsert with enabled = true.
-- We use the catalog's `feature_key` (string) to look up the feature_id
-- so this migration works against any DB regardless of UUID values.
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled, updated_at)
SELECT p.id AS plan_id,
       f.id AS feature_id,
       true AS enabled,
       now() AS updated_at
  FROM subscription_plans p
 CROSS JOIN subscription_features f
 WHERE f.feature_key IN ('customer_portal', 'customer_portal_payments')
ON CONFLICT (plan_id, feature_id)
  DO UPDATE SET
    enabled    = EXCLUDED.enabled,
    updated_at = now();

-- Sanity print — counts after the upsert. This output appears in
-- migration logs only; it does not affect rows.
DO $$
DECLARE
  cnt_portal     int;
  cnt_payments   int;
BEGIN
  SELECT count(*)::int INTO cnt_portal
    FROM subscription_plan_features spf
    JOIN subscription_features sf ON sf.id = spf.feature_id
   WHERE sf.feature_key = 'customer_portal' AND spf.enabled = true;
  SELECT count(*)::int INTO cnt_payments
    FROM subscription_plan_features spf
    JOIN subscription_features sf ON sf.id = spf.feature_id
   WHERE sf.feature_key = 'customer_portal_payments' AND spf.enabled = true;
  RAISE NOTICE 'Plans with customer_portal enabled: %', cnt_portal;
  RAISE NOTICE 'Plans with customer_portal_payments enabled: %', cnt_payments;
END $$;

COMMIT;
