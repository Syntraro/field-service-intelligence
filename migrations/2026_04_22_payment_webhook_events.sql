-- 2026-04-22 Payment Ops Dashboard PR1
-- Persistent log of inbound provider-webhook deliveries. Provider-neutral
-- column names so any adapter (Stripe today, future Square/etc.) writes
-- to the same table. Mirrors the qbo_webhook_events pattern.
--
-- Additive only. No existing table is modified. Drop-safe by reverse:
--   DROP INDEX IF EXISTS payment_webhook_events_*;
--   DROP TABLE IF EXISTS payment_webhook_events;
--
-- Run:  npm run db:migrate:one -- migrations/2026_04_22_payment_webhook_events.sql

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id                 varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id        text NOT NULL,
  provider_event_id  text,
  event_type         text,
  event_kind         text NOT NULL,
  outcome            text NOT NULL,
  http_status        integer NOT NULL,
  company_id         varchar REFERENCES companies(id) ON DELETE SET NULL,
  invoice_id         varchar,
  parent_payment_id  varchar,
  provider_payment_id text,
  provider_refund_id text,
  amount_cents       integer,
  error_message      text,
  raw_metadata       jsonb,
  dedupe_key         text,
  attempts           integer NOT NULL DEFAULT 1,
  received_at        timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at       timestamptz
);

-- Natural dedupe key. Partial because signature failures (no parseable
-- event id) are intentionally not deduped — each is its own row.
CREATE UNIQUE INDEX IF NOT EXISTS payment_webhook_events_dedupe_key_uq
  ON payment_webhook_events (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- Per-tenant ops queries ("show me webhook events for tenant X").
CREATE INDEX IF NOT EXISTS payment_webhook_events_company_received_idx
  ON payment_webhook_events (company_id, received_at DESC);

-- Operator alerts ("how many transient failures in the last hour?").
CREATE INDEX IF NOT EXISTS payment_webhook_events_outcome_received_idx
  ON payment_webhook_events (outcome, received_at DESC);

-- Cross-reference lookups from the provider dashboard.
CREATE INDEX IF NOT EXISTS payment_webhook_events_provider_event_idx
  ON payment_webhook_events (provider_id, provider_event_id);
