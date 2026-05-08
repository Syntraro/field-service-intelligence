-- =====================================================================
-- Migration: 2026-05-07 — technician_time_off
-- =====================================================================
-- First-class technician time-off scheduling. Each row records a
-- single time-off interval for one technician (vacation, sick day,
-- personal, training, etc.). Time-off intervals BLOCK availability:
-- the canonical capacity service (`server/storage/capacity.ts`) reads
-- overlapping time-off rows and clips open slots around them. Rows
-- whose interval covers the technician's full workday make the
-- existing `state: "off_today"` rendering kick in for the Today
-- dashboard's grouped Available column.
--
-- Why
-- ---
-- The dashboard previously had no concept of "technician on vacation".
-- The existing `state: "off_today"` value on the capacity DTO was
-- driven entirely by `working_hours` configuration (no shift today =
-- off), with no admin-facing UI to mark a working tech unavailable
-- for a date range. Office staff were tracking time-off out-of-band
-- (Slack, Google Calendar) and accidentally double-booking techs.
--
-- This migration is additive: existing visit / job / capacity logic
-- is unchanged. Capacity reads time-off rows in addition to its
-- existing inputs (workday window + booked visits) and clips open
-- slots accordingly.
--
-- Schema
-- ------
--   id                   varchar PK (uuid)
--   company_id           FK companies(id) ON DELETE CASCADE — tenant scope.
--   technician_user_id   FK users(id) ON DELETE CASCADE — the off tech.
--   reason               text — validated against a string union at the
--                          API layer (vacation / sick / personal /
--                          training / unavailable / other). DB-side
--                          CHECK constraint enforces the same union.
--   starts_at            timestamptz — interval start (UTC instant).
--   ends_at              timestamptz — interval end (UTC instant);
--                          must be strictly after starts_at.
--   all_day              boolean — when true, UI renders as "all-day"
--                          and the route handler clamps starts_at /
--                          ends_at to the company-local day boundary.
--   note                 text NULL — optional free-form note.
--   created_by_user_id   FK users(id) — who created this entry.
--   created_at           timestamptz — insert-time clock.
--   updated_at           timestamptz — bumped on update.
--   archived_at          timestamptz NULL — soft-delete marker; queries
--                          filter `archived_at IS NULL` by default.
--
-- Constraints
-- -----------
--   technician_time_off_range_check: ends_at > starts_at.
--   technician_time_off_reason_check: reason ∈ {vacation, sick, personal,
--     training, unavailable, other}.
--
-- Indexes
-- -------
--   idx_technician_time_off_tenant_tech_range:
--     (company_id, technician_user_id, starts_at, ends_at) — the
--     canonical read predicate. Used by capacity reads + the route's
--     overlap query (techId + day window).
--
-- Run with
-- --------
--   npm run db:migrate:one -- migrations/2026_05_07_technician_time_off.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS technician_time_off (
  id                  varchar       PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          varchar       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  technician_user_id  varchar       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason              text          NOT NULL,
  starts_at           timestamptz   NOT NULL,
  ends_at             timestamptz   NOT NULL,
  all_day             boolean       NOT NULL DEFAULT false,
  note                text,
  created_by_user_id  varchar       NOT NULL REFERENCES users(id),
  created_at          timestamptz   NOT NULL DEFAULT NOW(),
  updated_at          timestamptz,
  archived_at         timestamptz,
  CONSTRAINT technician_time_off_range_check
    CHECK (ends_at > starts_at),
  CONSTRAINT technician_time_off_reason_check
    CHECK (reason IN ('vacation', 'sick', 'personal', 'training', 'unavailable', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_technician_time_off_tenant_tech_range
  ON technician_time_off (company_id, technician_user_id, starts_at, ends_at)
  WHERE archived_at IS NULL;
