-- Time Tracking Phase 7: Configurable Alerts + Escalation + Weekly Digest
-- Migration: Add time_alert_settings and notification_snoozes tables

-- ============================================================================
-- TIME ALERT SETTINGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS time_alert_settings (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR(255) NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  -- Threshold settings (in minutes)
  unassigned_threshold_minutes INTEGER NOT NULL DEFAULT 30,
  untracked_threshold_minutes INTEGER NOT NULL DEFAULT 60,
  long_running_threshold_minutes INTEGER NOT NULL DEFAULT 360,  -- 6 hours
  missing_clock_out_threshold_minutes INTEGER NOT NULL DEFAULT 720,  -- 12 hours
  -- Escalation settings
  repeat_days_to_escalate INTEGER NOT NULL DEFAULT 3,
  -- Digest settings
  digest_day_of_week INTEGER NOT NULL DEFAULT 1,  -- 1=Monday, 7=Sunday
  digest_enabled BOOLEAN NOT NULL DEFAULT true,
  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- NOTIFICATION SNOOZES
-- ============================================================================

CREATE TABLE IF NOT EXISTS notification_snoozes (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR(255) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,  -- NotificationType being snoozed
  snooze_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraint: one snooze per user per type within a company
CREATE UNIQUE INDEX IF NOT EXISTS notification_snoozes_user_type_idx
ON notification_snoozes(company_id, user_id, type);

-- Index for efficient snooze lookups
CREATE INDEX IF NOT EXISTS notification_snoozes_lookup_idx
ON notification_snoozes(user_id, type, snooze_until);
