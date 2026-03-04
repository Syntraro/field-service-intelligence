-- Phase 1 Architecture: Event Log + Attention Queue
-- Creates events and attention_items tables
--
-- Run: psql "$DATABASE_URL" -f migrations/2026_03_04_events_and_attention_items.sql

-- ============================================================================
-- EVENTS — Canonical tenant-scoped append-only event log
-- ============================================================================

CREATE TABLE IF NOT EXISTS events (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  actor_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  actor_type TEXT NOT NULL DEFAULT 'user',
  entity_type TEXT NOT NULL,
  entity_id VARCHAR NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  summary TEXT NOT NULL,
  meta JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS events_tenant_created_idx ON events (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS events_tenant_entity_idx ON events (tenant_id, entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS events_tenant_event_type_idx ON events (tenant_id, event_type, created_at);

-- ============================================================================
-- ATTENTION ITEMS — Materialized "needs attention" queue
-- ============================================================================

CREATE TABLE IF NOT EXISTS attention_items (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id VARCHAR NOT NULL,
  rule_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  first_detected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_detected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP,
  meta JSONB,
  dedupe_key TEXT NOT NULL,
  CONSTRAINT attention_items_tenant_dedupe_idx UNIQUE (tenant_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS attention_items_tenant_status_idx ON attention_items (tenant_id, status, severity, last_detected_at);
CREATE INDEX IF NOT EXISTS attention_items_tenant_entity_idx ON attention_items (tenant_id, entity_type, entity_id);
