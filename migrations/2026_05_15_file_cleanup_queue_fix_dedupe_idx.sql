-- Run: npm run db:migrate:one -- migrations/2026_05_15_file_cleanup_queue_fix_dedupe_idx.sql
--
-- The initial migration (2026_05_15_file_cleanup_queue.sql) was applied before
-- the deduplication index was updated to include company_id. This migration
-- replaces the two-column index (bucket, storage_key) with the canonical
-- three-column index (company_id, bucket, storage_key) that makes the tenant
-- boundary explicit.
--
-- The old index still prevents duplicates correctly (storage_key embeds the
-- tenant prefix), but we replace it for consistency with the multi-tenancy
-- invariant across the rest of the schema.

DROP INDEX IF EXISTS file_cleanup_queue_pending_storage_key_uq;

CREATE UNIQUE INDEX IF NOT EXISTS file_cleanup_queue_dedupe_pending_idx
  ON file_cleanup_queue (company_id, bucket, storage_key)
  WHERE processed_at IS NULL AND failed_at IS NULL;
