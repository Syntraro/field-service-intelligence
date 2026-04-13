-- 2026_04_12_communication_templates.sql
-- Phase 1 of the Communication Templates feature. Creates the tenant-scoped
-- template table that will back invoice / quote / job email (and later SMS)
-- rendering.
--
-- Run instructions:
--   npm run db:migrate:one -- migrations/2026_04_12_communication_templates.sql
--
-- Rollback:
--   BEGIN;
--     DROP TABLE IF EXISTS communication_templates;
--   COMMIT;

BEGIN;

CREATE TABLE IF NOT EXISTS communication_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity_type       text NOT NULL,
  channel           text NOT NULL,
  subject_template  text,
  body_template     text NOT NULL,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now(),

  CONSTRAINT comm_templates_entity_type_chk
    CHECK (entity_type IN ('invoice', 'quote', 'job')),
  CONSTRAINT comm_templates_channel_chk
    CHECK (channel IN ('email', 'sms')),
  -- Email requires a subject; SMS may omit it.
  CONSTRAINT comm_templates_subject_required_for_email_chk
    CHECK (channel <> 'email' OR subject_template IS NOT NULL),

  CONSTRAINT comm_templates_tenant_entity_channel_uq
    UNIQUE (tenant_id, entity_type, channel)
);

CREATE INDEX IF NOT EXISTS idx_comm_templates_tenant
  ON communication_templates (tenant_id);

COMMIT;
