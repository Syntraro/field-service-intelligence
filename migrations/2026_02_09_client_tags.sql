-- Phase 1: Client Tags
-- Run: psql "$DATABASE_URL" -f migrations/2026_02_09_client_tags.sql

-- Tenant-scoped tags for categorizing customer companies
CREATE TABLE IF NOT EXISTS client_tags (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6b7280',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Unique tag name per tenant
CREATE UNIQUE INDEX IF NOT EXISTS client_tags_company_name_idx
  ON client_tags (company_id, name);

-- Fast lookup by tenant
CREATE INDEX IF NOT EXISTS client_tags_company_id_idx
  ON client_tags (company_id);

-- Many-to-many: tags <-> customer companies
CREATE TABLE IF NOT EXISTS client_tag_assignments (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tag_id VARCHAR NOT NULL REFERENCES client_tags(id) ON DELETE CASCADE,
  customer_company_id VARCHAR NOT NULL REFERENCES customer_companies(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Each tag can only be assigned once per customer company
CREATE UNIQUE INDEX IF NOT EXISTS client_tag_assignments_unique_idx
  ON client_tag_assignments (tag_id, customer_company_id);

-- Fast lookup: all tags for a customer company
CREATE INDEX IF NOT EXISTS client_tag_assignments_customer_company_idx
  ON client_tag_assignments (customer_company_id);

-- Fast lookup: all customer companies with a given tag
CREATE INDEX IF NOT EXISTS client_tag_assignments_tag_idx
  ON client_tag_assignments (tag_id);
