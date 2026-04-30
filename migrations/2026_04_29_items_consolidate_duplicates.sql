-- 2026-04-29 — One-time consolidation of pre-existing case-insensitive
-- duplicate item names that block the type-agnostic unique index in
-- 2026_04_29_items_unique_name_company_active.sql.
--
-- Strategy:
--   For each (company_id, lower(name)) group with > 1 active row, KEEP
--   the one with the LATEST createdAt (most recently created — usually
--   the one users have been interacting with) and soft-archive the
--   rest. Soft-archived rows keep their qboItemId / sync state so a
--   later QBO reconciliation can repair links if needed.
--
-- Detection (idempotent — run again after to confirm zero duplicates):
--
--   SELECT company_id, lower(name) AS name_lower, count(*) AS cnt,
--          array_agg(id ORDER BY created_at DESC) AS ids,
--          array_agg(type ORDER BY created_at DESC) AS types,
--          array_agg(name ORDER BY created_at DESC) AS names
--     FROM items
--    WHERE deleted_at IS NULL AND is_active = true
--    GROUP BY company_id, lower(name)
--   HAVING count(*) > 1;
--
-- Why "latest createdAt wins":
--   In the dev environment, duplicates appeared because the
--   pre-2026-04-29 createOrGet was type-scoped — repeated tests created
--   alternating Product / Service rows with the same name. The latest
--   row reflects the most recent user action; older entries were
--   superseded.
--
-- This is a ONE-TIME consolidation. After it runs the type-agnostic
-- unique index can be applied without conflict.

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY company_id, lower(name)
           ORDER BY created_at DESC, id
         ) AS rank_in_group
    FROM items
   WHERE deleted_at IS NULL AND is_active = true
),
losers AS (
  SELECT id FROM ranked WHERE rank_in_group > 1
)
UPDATE items
   SET is_active = false,
       deleted_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP
 WHERE id IN (SELECT id FROM losers);
