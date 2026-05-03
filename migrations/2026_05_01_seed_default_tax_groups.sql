-- ============================================================================
-- 2026-05-01 — Seed canonical default tax groups from legacy companies fields.
--
-- WHY:
--   Pre-Phase-2.7 invoice creation reads tax via the canonical
--   `companies.tax_groups` chain (companies → company_tax_groups →
--   company_tax_group_rates → company_tax_rates). When a tenant has no
--   row in `company_tax_groups` flagged `is_default = TRUE`, the
--   invoice-creation service silently skips tax application
--   (server/services/invoiceCreationService.ts), surfacing as
--   "No Tax" on every new invoice — even when the tenant has a
--   non-zero `companies.default_tax_rate`. This migration backfills
--   the canonical group/rate/junction rows from the legacy fields so
--   subsequent invoices apply tax correctly.
--
-- SAFETY:
--   - Idempotent: re-runs on already-seeded companies are no-ops.
--   - Tenants that already have a default tax group are SKIPPED
--     entirely — no overwrites, no duplicates.
--   - Tenants whose `default_tax_rate` is 0 are SKIPPED (they're
--     opting out of tax — don't synthesize a 0% group for them).
--   - Junction row creation is gated on the same idempotent guard.
--
-- HOW TO RUN:
--   npm run db:migrate:one -- migrations/2026_05_01_seed_default_tax_groups.sql
-- ============================================================================

BEGIN;

-- 1. Insert a default tax group for any company that:
--    (a) does NOT already have a group flagged is_default = TRUE
--    (b) has a non-zero legacy `default_tax_rate`
WITH eligible AS (
  SELECT
    c.id          AS company_id,
    c.tax_name    AS legacy_name,
    c.default_tax_rate AS legacy_rate
  FROM companies c
  WHERE c.default_tax_rate > 0
    AND NOT EXISTS (
      SELECT 1
      FROM company_tax_groups g
      WHERE g.company_id = c.id
        AND g.is_default = TRUE
        AND g.active = TRUE
    )
),
new_group AS (
  INSERT INTO company_tax_groups (id, company_id, name, description, is_default, active, created_at)
  SELECT
    gen_random_uuid(),
    e.company_id,
    e.legacy_name,
    'Backfilled from legacy companies.default_tax_rate (2026-05-01).',
    TRUE,
    TRUE,
    NOW()
  FROM eligible e
  RETURNING id, company_id, name
),
-- 2. Insert the matching component rate for each new group's company.
new_rate AS (
  INSERT INTO company_tax_rates (id, company_id, name, rate, description, active, created_at)
  SELECT
    gen_random_uuid(),
    g.company_id,
    g.name,
    c.default_tax_rate,
    'Backfilled from legacy companies.default_tax_rate (2026-05-01).',
    TRUE,
    NOW()
  FROM new_group g
  JOIN companies c ON c.id = g.company_id
  RETURNING id, company_id
)
-- 3. Link the new rate to the new group via the junction table.
INSERT INTO company_tax_group_rates (id, group_id, tax_rate_id)
SELECT
  gen_random_uuid(),
  g.id,
  r.id
FROM new_group g
JOIN new_rate r ON r.company_id = g.company_id;

COMMIT;

-- ============================================================================
-- Post-migration verification (read-only — run manually if you want to spot-check):
--
--   SELECT
--     c.id,
--     c.tax_name,
--     c.default_tax_rate,
--     g.id   AS group_id,
--     g.name AS group_name,
--     r.rate AS rate_percent
--   FROM companies c
--   LEFT JOIN company_tax_groups g
--     ON g.company_id = c.id AND g.is_default = TRUE AND g.active = TRUE
--   LEFT JOIN company_tax_group_rates jr ON jr.group_id = g.id
--   LEFT JOIN company_tax_rates r ON r.id = jr.tax_rate_id
--   ORDER BY c.id;
--
-- After this migration, every company with default_tax_rate > 0 should
-- have one row with non-NULL group_id, group_name, rate_percent.
-- ============================================================================
