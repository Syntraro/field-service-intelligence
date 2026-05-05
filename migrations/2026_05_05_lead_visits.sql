-- ============================================================================
-- Migration: 2026_05_05_lead_visits
-- ============================================================================
--
-- Purpose
--   Adds lead-side scheduling primitives so the office can put a tech onsite
--   for a pre-quote opportunity (lead) without spinning up a job. Two new
--   tables:
--
--     1. `lead_visits`         — sibling to `job_visits`. NEVER fold into
--                                 the existing job_visits feeds, predicates
--                                 (`scheduleEligibleVisitFilter`, etc.), or
--                                 reports. Capacity reads BOTH tables to
--                                 compute booked minutes.
--     2. `lead_note_attachments` — mirrors `job_note_attachments` so the
--                                 canonical fileUploadService can attach R2
--                                 files to lead notes without a special
--                                 case branch.
--
--   Plus a status-enum widening on `leads.status`:
--     `new | contacted | quoted | won | lost`
--   becomes
--     `new | contacted | needs_review | quoted | won | lost`
--
--   `leads.status` is a `text` column (no Postgres ENUM type), so the only
--   enforcement layer is the application-side TS enum + the manual
--   transition map in `server/routes/leads.ts`. Both are updated in the
--   same commit; this migration only touches the new tables.
--
-- Run instructions
--   Local / dev:   npm run db:migrate:one -- migrations/2026_05_05_lead_visits.sql
--   Full sweep:    npm run db:migrate
--
-- Reversibility
--   DROP INDEX IF EXISTS idx_lead_visits_company_active_start;
--   DROP INDEX IF EXISTS idx_lead_visits_lead_company_active;
--   DROP TABLE IF EXISTS lead_note_attachments;
--   DROP TABLE IF EXISTS lead_visits;
--   (No FK from any other table to either, so the reverse is safe.)
--
-- Idempotency
--   `IF NOT EXISTS` on every CREATE. Re-runs are no-ops.
-- ============================================================================

BEGIN;

-- 1) lead_visits
CREATE TABLE IF NOT EXISTS lead_visits (
  id                          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  lead_id                     VARCHAR NOT NULL REFERENCES leads(id) ON DELETE CASCADE,

  scheduled_start             TIMESTAMP,
  scheduled_end               TIMESTAMP,
  is_all_day                  BOOLEAN NOT NULL DEFAULT FALSE,
  estimated_duration_minutes  INTEGER DEFAULT 60,

  assigned_technician_ids     VARCHAR[],

  status                      TEXT NOT NULL DEFAULT 'scheduled',

  visit_notes                 TEXT,
  outcome_note                TEXT,
  completed_by_user_id        VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  completed_at                TIMESTAMP,

  is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
  version                     INTEGER NOT NULL DEFAULT 0,
  archived_at                 TIMESTAMPTZ,
  archived_by_user_id         VARCHAR,

  created_by_user_id          VARCHAR NOT NULL REFERENCES users(id),
  created_at                  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  TIMESTAMP
);

-- Mirrors idx_job_visits_company_active_start — drives the dispatch
-- calendar feed + the capacity range scan.
CREATE INDEX IF NOT EXISTS idx_lead_visits_company_active_start
  ON lead_visits (company_id, is_active, scheduled_start);

-- Per-lead lookups (LeadVisitsCard, isLastOpenVisitForLead).
CREATE INDEX IF NOT EXISTS idx_lead_visits_lead_company_active
  ON lead_visits (lead_id, company_id, is_active);

-- 2) lead_note_attachments — mirrors job_note_attachments shape exactly.
CREATE TABLE IF NOT EXISTS lead_note_attachments (
  id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  note_id     VARCHAR NOT NULL REFERENCES lead_notes(id) ON DELETE CASCADE,
  file_id     VARCHAR NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by  VARCHAR REFERENCES users(id)
);

-- Per-note lookup index (matches the job_note_attachments pattern).
CREATE INDEX IF NOT EXISTS idx_lead_note_attachments_note
  ON lead_note_attachments (note_id);

-- Per-tenant lookup index for ownership checks.
CREATE INDEX IF NOT EXISTS idx_lead_note_attachments_company
  ON lead_note_attachments (company_id);

COMMIT;
