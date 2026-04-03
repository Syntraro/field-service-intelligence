-- Migration: Add leads table + lead_id to quotes and jobs
-- Run: npm run db:migrate:one -- migrations/2026_03_28_add_leads.sql
-- Date: 2026-03-28
-- Purpose: Pre-quote pipeline + attribution layer for sales opportunity tracking

-- 1. Create leads table
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES client_locations(id) ON DELETE RESTRICT,
  customer_company_id UUID REFERENCES customer_companies(id) ON DELETE SET NULL,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  origin_technician_id UUID REFERENCES users(id),
  assigned_to_user_id UUID REFERENCES users(id),
  source_type TEXT NOT NULL DEFAULT 'office',
  source_ref_type TEXT,
  source_ref_id UUID,
  status TEXT NOT NULL DEFAULT 'new',
  priority TEXT DEFAULT 'medium',
  title TEXT NOT NULL,
  description TEXT,
  estimated_value NUMERIC(12,2),
  converted_quote_id UUID,
  converted_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- Indexes for leads
CREATE INDEX idx_leads_company_status ON leads(company_id, status) WHERE is_active = true;
CREATE INDEX idx_leads_origin_tech ON leads(origin_technician_id) WHERE origin_technician_id IS NOT NULL;
CREATE INDEX idx_leads_assigned ON leads(assigned_to_user_id) WHERE assigned_to_user_id IS NOT NULL;

-- 2. Add lead_id to quotes
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_quotes_lead_id ON quotes(lead_id) WHERE lead_id IS NOT NULL;

-- 3. Add lead_id to jobs
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_lead_id ON jobs(lead_id) WHERE lead_id IS NOT NULL;
