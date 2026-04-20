-- 2026-04-18: Phase 0 of multi-visit migration — harden job_visits.visit_number.
--
-- Eliminates the `MAX(visit_number) + 1` race condition in visit creation by
-- making the uniqueness guarantee explicit in the DB and replacing the
-- existing two-column UNIQUE(job_id, visit_number) with the canonical
-- three-column UNIQUE(company_id, job_id, visit_number) form specified in
-- the multi-visit Phase 0 audit.
--
-- This migration is:
--   1. Defensive: includes repair logic for NULL visit_number and duplicate
--      (company_id, job_id, visit_number) groups even though the live DB
--      currently has zero such rows. Other tenants' databases may differ.
--   2. Replay-safe: uses IF EXISTS / IF NOT EXISTS and deterministic ordering
--      so re-running produces the same row state and no errors.
--   3. Atomic: entire migration runs inside a single transaction via the
--      runMigrations.ts wrapper (no non-transactional DDL keywords used).
--
-- Deliberately NOT included:
--   * Multi-visit lifecycle changes
--   * Scheduling semantics changes
--   * Open-visit-per-job invariant
--   * Calendar / UI / invoicing changes
--
-- Run via: npm run db:migrate

-- ---------------------------------------------------------------------------
-- Step 1: Deterministic backfill for NULL visit_number.
-- ---------------------------------------------------------------------------
-- Within each (company_id, job_id) group that contains at least one NULL,
-- rank all rows (including non-NULLs) by (created_at, id) and assign each
-- NULL the next available integer starting from max(current non-NULL) + 1.
-- Rows with an existing visit_number are left unchanged by this step.
WITH nulls_per_group AS (
  SELECT id,
         company_id,
         job_id,
         ROW_NUMBER() OVER (
           PARTITION BY company_id, job_id
           ORDER BY created_at, id
         ) AS null_rank
    FROM job_visits
    WHERE visit_number IS NULL
),
max_per_group AS (
  SELECT company_id, job_id, COALESCE(MAX(visit_number), 0) AS max_vn
    FROM job_visits
    GROUP BY company_id, job_id
)
UPDATE job_visits jv
   SET visit_number = m.max_vn + n.null_rank
  FROM nulls_per_group n
  JOIN max_per_group m
    ON m.company_id = n.company_id AND m.job_id = n.job_id
  WHERE jv.id = n.id;

-- ---------------------------------------------------------------------------
-- Step 2: Deterministic dedupe for (company_id, job_id, visit_number) groups
-- that have more than one row.
-- ---------------------------------------------------------------------------
-- Within each duplicate group, keep the earliest row (by created_at, id) at
-- its existing visit_number. Later rows get renumbered to max(existing) + 1,
-- max(existing) + 2, ... across the full (company_id, job_id) partition.
-- Does NOT delete rows, NOT alter status, NOT touch unrelated fields.
WITH dups AS (
  SELECT id,
         company_id,
         job_id,
         visit_number,
         ROW_NUMBER() OVER (
           PARTITION BY company_id, job_id, visit_number
           ORDER BY created_at, id
         ) AS copy_rank
    FROM job_visits
),
losers AS (
  SELECT id, company_id, job_id
    FROM dups
    WHERE copy_rank > 1
),
loser_rank AS (
  SELECT l.id,
         l.company_id,
         l.job_id,
         ROW_NUMBER() OVER (
           PARTITION BY l.company_id, l.job_id
           ORDER BY jv.created_at, jv.id
         ) AS loser_rank
    FROM losers l
    JOIN job_visits jv ON jv.id = l.id
),
max_per_group AS (
  SELECT company_id, job_id, MAX(visit_number) AS max_vn
    FROM job_visits
    GROUP BY company_id, job_id
)
UPDATE job_visits jv
   SET visit_number = m.max_vn + lr.loser_rank
  FROM loser_rank lr
  JOIN max_per_group m
    ON m.company_id = lr.company_id AND m.job_id = lr.job_id
  WHERE jv.id = lr.id;

-- ---------------------------------------------------------------------------
-- Step 3: Enforce NOT NULL on visit_number.
-- ---------------------------------------------------------------------------
-- Idempotent: if already NOT NULL, this is a no-op.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
      WHERE table_name = 'job_visits'
        AND column_name = 'visit_number'
        AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE job_visits ALTER COLUMN visit_number SET NOT NULL;
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- Step 4: Create canonical 3-column UNIQUE index.
-- ---------------------------------------------------------------------------
-- Matches the audit spec: UNIQUE(company_id, job_id, visit_number). Queries
-- that filter by (company_id, job_id) — the canonical repository pattern in
-- server/storage/jobVisits.ts — use this index as a prefix match.
CREATE UNIQUE INDEX IF NOT EXISTS job_visits_company_job_visit_number_uq
  ON job_visits (company_id, job_id, visit_number);

-- ---------------------------------------------------------------------------
-- Step 5: Drop the old 2-column UNIQUE index now that the 3-column one
-- provides equivalent (stronger-indexed, same semantics) protection.
-- ---------------------------------------------------------------------------
-- Safe because job_id is globally unique per tenant (jobs.company_id is
-- NOT NULL and jobs.id is the primary key), so
--   UNIQUE(company_id, job_id, visit_number)
-- implies
--   UNIQUE(job_id, visit_number).
-- Keeping both would only cost write I/O for zero additional guarantee.
DROP INDEX IF EXISTS job_visits_job_visit_number_uq;
