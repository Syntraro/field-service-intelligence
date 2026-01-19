-- Migration: Add tenant subscriptions and subscription events tables
-- Date: 2026-01-16
-- Description: Implements subscription management with Monthly/Annual billing cycles,
--              auto-renewal toggle, and idempotent event tracking for audit trail.

-- ============================================================================
-- TENANT SUBSCRIPTIONS TABLE
-- ============================================================================
-- Stores the subscription configuration for each tenant (one active subscription per company)

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  plan_id VARCHAR REFERENCES subscription_plans(id) ON DELETE SET NULL,

  -- Billing cycle configuration
  billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'annual')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending_renewal', 'cancelled')),
  auto_renew_annual BOOLEAN NOT NULL DEFAULT true,

  -- Date tracking
  start_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  end_date TIMESTAMPTZ, -- Required for annual, null for monthly
  cancelled_at TIMESTAMPTZ,

  -- Audit/pricing guard
  reverted_from_annual BOOLEAN NOT NULL DEFAULT false,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ
);

-- Indexes for tenant_subscriptions
CREATE INDEX IF NOT EXISTS tenant_subscriptions_company_idx ON tenant_subscriptions(company_id);
CREATE INDEX IF NOT EXISTS tenant_subscriptions_status_idx ON tenant_subscriptions(status);
CREATE INDEX IF NOT EXISTS tenant_subscriptions_end_date_idx ON tenant_subscriptions(end_date);

-- ============================================================================
-- SUBSCRIPTION EVENTS TABLE
-- ============================================================================
-- Audit trail and idempotency guard for subscription lifecycle events

CREATE TABLE IF NOT EXISTS subscription_events (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id VARCHAR NOT NULL REFERENCES tenant_subscriptions(id) ON DELETE CASCADE,
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Event type
  type TEXT NOT NULL CHECK (type IN (
    'renewal_notice_30',
    'renewal_notice_7',
    'annual_renewed',
    'reverted_to_monthly',
    'cancelled',
    'signup',
    'manual_renewal'
  )),

  -- Term end date for idempotency (should be set for annual-related events)
  term_end_date TIMESTAMPTZ,

  -- Additional context as JSON
  metadata JSONB,

  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- UNIQUE constraint for idempotency: prevent duplicate events for the same subscription/type/term
-- This allows the same event type to be recorded multiple times for different terms
CREATE UNIQUE INDEX IF NOT EXISTS subscription_events_idempotency_idx
  ON subscription_events(subscription_id, type, term_end_date)
  WHERE term_end_date IS NOT NULL;

-- For events without a term_end_date (like signup), we need a different constraint
-- This prevents duplicate signup events for the same subscription
CREATE UNIQUE INDEX IF NOT EXISTS subscription_events_signup_idempotency_idx
  ON subscription_events(subscription_id, type)
  WHERE term_end_date IS NULL AND type = 'signup';

-- Additional indexes for querying
CREATE INDEX IF NOT EXISTS subscription_events_subscription_idx ON subscription_events(subscription_id);
CREATE INDEX IF NOT EXISTS subscription_events_company_idx ON subscription_events(company_id);
CREATE INDEX IF NOT EXISTS subscription_events_type_idx ON subscription_events(type);
CREATE INDEX IF NOT EXISTS subscription_events_created_at_idx ON subscription_events(created_at);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE tenant_subscriptions IS 'Stores subscription configuration for each tenant. One active subscription per company.';
COMMENT ON COLUMN tenant_subscriptions.billing_cycle IS 'Monthly or Annual billing cycle';
COMMENT ON COLUMN tenant_subscriptions.auto_renew_annual IS 'If true, annual subscriptions auto-renew. If false, they revert to monthly at term end.';
COMMENT ON COLUMN tenant_subscriptions.end_date IS 'Required for annual subscriptions, null for monthly (ongoing)';
COMMENT ON COLUMN tenant_subscriptions.reverted_from_annual IS 'True if subscription was annual and auto-reverted to monthly at term end';

COMMENT ON TABLE subscription_events IS 'Audit trail and idempotency guard for subscription lifecycle events';
COMMENT ON COLUMN subscription_events.term_end_date IS 'The end date this event applies to. Used for idempotency to prevent duplicate processing per term.';
COMMENT ON COLUMN subscription_events.metadata IS 'JSON with additional context: old_end_date, new_end_date, reason, etc.';
