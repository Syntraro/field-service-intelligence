-- 2026_04_21_notification_preferences.sql
-- User-level notification preferences (Phase 2, v1).
--
-- Run instructions:
--   npm run db:migrate:one -- migrations/2026_04_21_notification_preferences.sql
--
-- Purpose:
--   Completes the Phase 1 notification triptych:
--     - `notifications`           = what to say  (content — shipped)
--     - `notification_targets`    = where to send (delivery endpoints — shipped)
--     - `notification_preferences`= whether to send (user policy — this file)
--
--   Sibling to the other two tables; all three are channel-agnostic and
--   future-native compatible. Preferences are user-level (not per-device).
--
-- Defaults:
--   Every category column defaults to TRUE so existing users keep
--   receiving today's assignment push notifications with zero backfill.
--   The repository read path interprets "no row for this user" as
--   "all defaults" — no INSERT required on first login.
--
-- Adding future categories:
--   `ALTER TABLE notification_preferences ADD COLUMN <name>_enabled boolean NOT NULL DEFAULT TRUE;`
--   Existing rows auto-populate, existing emitters are unaffected.
--   This is the long-term extension path; no JSON blob, no key/value table.

BEGIN;

CREATE TABLE IF NOT EXISTS notification_preferences (
  id                                varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                         varchar NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id                           varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Phase 1 category (currently enforced in emitVisitAssignmentChange).
  visit_assignments_enabled         boolean NOT NULL DEFAULT TRUE,
  -- Phase 2+ categories — columns exist so the UI can persist user intent
  -- now, even though no emitter reads them yet. Each becomes active when
  -- its corresponding emitter lands; existing rows auto-have TRUE.
  visit_schedule_changes_enabled    boolean NOT NULL DEFAULT TRUE,
  visit_cancellations_enabled       boolean NOT NULL DEFAULT TRUE,
  visit_reminders_enabled           boolean NOT NULL DEFAULT TRUE,
  updated_at                        timestamp,
  created_at                        timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One row per (tenant, user). PATCH upserts on this constraint.
CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_tenant_user_idx
  ON notification_preferences (tenant_id, user_id);

COMMIT;
