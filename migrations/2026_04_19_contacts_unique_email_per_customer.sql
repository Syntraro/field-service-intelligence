-- 2026-04-19 Contact dedupe — case-insensitive email uniqueness within
-- a customer company.
--
-- Natural key: (company_id, customer_company_id, lower(email))
-- Scope: WHERE email IS NOT NULL AND TRIM(email) <> ''
--
-- Background:
--   `contact_persons` had no schema-level dedupe of any kind. Direct API
--   routes (POST /api/clients/full-create, POST /api/customer-companies/:id/contacts,
--   POST /api/customer-companies/:id/locations inline-contact branch) all
--   inserted without pre-checks. Only the CSV importer had an
--   email→name+phone→name cascade.
--
--   The matching `clientContactRepository.createOrGetPerson` helper lands
--   in the same release. The helper is the primary dedupe; this index is
--   the safety net for the strong-signal case (email-bearing contacts).
--   Name-only dedupe (no-email contacts) is application-only — two
--   different humans can legitimately share a name within a customer
--   ("John Smith Sr." vs "Jr."), so it's not enforced at the schema
--   layer.
--
-- Live duplicate scan against this DB returned 0 groups across all
-- tenants — safe to ship without a separate consolidation pass. If a
-- future environment fails this migration, run the detection query in
-- the CHANGELOG entry first and consolidate before re-applying.
--
-- Run via: npm run db:migrate (uses CONCURRENTLY → migration runner
-- dispatches statements outside the implicit transaction block).

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS contacts_company_customer_email_lower_uq
  ON contact_persons (company_id, customer_company_id, lower(email))
  WHERE email IS NOT NULL AND TRIM(email) <> '';
