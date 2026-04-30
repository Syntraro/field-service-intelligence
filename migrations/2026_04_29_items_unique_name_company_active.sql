-- 2026-04-29 Catalog hardening v2 — TYPE-AGNOSTIC, company-scoped,
-- case-insensitive uniqueness on `items` (the canonical product/service
-- catalog).
--
-- Background:
--   The 2026_04_19 migration added a TYPE-SCOPED unique index on
--   (company_id, type, lower(name)). The product UX requirement was
--   tightened on 2026-04-29 to disallow cross-type duplicates as well —
--   a Product "Thermostat" and a Service "Thermostat" must not coexist.
--   This migration drops the type-scoped index and replaces it with a
--   type-agnostic one. The matching `ItemRepository.createOrGet` helper
--   landed in the same release; this index is the safety net.
--
-- Natural key (new):
--   (company_id, lower(name)) — regardless of type.
--
-- Scope:
--   `WHERE deleted_at IS NULL AND is_active = true` — soft-archived rows
--   keep their names (history is preserved) and don't block creation.
--   `createOrGet` reactivates a soft-deleted match rather than producing
--   a duplicate, so the partial scope is consistent with the helper.
--
-- Live duplicate scan:
--   Per the 2026_04_19 migration audit, zero cross-type duplicates were
--   reported. If a future environment fails this migration, run the
--   detection query below first and consolidate before re-applying:
--
--     SELECT company_id, lower(name) AS name_lower, count(*),
--            array_agg(id) AS ids,
--            array_agg(type) AS types
--     FROM items
--     WHERE deleted_at IS NULL AND is_active = true
--     GROUP BY company_id, lower(name)
--     HAVING count(*) > 1;
--
-- Run via: npm run db:migrate (uses CONCURRENTLY → migration runner
-- dispatches statements outside the implicit transaction block).

DROP INDEX CONCURRENTLY IF EXISTS items_company_type_name_lower_active_uq;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS items_company_name_lower_active_uq
  ON items (company_id, lower(name))
  WHERE deleted_at IS NULL AND is_active = true;
