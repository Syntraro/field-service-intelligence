-- PM Billing Disposition + PM Billing Oversight Foundation
-- Run: npm run db:migrate:one -- migrations/2026_03_11_pm_billing_disposition.sql
--
-- Adds PM billing fields to:
--   1. recurring_job_templates (PM contract billing rules)
--   2. jobs (PM billing disposition snapshot)

-- ============================================================================
-- Part 1: PM Contract Billing Fields on recurring_job_templates
-- ============================================================================

ALTER TABLE recurring_job_templates
  ADD COLUMN IF NOT EXISTS pm_billing_model TEXT,
  ADD COLUMN IF NOT EXISTS pm_billing_label TEXT,
  ADD COLUMN IF NOT EXISTS pm_contract_amount NUMERIC(12,2);

COMMENT ON COLUMN recurring_job_templates.pm_billing_model IS 'PM billing model: per_visit, monthly_fixed, annual_prepaid, do_not_bill';
COMMENT ON COLUMN recurring_job_templates.pm_billing_label IS 'Human-readable billing label for this PM contract';
COMMENT ON COLUMN recurring_job_templates.pm_contract_amount IS 'Contract/service amount for billing reference';

-- ============================================================================
-- Part 2: PM Billing Disposition Snapshot on jobs
-- ============================================================================

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS pm_billing_model TEXT,
  ADD COLUMN IF NOT EXISTS pm_billing_disposition TEXT,
  ADD COLUMN IF NOT EXISTS pm_billing_status TEXT,
  ADD COLUMN IF NOT EXISTS pm_billing_label TEXT;

COMMENT ON COLUMN jobs.pm_billing_model IS 'Snapshot from PM contract: per_visit, monthly_fixed, annual_prepaid, do_not_bill';
COMMENT ON COLUMN jobs.pm_billing_disposition IS 'Derived billing action: invoice_on_completion, covered_by_contract, archive_no_invoice';
COMMENT ON COLUMN jobs.pm_billing_status IS 'Billing lifecycle: pending_invoice, invoiced, no_invoice_expected, billing_exception';
COMMENT ON COLUMN jobs.pm_billing_label IS 'Human-readable PM billing label snapshot from contract';
