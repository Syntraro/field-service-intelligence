-- PM Billing Phase 2: Contract billing events for monthly_fixed / annual_prepaid PM contracts
-- Run: npm run db:migrate:one -- migrations/2026_03_11_pm_billing_events.sql

CREATE TABLE IF NOT EXISTS pm_billing_events (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  pm_contract_id VARCHAR NOT NULL REFERENCES recurring_job_templates(id) ON DELETE CASCADE,
  billing_model_snapshot TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  billing_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  invoice_id VARCHAR REFERENCES invoices(id) ON DELETE SET NULL,
  amount_snapshot NUMERIC(12, 2),
  billing_label_snapshot TEXT,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP
);

-- Idempotency: one billing event per contract per billing period
CREATE UNIQUE INDEX IF NOT EXISTS pm_billing_events_contract_period_uniq
  ON pm_billing_events (pm_contract_id, period_start);

-- Query indexes
CREATE INDEX IF NOT EXISTS pm_billing_events_company_idx ON pm_billing_events (company_id);
CREATE INDEX IF NOT EXISTS pm_billing_events_contract_idx ON pm_billing_events (pm_contract_id);
CREATE INDEX IF NOT EXISTS pm_billing_events_status_idx ON pm_billing_events (company_id, status);
