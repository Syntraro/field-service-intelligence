-- 2026-04-19 Re-seed canonical subscription_plans rows.
--
-- Context:
--   The original seed (`2026_03_08_seed_subscription_plans.sql`) was tracked
--   as applied in `schema_migrations`, but `subscription_plans` was found
--   empty in dev — most likely because a `dev_reset_*` script truncated the
--   table after the seed migration ran. With zero plan rows, the canonical
--   `subscriptionRepository.getSubscriptionUsage` resolver returns a null
--   plan even for trial tenants, surfacing as "No active plan found" when
--   a brand-new owner tries to add their first client.
--
--   The seed is the canonical source of plan definitions. Re-applying it
--   under a new filename guarantees every environment (dev, staging, prod)
--   converges on the same row set on next `npm run db:migrate`. The
--   `ON CONFLICT (name) DO UPDATE` makes this safe to re-run any number
--   of times without duplicating rows or trampling manual edits to
--   `display_name` etc. (the seed is the source of truth for those too).
--
-- Run via: npm run db:migrate

INSERT INTO subscription_plans (name, display_name, monthly_price_cents, location_limit, is_trial, trial_days, sort_order, active)
VALUES
  ('trial',      'Free Trial',  0,     10,     true,  14,  0, true),
  ('starter',    'Starter',     4900,  25,     false, NULL, 1, true),
  ('pro',        'Pro',         9900,  100,    false, NULL, 2, true),
  ('enterprise', 'Enterprise',  19900, 999999, false, NULL, 3, true)
ON CONFLICT (name) DO UPDATE SET
  display_name        = EXCLUDED.display_name,
  monthly_price_cents = EXCLUDED.monthly_price_cents,
  location_limit      = EXCLUDED.location_limit,
  is_trial            = EXCLUDED.is_trial,
  trial_days          = EXCLUDED.trial_days,
  sort_order          = EXCLUDED.sort_order,
  active              = EXCLUDED.active,
  updated_at          = CURRENT_TIMESTAMP;
