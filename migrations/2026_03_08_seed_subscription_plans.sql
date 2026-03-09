-- Migration: Seed subscription plans with correct limits
-- Date: 2026-03-08
-- Description: Inserts Starter, Pro, Enterprise, and Trial plan definitions.
--              Fixes bug where "enterprise" plan was missing, causing fallback
--              to trial (limit=10) even for enterprise tenants.
--
-- Run: psql $DATABASE_URL < migrations/2026_03_08_seed_subscription_plans.sql

-- Upsert plans (ON CONFLICT to be safe if partial data already exists)
INSERT INTO subscription_plans (name, display_name, monthly_price_cents, location_limit, is_trial, trial_days, sort_order, active)
VALUES
  ('trial',      'Free Trial',  0,     10,     true,  14,  0, true),
  ('starter',    'Starter',     4900,  25,     false, NULL, 1, true),
  ('pro',        'Pro',         9900,  100,    false, NULL, 2, true),
  ('enterprise', 'Enterprise',  19900, 999999, false, NULL, 3, true)
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  monthly_price_cents = EXCLUDED.monthly_price_cents,
  location_limit = EXCLUDED.location_limit,
  is_trial = EXCLUDED.is_trial,
  trial_days = EXCLUDED.trial_days,
  sort_order = EXCLUDED.sort_order,
  active = EXCLUDED.active,
  updated_at = CURRENT_TIMESTAMP;
