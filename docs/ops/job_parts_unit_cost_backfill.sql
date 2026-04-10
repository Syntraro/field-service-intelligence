-- =====================================================================
-- ONE-TIME BACKFILL: job_parts.unit_cost
--
-- This is an OPS PROCEDURE, not an automated migration.
-- It lives outside /migrations/ on purpose:
--   - The migration runner picks up every *.sql file in /migrations/.
--   - This file requires manual review of the preview count and a manual
--     COMMIT decision. It is NOT safe to auto-run.
--
-- Run manually via psql or your DB console. Do NOT pipe through
-- npm run db:migrate / npm run db:migrate:one.
--
-- Background:
--   Three code paths were inserting `job_parts` rows with NULL `unit_cost`
--   under specific conditions (see audit 2026-04-10):
--     1. server/storage/templates.ts applyJobTemplateToJob — bulk SELECT
--        omitted items.cost; insert omitted unit_cost. PRIMARY active
--        source. Fixed by `unitCost: product?.cost ?? null` in the
--        bulk insert.
--     2. server/routes/quotes.ts POST /api/quotes/:id/convert-to-job —
--        quote_lines schema has no unit_cost column; convert path passed
--        the line through createJobPart without backfilling from items.
--        Fixed by the `normalizeJobPartUnitCost` helper now wired into
--        jobRepository.createJobPart.
--     3. Pre-Phase-B office add-part path (PartsBillingCard) — historical
--        artifact. Already fixed by Phase B canonical pipeline; helper
--        is defense-in-depth.
--
--   Forward fix landed 2026-04-10 in:
--     - server/storage/jobs.ts (createJobPart now calls normalizeJobPartUnitCost)
--     - server/storage/templates.ts (bulk SELECT + insert hydrate cost)
--
--   This script backfills the historical NULL rows the bug left behind.
--
-- Safety analysis:
--   - Updates ONLY rows where:
--       1. unit_cost IS NULL                 (no existing value to overwrite)
--       2. product_id IS NOT NULL            (must have a catalog link)
--       3. items.cost IS NOT NULL            (catalog has a cost to copy)
--   - Tenant-safe: every job_parts row already carries company_id and the
--     join to items is on the global items.id, but the catalog write was
--     created in the same tenant by construction (the original code path
--     read from items_by_company). No cross-tenant cost leakage.
--   - Does NOT touch rows with product_id IS NULL — manual lines without a
--     catalog link have no cost basis to look up. They stay NULL by design.
--   - Does NOT touch rows that already have a non-null unit_cost. Idempotent
--     across re-runs.
--   - Reversible per-row: a specific row can be reset with
--         UPDATE job_parts SET unit_cost = NULL WHERE id = '<id>';
--
-- =====================================================================

-- ---------------------------------------------------------------------
-- STEP 1 — Read-only preview (run anytime, no side effects)
-- ---------------------------------------------------------------------

-- Count rows that will be backfilled:
SELECT COUNT(*)::int AS rows_to_backfill
FROM job_parts jp
JOIN items i ON i.id = jp.product_id
WHERE jp.unit_cost IS NULL
  AND jp.product_id IS NOT NULL
  AND i.cost IS NOT NULL;

-- Sample 20 rows for eyeball verification:
SELECT
  jp.id            AS job_part_id,
  jp.company_id,
  jp.job_id,
  jp.description,
  jp.quantity,
  jp.unit_price    AS jp_unit_price,
  i.name           AS catalog_name,
  i.cost           AS catalog_cost,
  i.unit_price     AS catalog_unit_price,
  jp.created_at
FROM job_parts jp
JOIN items i ON i.id = jp.product_id
WHERE jp.unit_cost IS NULL
  AND jp.product_id IS NOT NULL
  AND i.cost IS NOT NULL
ORDER BY jp.created_at DESC NULLS LAST
LIMIT 20;

-- Sanity check: rows that will NOT be touched (manual lines with no
-- product_id). These remain NULL by design.
SELECT COUNT(*)::int AS untouched_manual_rows
FROM job_parts
WHERE unit_cost IS NULL AND product_id IS NULL;

-- ---------------------------------------------------------------------
-- STEP 2 — Backfill UPDATE (RUN MANUALLY, INSIDE A TRANSACTION)
--
-- Procedure:
--   1. Run STEP 1 first. Confirm the count from `rows_to_backfill`
--      matches your expectation. Eyeball the 20-row sample.
--   2. Take a fresh backup of the job_parts table (or full DB dump).
--   3. Open a psql session and paste the BEGIN/UPDATE/SELECT/COMMIT
--      block below. Inspect the row count returned by the UPDATE.
--   4. If the count matches the preview, run COMMIT. Otherwise ROLLBACK.
-- ---------------------------------------------------------------------

-- BEGIN;
--
-- -- Apply the backfill
-- UPDATE job_parts AS jp
-- SET
--   unit_cost  = i.cost,
--   updated_at = NOW()
-- FROM items AS i
-- WHERE jp.product_id = i.id
--   AND jp.unit_cost IS NULL
--   AND jp.product_id IS NOT NULL
--   AND i.cost IS NOT NULL;
--
-- -- Verify: this should return 0 (no eligible rows left to backfill)
-- SELECT COUNT(*)::int AS remaining_eligible_rows
-- FROM job_parts jp
-- JOIN items i ON i.id = jp.product_id
-- WHERE jp.unit_cost IS NULL
--   AND jp.product_id IS NOT NULL
--   AND i.cost IS NOT NULL;
--
-- -- If `remaining_eligible_rows` is 0 and the UPDATE row count matched
-- -- the STEP 1 preview, COMMIT. Otherwise ROLLBACK and investigate.
-- COMMIT;

-- ---------------------------------------------------------------------
-- ROLLBACK PROCEDURE (per-row, after COMMIT)
-- ---------------------------------------------------------------------
-- UPDATE job_parts
-- SET unit_cost = NULL, updated_at = NOW()
-- WHERE id = '<offending-row-id>';
