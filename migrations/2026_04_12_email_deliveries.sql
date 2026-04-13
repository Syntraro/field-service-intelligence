-- 2026_04_12_email_deliveries.sql
-- Phase 10 — Email delivery tracking. Persists one row per outbound
-- email dispatch (invoices / quotes / jobs) and the provider lifecycle
-- state afterward.
--
-- Run instructions:
--   npm run db:migrate:one -- migrations/2026_04_12_email_deliveries.sql
--
-- Rollback:
--   BEGIN;
--     DROP TABLE IF EXISTS email_deliveries;
--   COMMIT;

BEGIN;

-- NOTE: all primary-key/FK columns in this schema are `varchar` (holding
-- UUID strings produced by `gen_random_uuid()`), NOT native `uuid`. Keep
-- tenant_id / entity_id / id as varchar to match companies.id + users.id.
CREATE TABLE IF NOT EXISTS email_deliveries (
  id                    varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             varchar NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity_type           text NOT NULL,
  entity_id             varchar NOT NULL,
  channel               text NOT NULL DEFAULT 'email',
  recipient_count       integer NOT NULL DEFAULT 0,
  recipients_json       jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject               text,
  body_snapshot         text,
  template_source       text NOT NULL,
  provider              text NOT NULL DEFAULT 'resend',
  provider_message_id   text,
  status                text NOT NULL,
  error_message         text,
  sent_at               timestamp,
  delivered_at          timestamp,
  failed_at             timestamp,
  created_by_user_id    varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamp NOT NULL DEFAULT now(),
  updated_at            timestamp NOT NULL DEFAULT now(),

  CONSTRAINT email_deliveries_entity_type_chk
    CHECK (entity_type IN ('invoice', 'quote', 'job')),
  CONSTRAINT email_deliveries_channel_chk
    CHECK (channel IN ('email')),
  CONSTRAINT email_deliveries_template_source_chk
    CHECK (template_source IN ('default', 'tenant_template', 'override')),
  CONSTRAINT email_deliveries_status_chk
    CHECK (status IN ('queued', 'sent', 'failed', 'delivered', 'bounced', 'complained'))
);

CREATE INDEX IF NOT EXISTS idx_email_deliveries_tenant
  ON email_deliveries (tenant_id);
CREATE INDEX IF NOT EXISTS idx_email_deliveries_entity
  ON email_deliveries (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_email_deliveries_provider_msg
  ON email_deliveries (provider_message_id);
CREATE INDEX IF NOT EXISTS idx_email_deliveries_status
  ON email_deliveries (status);

COMMIT;
