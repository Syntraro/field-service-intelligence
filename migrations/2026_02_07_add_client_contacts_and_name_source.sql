-- Migration: Add client_contacts table and name_source column to customer_companies
-- Run: psql "$DATABASE_URL" -f migrations/2026_02_07_add_client_contacts_and_name_source.sql
-- DO NOT use -1 or --single-transaction (contains CONCURRENTLY index)

-- 1) Add name_source column to customer_companies
-- Values: 'company' (use company name as client display name) or 'person' (use first+last)
ALTER TABLE customer_companies
  ADD COLUMN IF NOT EXISTS name_source text NOT NULL DEFAULT 'company';

-- 2) Create client_contacts table
-- Contacts belong to a customer_company. If location_id is set, the contact is location-specific.
CREATE TABLE IF NOT EXISTS client_contacts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id varchar NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_company_id varchar NOT NULL REFERENCES customer_companies(id) ON DELETE CASCADE,
  -- NULL = company-level contact; set = location-specific contact
  location_id varchar REFERENCES client_locations(id) ON DELETE CASCADE,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  email text,
  phone text,
  -- Role flags stored as text array: 'billing', 'scheduling', 'general', 'primary'
  roles text[] NOT NULL DEFAULT '{}',
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3) Indexes for common lookups
CREATE INDEX IF NOT EXISTS client_contacts_company_idx
  ON client_contacts(company_id);

CREATE INDEX IF NOT EXISTS client_contacts_customer_company_idx
  ON client_contacts(customer_company_id);

CREATE INDEX IF NOT EXISTS client_contacts_location_idx
  ON client_contacts(location_id)
  WHERE location_id IS NOT NULL;
