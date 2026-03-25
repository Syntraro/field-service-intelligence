-- Job Expenses table — tracks additional job costs (parking, materials, mileage, etc.)
-- Feeds into unified job costing: Parts + Labor + Expenses → Total Cost / Profit / Margin.
--
-- Run: npm run db:migrate:one -- migrations/2026_03_24_job_expenses.sql

CREATE TABLE IF NOT EXISTS job_expenses (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id VARCHAR NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL,
  category TEXT NOT NULL,
  date TIMESTAMP NOT NULL,
  notes TEXT,
  created_by_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receipt_file_id VARCHAR REFERENCES files(id) ON DELETE SET NULL,
  is_billable BOOLEAN NOT NULL DEFAULT false,
  billing_status TEXT NOT NULL DEFAULT 'pending',
  approval_status TEXT NOT NULL DEFAULT 'pending',
  reimbursable_to_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS job_expenses_job_company_idx ON job_expenses(job_id, company_id);
CREATE INDEX IF NOT EXISTS job_expenses_company_created_at_idx ON job_expenses(company_id, created_at);
