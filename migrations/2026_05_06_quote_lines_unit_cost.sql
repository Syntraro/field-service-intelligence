-- =====================================================================
-- Migration: 2026-05-06 — quote_lines.unit_cost
-- =====================================================================
-- Adds a per-line cost basis column to `quote_lines` so saved quotes
-- preserve unit cost across reload, matching the existing column
-- naming convention on `invoice_lines.unit_cost` and
-- `job_parts.unit_cost` (both `numeric(12, 2)`, nullable).
--
-- Why
-- ---
-- The shared <LineItemsCard> renders a Profit / Profit Margin tile
-- cluster on every consuming surface (Quote, Invoice, Job). The hook
-- `useLineItemsDrafts.headerMetrics` reads `unitCost` off each line
-- to compute Profit. On Invoice + Job the column is persisted, so
-- saved values survive reload. On Quote, the column did not exist —
-- the canonical line-item input schema already carries `unitCost`,
-- the client mapper already sends it, but Drizzle's typed insert
-- silently dropped the field at the DB boundary, so a saved quote
-- always read back with cost = 0 and reported 100 % margin even when
-- the user picked a product with a real cost during creation.
--
-- This migration closes the persistence gap. Existing rows are left
-- with NULL (treated as 0 by the header math, same fallback the
-- canonical hook already applies). New rows persist whatever the
-- create / update / template-apply paths send.
--
-- Run with
-- --------
--   npm run db:migrate:one -- migrations/2026_05_06_quote_lines_unit_cost.sql
--
-- Idempotent — safe to re-run; the IF NOT EXISTS guard skips the
-- column add if it's already present.
-- =====================================================================

ALTER TABLE quote_lines
  ADD COLUMN IF NOT EXISTS unit_cost numeric(12, 2);

-- Lightweight comment for future operators inspecting the schema.
COMMENT ON COLUMN quote_lines.unit_cost IS
  'Cost per unit for profit margin calc — mirrors invoice_lines.unit_cost / job_parts.unit_cost.';
