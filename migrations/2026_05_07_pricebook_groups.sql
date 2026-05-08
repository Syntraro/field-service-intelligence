-- =====================================================================
-- Migration: 2026-05-07 — pricebook_groups + pricebook_group_items
-- =====================================================================
-- Adds Pricebook Groups: saved bundles of pricebook items that expand
-- into N line items when added to a job / quote / invoice via the
-- Pricebook Picker. Examples: "Service Call" (Labor + Truck Charge +
-- Parking), "Maintenance Visit" (Labor + Truck Charge + Travel Charge
-- + Disposal Fee).
--
-- Why
-- ---
-- The picker today supports bulk-adding individual items only. Tenants
-- repeat the same combinations on most invoices. Groups let them save
-- a bundle once and add it with one click; the bundle expands into its
-- child line items at submit time via the canonical line-item mapper.
--
-- Schema
-- ------
--   pricebook_groups
--     id            VARCHAR PRIMARY KEY (gen_random_uuid())
--     company_id    VARCHAR NOT NULL FK companies(id) ON DELETE CASCADE
--     user_id       VARCHAR NULLABLE FK users(id) ON DELETE SET NULL
--     name          TEXT    NOT NULL
--     description   TEXT
--     color         TEXT
--     icon          TEXT
--     is_active     BOOLEAN NOT NULL DEFAULT true
--     usage_count   INTEGER NOT NULL DEFAULT 0
--     created_at    TIMESTAMP NOT NULL DEFAULT NOW()
--     updated_at    TIMESTAMP
--
--   pricebook_group_items
--     id            VARCHAR PRIMARY KEY (gen_random_uuid())
--     company_id    VARCHAR NOT NULL FK companies(id) ON DELETE CASCADE
--     group_id      VARCHAR NOT NULL FK pricebook_groups(id) ON DELETE CASCADE
--     item_id       VARCHAR NOT NULL FK items(id) ON DELETE CASCADE
--     quantity      NUMERIC(12,2) NOT NULL DEFAULT '1'
--     sort_order    INTEGER NOT NULL DEFAULT 0
--     created_at    TIMESTAMP NOT NULL DEFAULT NOW()
--     updated_at    TIMESTAMP
--
-- Constraints
-- -----------
--   pricebook_groups_company_name_active_uq
--     UNIQUE (company_id, name) WHERE is_active = true
--     Prevents two active groups with the same name per tenant.
--     Soft-archived groups (is_active = false) are excluded so a tenant
--     can re-use a name after archiving.
--
--   pricebook_group_items_group_item_uq
--     UNIQUE (group_id, item_id)
--     Each (group, item) pair appears at most once. Re-adding the same
--     item bumps quantity instead of creating a duplicate row.
--
-- Indexes
-- -------
--   idx_pricebook_groups_lookup
--     (company_id, is_active, usage_count)
--     The picker rail read predicate. Sorting by usage_count DESC then
--     name ASC happens at the application layer; the index supports
--     the (tenant, active) filter and gives the planner a hot range to
--     start from.
--
--   idx_pricebook_group_items_group
--     (company_id, group_id, sort_order)
--     Read predicate for "list children of this group in display order."
--
-- Cascade behavior
-- ----------------
--   Deleting a tenant cascades to its groups + group items.
--   Deleting a group cascades to its group_items rows.
--   Deleting a pricebook item cascades to any group_items rows that
--   reference it — this avoids broken expansions in the picker.
--   Deleting an item DOES NOT delete the group itself; the group just
--   loses one child.
--
-- Run with
-- --------
--   npm run db:migrate:one -- migrations/2026_05_07_pricebook_groups.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS pricebook_groups (
  id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  name        TEXT    NOT NULL,
  description TEXT,
  color       TEXT,
  icon        TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS pricebook_groups_company_name_active_uq
  ON pricebook_groups (company_id, name)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_pricebook_groups_lookup
  ON pricebook_groups (company_id, is_active, usage_count);

CREATE TABLE IF NOT EXISTS pricebook_group_items (
  id         VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  group_id   VARCHAR NOT NULL REFERENCES pricebook_groups(id) ON DELETE CASCADE,
  item_id    VARCHAR NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  quantity   NUMERIC(12, 2) NOT NULL DEFAULT '1',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS pricebook_group_items_group_item_uq
  ON pricebook_group_items (group_id, item_id);

CREATE INDEX IF NOT EXISTS idx_pricebook_group_items_group
  ON pricebook_group_items (company_id, group_id, sort_order);
