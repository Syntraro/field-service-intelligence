-- ============================================================================
-- 2026-05-04 — tenant_deletion_requests.execution_started_at + stale index.
--
-- WHY:
--   F2 finding from the validation sweep: a worker killed AFTER it transitioned
--   a request to `executing` but BEFORE the cascade completed leaves the row
--   stuck. There is no other timestamp on the row that records "when did this
--   row enter the executing state" — `executed_at` is set on completion only,
--   `approved_at` is too early. The stale-executing reaper needs an explicit
--   anchor so it can identify rows older than STALE_EXECUTING_AFTER_MS without
--   ambiguity.
--
-- DESIGN:
--   • New column `execution_started_at timestamptz` — set ATOMICALLY by
--     `transitionToExecuting` at the same time `status='executing'` is written.
--   • Partial index on (execution_started_at) WHERE status='executing' so the
--     reaper's predicate `status='executing' AND execution_started_at < cutoff`
--     is index-served and never scans terminal rows.
--   • Backfill: existing rows where status='executing' (none expected — Phase
--     1 just shipped, no history) get `execution_started_at = now()` so the
--     reaper does not mark a fresh executing row from a concurrent deploy as
--     stale on the first sweep. Safer than NULL — NULL would never trip the
--     `<` predicate, leaving truly-stale rows invisible if they predate this
--     column.
--
-- SAFETY:
--   • `ADD COLUMN IF NOT EXISTS` — re-runs are no-ops.
--   • `CREATE INDEX IF NOT EXISTS` — same.
--   • The backfill UPDATE is bounded by `status='executing'` and a NULL guard,
--     so re-runs after a fresh deploy don't overwrite real values.
--   • Reversible: `ALTER TABLE … DROP COLUMN execution_started_at` is safe at
--     any time; the reaper would simply degrade to "use approved_at + delay
--     as a proxy" or be disabled.
--
-- HOW TO RUN:
--   npm run db:migrate:one -- migrations/2026_05_04_tenant_deletion_requests_execution_started_at.sql
-- ============================================================================

BEGIN;

ALTER TABLE "tenant_deletion_requests"
  ADD COLUMN IF NOT EXISTS "execution_started_at" timestamptz;

-- Backfill any pre-existing executing rows so they aren't immediately
-- flagged stale by the next reaper sweep.
UPDATE "tenant_deletion_requests"
   SET "execution_started_at" = now()
 WHERE "status" = 'executing'
   AND "execution_started_at" IS NULL;

-- Partial index for the reaper's hot path.
CREATE INDEX IF NOT EXISTS "tenant_deletion_requests_stale_executing_idx"
  ON "tenant_deletion_requests" ("execution_started_at")
  WHERE "status" = 'executing';

COMMIT;
