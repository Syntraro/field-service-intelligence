-- =====================================================================
-- Migration: 2026-05-08 — Inventory line-item linkage (Phase 4)
-- =====================================================================
-- Phase 4 of the capability-gated Inventory module. Adds an OPTIONAL
-- linkage from a job_inventory_usage row back to the job_parts line
-- it fulfilled. The linkage is one-directional + nullable — the
-- linkage means "this consumption was triggered by, or fulfills,
-- that line item." It does NOT trigger reconciliation, automatic
-- billing, or inventory-from-quote auto-mutation. Those remain
-- explicit, deferred workflows.
--
-- Why this column lives on job_inventory_usage (not on jobParts)
-- ---------------------------------------------------------------
-- The audit confirmed all three line tables (jobParts, quoteLines,
-- invoiceLines) already use `productId` as the canonical catalog
-- link. There is NO inventory-specific column on those tables, and
-- adding one would couple the line-items module to the inventory
-- module needlessly.
--
-- Putting line_item_id on the consumption row instead means:
--   * Line tables stay untouched — no schema blast across three
--     modules.
--   * The linkage is many-to-one — one line can be partially
--     fulfilled by N consumption rows over time (multiple visits,
--     partial returns, etc.).
--   * Reconciliation logic (sum consumptions per line) lives inside
--     the consumption table, not scattered across line tables.
--   * The link can be NULL when consumption happens outside any
--     line context — the rail-driven Add Inventory flow stays
--     unchanged.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS
-- so a re-run is a no-op.
-- =====================================================================

BEGIN;

ALTER TABLE job_inventory_usage
  ADD COLUMN IF NOT EXISTS line_item_id varchar
    REFERENCES job_parts(id) ON DELETE SET NULL;

-- Per-line aggregate read (sum consumption / return per line) is the
-- main consumer of this column. The index keeps that aggregate cheap
-- and helps the "suggested lines" query that powers the consume-from-
-- line-item UX.
CREATE INDEX IF NOT EXISTS job_inventory_usage_line_idx
  ON job_inventory_usage(company_id, job_id, line_item_id)
  WHERE line_item_id IS NOT NULL AND deleted_at IS NULL;

COMMIT;
