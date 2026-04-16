-- Phase 3: Ops Portal Feedback + Issue System
--
-- Run with: npm run db:migrate:one -- migrations/2026_04_15_phase3_feedback_issues.sql
--
-- Extends the existing `feedback` table with platform-triage columns and
-- introduces two new tables owned by the Ops Portal:
--   - issue_reports          (internal bug tracker)
--   - internal_support_notes (append-only notes attached to feedback/issues/tenants)
--
-- No existing table is duplicated. All columns are additive and nullable so
-- the existing tenant feedback submit path remains unchanged.

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- 1. Extend `feedback` with platform-triage fields
-- ───────────────────────────────────────────────────────────────
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS title         TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS route         TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS feature_area  TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS priority      TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS assigned_to   VARCHAR REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_feedback_status       ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_assigned_to  ON feedback(assigned_to);
CREATE INDEX IF NOT EXISTS idx_feedback_company_id   ON feedback(company_id);

-- ───────────────────────────────────────────────────────────────
-- 2. Issue Reports — internal bug tracker
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS issue_reports (
  id             VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      VARCHAR REFERENCES companies(id) ON DELETE SET NULL,
  user_id        VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  source         TEXT NOT NULL DEFAULT 'platform',
  title          TEXT NOT NULL,
  description    TEXT,
  severity       TEXT NOT NULL DEFAULT 'medium',
  priority       TEXT,
  status         TEXT NOT NULL DEFAULT 'open',
  route          TEXT,
  feature_area   TEXT,
  repro_steps    TEXT,
  assigned_to    VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_issue_reports_tenant_id   ON issue_reports(tenant_id);
CREATE INDEX IF NOT EXISTS idx_issue_reports_status      ON issue_reports(status);
CREATE INDEX IF NOT EXISTS idx_issue_reports_severity    ON issue_reports(severity);
CREATE INDEX IF NOT EXISTS idx_issue_reports_assigned_to ON issue_reports(assigned_to);

-- ───────────────────────────────────────────────────────────────
-- 3. Internal Support Notes — append-only notes on arbitrary entities
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS internal_support_notes (
  id                   VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            VARCHAR REFERENCES companies(id) ON DELETE SET NULL,
  related_entity_type  TEXT NOT NULL,
  related_entity_id    VARCHAR NOT NULL,
  note                 TEXT NOT NULL,
  created_by           VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_internal_support_notes_entity ON internal_support_notes(related_entity_type, related_entity_id);
CREATE INDEX IF NOT EXISTS idx_internal_support_notes_tenant ON internal_support_notes(tenant_id);

COMMIT;
