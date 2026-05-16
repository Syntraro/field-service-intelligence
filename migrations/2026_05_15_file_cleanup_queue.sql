-- Run: npm run db:migrate:one -- migrations/2026_05_15_file_cleanup_queue.sql
--
-- Durable queue for post-delete R2 object cleanup.
-- Rows are inserted inside the delete transaction; a background worker
-- processes them asynchronously so R2 errors don't roll back the delete.
--
-- Deduplication: the partial unique index on (company_id, bucket, storage_key)
-- prevents duplicate pending rows for the same R2 object within a tenant.
-- storage_key already embeds tenants/{companyId}/ so cross-tenant collisions
-- are impossible in practice, but the company_id column makes the tenant
-- boundary explicit and matches the multi-tenancy invariant everywhere else.

CREATE TABLE IF NOT EXISTS file_cleanup_queue (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      varchar       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  file_id         varchar       NOT NULL,  -- no FK — files row may be gone
  bucket          varchar       NOT NULL,
  storage_key     varchar       NOT NULL,
  storage_provider varchar      NOT NULL DEFAULT 'r2',
  source_ref      varchar       NOT NULL,  -- e.g. 'client_delete:<customerCompanyId>'
  created_at      timestamptz   NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  failed_at       timestamptz,
  attempt_count   integer       NOT NULL DEFAULT 0,
  last_error      text
);

-- Pending sweep index (narrow — only unprocessed rows).
CREATE INDEX IF NOT EXISTS file_cleanup_queue_pending_idx
  ON file_cleanup_queue (created_at)
  WHERE processed_at IS NULL AND failed_at IS NULL;

-- Per-tenant pending index for observability queries.
CREATE INDEX IF NOT EXISTS file_cleanup_queue_company_idx
  ON file_cleanup_queue (company_id, created_at)
  WHERE processed_at IS NULL;

-- Deduplication: at most one pending row per (company_id, bucket, storage_key).
CREATE UNIQUE INDEX IF NOT EXISTS file_cleanup_queue_dedupe_pending_idx
  ON file_cleanup_queue (company_id, bucket, storage_key)
  WHERE processed_at IS NULL AND failed_at IS NULL;
