-- PM Templates: Reusable job content templates for maintenance plans
-- Run: npm run db:migrate:one -- migrations/2026_03_10_pm_templates.sql

CREATE TABLE IF NOT EXISTS pm_templates (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  summary TEXT,
  description TEXT,
  default_line_items_json JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS pm_templates_company_idx ON pm_templates(company_id);
