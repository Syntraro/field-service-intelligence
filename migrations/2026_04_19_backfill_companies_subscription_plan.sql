-- 2026-04-19 Backfill `companies.subscription_plan` for legacy rows.
--
-- Context:
--   The canonical resolver `subscriptionRepository.getSubscriptionUsage`
--   resolves a tenant's plan via `companies.subscription_plan` →
--   `subscription_plans.name`. Until today the resolver carried a silent
--   fallback ("if subscription_plan is null, look up name='trial'") which
--   masked the fact that `onboardingService.createCompanyWithOwner` never
--   wrote the column at signup. That fallback is being removed in the
--   accompanying code change so the system fails loud on misconfiguration.
--
--   This backfill ensures every existing tenant has an explicit
--   `subscription_plan` value before the fallback is removed:
--     - Trial-status tenants → 'trial' (mirrors the prior implicit behavior)
--     - Other null-plan tenants → 'trial' as well (these were already
--       hitting the same fallback at runtime; making implicit explicit
--       changes nothing about their effective entitlement)
--
--   Tenants with a non-null plan are left untouched.
--
-- Idempotent: re-running is a no-op once the column is populated.
--
-- Run via: npm run db:migrate

UPDATE companies
   SET subscription_plan = 'trial'
 WHERE subscription_plan IS NULL;
