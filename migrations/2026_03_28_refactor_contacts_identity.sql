-- Migration: Refactor contacts to identity + assignment model
-- Run: npm run db:migrate:one -- migrations/2026_03_28_refactor_contacts_identity.sql
-- Date: 2026-03-28
-- Purpose: Eliminate duplicate person rows for multi-location contacts.
--          Split client_contacts into contact_persons (identity) + contact_assignments (location roles).

-- 1. Create contact_persons table (person identity, one row per human)
CREATE TABLE IF NOT EXISTS contact_persons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_company_id UUID NOT NULL REFERENCES customer_companies(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  phone TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_contact_persons_company ON contact_persons(company_id, customer_company_id);
CREATE INDEX idx_contact_persons_email ON contact_persons(company_id, email) WHERE email IS NOT NULL;

-- 2. Create contact_assignments table (location-specific role assignments)
CREATE TABLE IF NOT EXISTS contact_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_person_id UUID NOT NULL REFERENCES contact_persons(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES client_locations(id) ON DELETE CASCADE,
  roles TEXT[] NOT NULL DEFAULT '{}'::text[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_contact_assignments_person ON contact_assignments(contact_person_id);
CREATE INDEX idx_contact_assignments_location ON contact_assignments(company_id, location_id);
-- Prevent duplicate assignment of same person to same location
CREATE UNIQUE INDEX idx_contact_assignments_unique ON contact_assignments(contact_person_id, location_id);

-- 3. Migrate data: deduplicate client_contacts into contact_persons + contact_assignments
-- Strategy: group by (company_id, customer_company_id, LOWER(email)) where email exists,
-- then by (company_id, customer_company_id, LOWER(first_name || ' ' || last_name), phone) for the rest.
-- Each group becomes one contact_persons row. Location-scoped rows become contact_assignments.

-- Step 3a: Insert deduplicated persons from email-based grouping
INSERT INTO contact_persons (id, company_id, customer_company_id, first_name, last_name, email, phone, is_primary, created_at, updated_at)
SELECT DISTINCT ON (company_id, customer_company_id, LOWER(TRIM(email)))
  gen_random_uuid(),
  company_id,
  customer_company_id,
  first_name,
  last_name,
  email,
  phone,
  is_primary,
  MIN(created_at) OVER (PARTITION BY company_id, customer_company_id, LOWER(TRIM(email))),
  NOW()
FROM client_contacts
WHERE email IS NOT NULL AND TRIM(email) != ''
ORDER BY company_id, customer_company_id, LOWER(TRIM(email)), created_at ASC;

-- Step 3b: Insert persons from non-email contacts (grouped by name + phone)
INSERT INTO contact_persons (id, company_id, customer_company_id, first_name, last_name, email, phone, is_primary, created_at, updated_at)
SELECT DISTINCT ON (company_id, customer_company_id, LOWER(TRIM(first_name || ' ' || last_name)), COALESCE(phone, ''))
  gen_random_uuid(),
  company_id,
  customer_company_id,
  first_name,
  last_name,
  email,
  phone,
  is_primary,
  MIN(created_at) OVER (PARTITION BY company_id, customer_company_id, LOWER(TRIM(first_name || ' ' || last_name)), COALESCE(phone, '')),
  NOW()
FROM client_contacts
WHERE (email IS NULL OR TRIM(email) = '')
ORDER BY company_id, customer_company_id, LOWER(TRIM(first_name || ' ' || last_name)), COALESCE(phone, ''), created_at ASC;

-- Step 3c: Create assignments for location-scoped contacts
-- Match back to the deduped person via email first, then name+phone
INSERT INTO contact_assignments (company_id, contact_person_id, location_id, roles, created_at, updated_at)
SELECT
  cc.company_id,
  COALESCE(
    -- Match by email
    (SELECT cp.id FROM contact_persons cp
     WHERE cp.company_id = cc.company_id
       AND cp.customer_company_id = cc.customer_company_id
       AND cp.email IS NOT NULL AND TRIM(cp.email) != ''
       AND LOWER(TRIM(cp.email)) = LOWER(TRIM(cc.email))
     LIMIT 1),
    -- Match by name + phone
    (SELECT cp.id FROM contact_persons cp
     WHERE cp.company_id = cc.company_id
       AND cp.customer_company_id = cc.customer_company_id
       AND LOWER(TRIM(cp.first_name || ' ' || cp.last_name)) = LOWER(TRIM(cc.first_name || ' ' || cc.last_name))
       AND COALESCE(cp.phone, '') = COALESCE(cc.phone, '')
     LIMIT 1)
  ),
  cc.location_id,
  cc.roles,
  cc.created_at,
  NOW()
FROM client_contacts cc
WHERE cc.location_id IS NOT NULL
-- Only insert if we found a matching person (safety check)
AND COALESCE(
  (SELECT cp.id FROM contact_persons cp
   WHERE cp.company_id = cc.company_id AND cp.customer_company_id = cc.customer_company_id
     AND cp.email IS NOT NULL AND TRIM(cp.email) != '' AND LOWER(TRIM(cp.email)) = LOWER(TRIM(cc.email))
   LIMIT 1),
  (SELECT cp.id FROM contact_persons cp
   WHERE cp.company_id = cc.company_id AND cp.customer_company_id = cc.customer_company_id
     AND LOWER(TRIM(cp.first_name || ' ' || cp.last_name)) = LOWER(TRIM(cc.first_name || ' ' || cc.last_name))
     AND COALESCE(cp.phone, '') = COALESCE(cc.phone, '')
   LIMIT 1)
) IS NOT NULL
-- Skip duplicates from the unique index
ON CONFLICT (contact_person_id, location_id) DO NOTHING;

-- 4. Rename old table (keep as backup, can be dropped later after verification)
ALTER TABLE client_contacts RENAME TO client_contacts_legacy;
