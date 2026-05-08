-- =====================================================================
-- Migration: 2026-05-08 — Inventory consumption + job inventory usage
-- =====================================================================
-- Phase 3 of the capability-gated Inventory module. Adds the
-- consumption + return workflow that lets a service business deduct
-- stock from a location onto a job (with snapshot unit cost), and
-- return unused stock back. All quantity movement still routes through
-- inventory_transactions (transaction-driven invariant preserved).
--
-- Why a new table
-- ---------------
-- inventory_transactions is the audit log: it records WHAT moved and
-- WHEN and WHERE. job_inventory_usage is the intent log: it records
-- the business decision "Job X used Y units of Item Z from Location L
-- on date D, costing $C/unit at that moment." The two layers are
-- distinct:
--
--   * Removing or returning a usage row should NOT erase the
--     inventory_transactions audit trail — every quantity movement
--     stays recorded.
--   * Job costing reads from job_inventory_usage (snapshot cost) so
--     later changes to items.cost do NOT retro-mutate historical job
--     totals.
--   * Per-job listing ("what did we use on this job?") is a single
--     query against job_inventory_usage, no audit-log scan.
--
-- Two-row return model
-- --------------------
-- Returns are NEW rows in job_inventory_usage with kind='return' and
-- a parent_usage_id pointing at the original consumption row. Every
-- row carries a positive quantity. Net cost on a job =
--   SUM(consumption.quantity * unit_cost_snapshot)
--   - SUM(return.quantity * unit_cost_snapshot)
-- This keeps each row immutable + auditable, lets us reconcile
-- partial returns, and never mutates a stored quantity after the
-- fact.
--
-- Idempotent: every CREATE / ALTER / INSERT uses IF NOT EXISTS or
-- ON CONFLICT DO NOTHING so a re-run is a no-op.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. job_inventory_usage table
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_inventory_usage (
  id                       varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               varchar NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id                   varchar NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  item_id                  varchar NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  location_id              varchar NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  -- Two-row return model: every row is a positive quantity, kind
  -- decides accounting direction.
  kind                     text NOT NULL,                                -- 'consumption' | 'return'
  parent_usage_id          varchar REFERENCES job_inventory_usage(id) ON DELETE RESTRICT,
  quantity                 numeric(14, 4) NOT NULL,
  unit_cost_snapshot       numeric(12, 2) NOT NULL,
  -- Author of the decision. Nullable so user-deletion doesn't cascade-
  -- nuke the row (we soft-clear the FK and keep the row intact).
  consumed_by_user_id      varchar REFERENCES users(id) ON DELETE SET NULL,
  notes                    text,
  -- Link back to the audit-log row written in the same Drizzle tx.
  -- ON DELETE SET NULL because we DO NOT cascade-delete the audit row
  -- if a future maintenance script ever deletes it.
  inventory_transaction_id varchar REFERENCES inventory_transactions(id) ON DELETE SET NULL,
  -- Soft-delete for "Remove Usage" (only allowed when no returns
  -- reference the row — see jobInventoryUsageRepository.removeUsage).
  deleted_at               timestamp,
  created_at               timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               timestamp,
  CONSTRAINT job_inventory_usage_kind_check
    CHECK (kind IN ('consumption', 'return')),
  CONSTRAINT job_inventory_usage_quantity_positive
    CHECK (quantity > 0),
  -- Returns must reference a parent consumption row; consumptions
  -- must NOT reference a parent. The DB-level check guarantees the
  -- two-row model can't be subverted by a buggy writer.
  CONSTRAINT job_inventory_usage_parent_shape
    CHECK (
      (kind = 'return' AND parent_usage_id IS NOT NULL)
      OR (kind = 'consumption' AND parent_usage_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS job_inventory_usage_company_idx
  ON job_inventory_usage(company_id);
CREATE INDEX IF NOT EXISTS job_inventory_usage_job_idx
  ON job_inventory_usage(company_id, job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS job_inventory_usage_item_recent_idx
  ON job_inventory_usage(company_id, item_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS job_inventory_usage_location_recent_idx
  ON job_inventory_usage(company_id, location_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS job_inventory_usage_parent_idx
  ON job_inventory_usage(parent_usage_id)
  WHERE parent_usage_id IS NOT NULL;

-- No catalog / permission inserts in this migration — consumption +
-- return reuse the existing inventory_core capability + inventory.manage
-- permission (see Phase 1 migration). job_consumption was already
-- registered as an inventoryTransactionTypeEnum value in Phase 1; the
-- new job_return value is added in the application layer (text column,
-- no DB-level enum check) so no DDL is needed for it.

COMMIT;
