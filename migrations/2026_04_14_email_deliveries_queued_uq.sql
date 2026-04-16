-- Phase A email hardening (2026-04-14): prevent concurrent duplicate
-- queued sends for the same (tenant, entity).
--
-- Partial unique index — scoped to `status = 'queued'` so legitimate
-- resends and new sends after transition remain unconstrained.
--
-- Run: npm run db:migrate:one -- migrations/2026_04_14_email_deliveries_queued_uq.sql

CREATE UNIQUE INDEX IF NOT EXISTS email_deliveries_queued_active_uq
  ON email_deliveries (tenant_id, entity_type, entity_id)
  WHERE status = 'queued';
