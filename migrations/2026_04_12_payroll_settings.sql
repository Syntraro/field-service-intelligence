-- Migration: per-tenant payroll settings for the Timesheet Report.
--
-- Rationale:
--   The Timesheet Report supports pay-period quick filters (Current /
--   Previous / Next). Those periods are derived from a tenant-scoped
--   frequency + anchor date. No existing table carries this information.
--
--   Phase 1 implements `weekly` + `biweekly` in the UI; `semimonthly` and
--   `monthly` are reserved in the enum for later.
--
-- Run with:
--   npm run db:migrate:one -- migrations/2026_04_12_payroll_settings.sql

BEGIN;

CREATE TABLE IF NOT EXISTS payroll_settings (
  company_id       varchar PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  pay_frequency    varchar NOT NULL DEFAULT 'biweekly',
  pay_anchor_date  text    NOT NULL,
  created_at       timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       timestamp
);

COMMIT;
