-- =====================================================================
-- Migration: 2026-05-07 — activity_feed_preferences
-- =====================================================================
-- Adds per-user toggles for which canonical activity event types appear
-- in that user's global Activity Feed drawer. One row per user; absence
-- of a row means "use the canonical defaults" (no auto-seed on signup).
--
-- Why
-- ---
-- The new global Activity Feed reads from the existing canonical
-- `events` table (no duplicate event log). Different operators want
-- different signal levels — dispatchers care about visit/tech state,
-- AR cares about invoices/payments. This table backs the "Customize
-- Feed" drawer view; toggles are per-user, not per-tenant.
--
-- Schema
-- ------
--   user_id              FK users(id) ON DELETE CASCADE — owner of the row
--   tenant_id            FK companies(id) ON DELETE CASCADE — denormalized
--                         for tenant-scoped admin reads (one user per tenant
--                         today, but the FK is here for future cross-tenant
--                         platform users)
--   enabled_event_types  jsonb — array of canonical event_type strings the
--                         user wants to see (e.g.
--                         ["visit.started","invoice.paid",...]). Server
--                         validates against the canonical registry on PUT
--                         and rejects unknown keys at 400.
--   updated_at           timestamptz — bumped on UPDATE.
--   created_at           timestamptz — insert-time clock.
--
-- Constraints
-- -----------
--   UNIQUE (user_id) — one preference row per user; PUT is upsert.
--
-- Run with
-- --------
--   npm run db:migrate:one -- migrations/2026_05_07_activity_feed_preferences.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS activity_feed_preferences (
  id                   varchar       PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              varchar       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id            varchar       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  enabled_event_types  jsonb         NOT NULL DEFAULT '[]'::jsonb,
  created_at           timestamptz   NOT NULL DEFAULT NOW(),
  updated_at           timestamptz,
  CONSTRAINT activity_feed_preferences_user_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_feed_preferences_tenant
  ON activity_feed_preferences (tenant_id);
