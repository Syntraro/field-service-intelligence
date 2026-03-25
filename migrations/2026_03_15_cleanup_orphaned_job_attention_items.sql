-- Migration: Cleanup orphaned job attention items
-- Date: 2026-03-15
-- Purpose: Delete attention_items rows where entity_type = 'job' but the
--          referenced entity_id no longer exists in the jobs table.
--          These orphans were left behind by a bug that has since been fixed.
--          Only job attention items are affected; non-job rows are untouched.
--
-- Run: npm run db:migrate:one -- migrations/2026_03_15_cleanup_orphaned_job_attention_items.sql
--
-- IMPORTANT: This is a one-time data repair. The runtime fix that prevents
-- new orphans has already been deployed.

-- Step 1: Preview orphaned rows (run this SELECT first to verify)
-- SELECT ai.id, ai.entity_type, ai.entity_id, ai.rule_type, ai.status, ai.tenant_id
-- FROM attention_items ai
-- WHERE ai.entity_type = 'job'
--   AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.id = ai.entity_id);

-- Step 2: Delete orphaned job attention items
DELETE FROM attention_items ai
WHERE ai.entity_type = 'job'
  AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.id = ai.entity_id);

-- Step 3: Verify no orphans remain (should return 0 rows)
-- SELECT COUNT(*)
-- FROM attention_items ai
-- WHERE ai.entity_type = 'job'
--   AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.id = ai.entity_id);
