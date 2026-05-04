-- ============================================================================
-- Migration: 2026_05_03_company_tax_registrations_table
-- ============================================================================
--
-- Purpose
--   Refactor the company-level tax registration model from a single
--   pair of columns on `companies` (taxRegistrationLabel +
--   taxRegistrationNumber) to a separate child table
--   `company_tax_registrations` so each tenant can store MULTIPLE
--   registration entries (e.g. HST + GST, or VAT + EORI). The
--   customer-facing invoice PDF will then render every active row
--   as its own line under the company contact block.
--
--   Earlier today's migration (2026_05_03_company_tax_registration.sql)
--   added the two columns; this one introduces the canonical multi-row
--   model and backfills existing values forward. The two columns on
--   `companies` are deliberately KEPT in place — marked deprecated in
--   the Drizzle schema, no longer written to by the API surface — so
--   a rollback to today's earlier code keeps reading them. A future
--   PR will drop them once both code paths have been retired in
--   production.
--
-- Schema source
--   `shared/schema.ts::companyTaxRegistrations` (new table added in
--   the same commit).
--
-- Run instructions
--   Local / dev:   npm run db:migrate:one -- migrations/2026_05_03_company_tax_registrations_table.sql
--   Full sweep:    npm run db:migrate
--
-- Reversibility
--   `DROP TABLE company_tax_registrations;`
--   The legacy `companies.tax_registration_label/number` columns are
--   untouched; an immediate rollback to the previous code path
--   continues to work because those columns still hold the original
--   value (and now also the same value duplicated into the new table).
--
-- Idempotency
--   `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` make
--   the structural part safe to re-run. The backfill INSERT is
--   guarded by `NOT EXISTS` against the destination table, so re-runs
--   do NOT duplicate rows for tenants that have already been
--   migrated.
--
-- Backfill
--   For every company that has a non-empty
--   `companies.tax_registration_number`, copy `(label, number, 0)`
--   into `company_tax_registrations`. Empty / NULL labels are stored
--   as NULL (the PDF service falls back to the literal "Tax ID" when
--   the label is missing). Skip companies that already have at least
--   one row in the new table (idempotency).
--
-- Tenant safety
--   `company_id` carries `ON DELETE CASCADE` so deleting a tenant
--   cleans up its registrations. `number` is NOT NULL — a registration
--   with no number has no purpose and would render as a blank line.
--   `label` is nullable — international jurisdictions sometimes use a
--   bare number with no jurisdictional prefix, in which case the PDF
--   renders "Tax ID: {number}".
-- ============================================================================

CREATE TABLE IF NOT EXISTS "company_tax_registrations" (
  "id"          varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id"  varchar NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "label"       text,
  "number"      text NOT NULL,
  "sort_order"  integer NOT NULL DEFAULT 0,
  "created_at"  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Lookup index: every read is "list all rows for one company in
-- presentation order". Single composite index covers both the
-- equality predicate and the ORDER BY.
CREATE INDEX IF NOT EXISTS "idx_company_tax_registrations_company"
  ON "company_tax_registrations" ("company_id", "sort_order");

-- Backfill — idempotent. Runs once per company that has data in the
-- legacy columns and no row yet in the new table.
INSERT INTO "company_tax_registrations" ("company_id", "label", "number", "sort_order")
SELECT
  c."id",
  CASE
    WHEN c."tax_registration_label" IS NULL THEN NULL
    WHEN trim(c."tax_registration_label") = '' THEN NULL
    ELSE trim(c."tax_registration_label")
  END AS "label",
  trim(c."tax_registration_number") AS "number",
  0 AS "sort_order"
FROM "companies" c
WHERE c."tax_registration_number" IS NOT NULL
  AND trim(c."tax_registration_number") <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM "company_tax_registrations" r
    WHERE r."company_id" = c."id"
  );
