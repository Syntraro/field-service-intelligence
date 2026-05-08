-- =====================================================================
-- Migration: 2026-05-08 — Inventory module foundation
-- =====================================================================
-- First implementation pass for the optional, capability-gated Inventory
-- module. Adds three new tables (inventory_locations,
-- inventory_quantities, inventory_transactions), one new column on
-- items (model), one new feature key in the canonical
-- subscription_features catalog (inventory_core), and two new rows in
-- the permissions catalog (inventory.view + inventory.manage).
--
-- Why
-- ---
-- Items + pricebook already work without inventory tracking — the
-- existing items.track_inventory boolean has been on the schema since
-- 2026-03-17 but had no consuming surface. This migration is the layer
-- that activates inventory: locations to put stock at, quantities per
-- (item, location), and a transaction log so quantity mutations always
-- happen via a recorded movement (transfer / adjustment / count
-- correction / etc.). Core items / pricebook / quotes / invoices /
-- jobs continue to work when inventory_core is disabled.
--
-- Architecture invariants
-- -----------------------
-- 1. Inventory data is an EXTENSION layer. The items table stays
--    canonical. inventory_quantities references items via FK; deleting
--    an item cascades the quantity rows (the inventory layer should
--    never resurrect a deleted item).
-- 2. Quantity mutations always go through inventory_transactions.
--    Direct UPDATE on inventory_quantities.on_hand_quantity is reserved
--    for the storage layer, which always inserts the matching
--    transaction in the same tx. The transactionType enum captures
--    why the quantity moved.
-- 3. Tenant scoping: every inventory table carries company_id with
--    ON DELETE CASCADE so deleting a tenant cascades cleanly.
-- 4. Feature gate: backend routes are gated by
--    requireFeature("inventory_core") which reads through
--    entitlementService — this migration just registers the catalog
--    row. Tenants enable it via tenant_feature_overrides or a
--    plan_feature link separately.
--
-- Idempotent: every CREATE / ALTER / INSERT uses IF NOT EXISTS or
-- ON CONFLICT DO NOTHING so a re-run is a no-op.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. items.model column
-- ---------------------------------------------------------------------
-- The items table already has `sku`. Inventory items in HVAC/R commonly
-- carry a separate manufacturer model number (e.g. "TPS300", "GE-7012")
-- that is distinct from the internal SKU. Optional; nullable.
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS model text;

-- ---------------------------------------------------------------------
-- 2. inventory_locations
-- ---------------------------------------------------------------------
-- Physical or logical storage locations (warehouse / vehicle / office /
-- storage / temporary / other). Address fields are inlined matching the
-- canonical pattern on client_locations (no separate addresses table
-- exists today). assignedUserId optional for vehicle-style locations
-- (truck stock).
CREATE TABLE IF NOT EXISTS inventory_locations (
  id              varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      varchar NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            text NOT NULL,
  type            text NOT NULL,            -- warehouse | vehicle | office | storage | temporary | other
  is_active       boolean NOT NULL DEFAULT true,
  assigned_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  -- Inlined address fields (mirrors client_locations canonical shape)
  address         text,
  address2        text,
  city            text,
  province_state  text,
  postal_code     text,
  country         text,
  -- Notes (free text)
  notes           text,
  created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      timestamp
);

CREATE INDEX IF NOT EXISTS inventory_locations_company_idx
  ON inventory_locations(company_id);
CREATE INDEX IF NOT EXISTS inventory_locations_company_active_idx
  ON inventory_locations(company_id, is_active);

-- ---------------------------------------------------------------------
-- 3. inventory_quantities
-- ---------------------------------------------------------------------
-- Per-(item, location) on-hand + reserved quantities. One row per
-- combination; created lazily on first transaction at that location.
-- Available is DERIVED at read time as on_hand - reserved (NEVER stored
-- — single source of truth is on_hand and reserved).
CREATE TABLE IF NOT EXISTS inventory_quantities (
  id                  varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          varchar NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  item_id             varchar NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  location_id         varchar NOT NULL REFERENCES inventory_locations(id) ON DELETE CASCADE,
  on_hand_quantity    numeric(14, 4) NOT NULL DEFAULT 0,
  reserved_quantity   numeric(14, 4) NOT NULL DEFAULT 0,
  -- Reorder thresholds (per-location). Optional.
  minimum_quantity    numeric(14, 4),
  reorder_point       numeric(14, 4),
  updated_at          timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inventory_quantities_item_location_uniq
    UNIQUE (item_id, location_id),
  -- Quantity sanity: on_hand and reserved both >= 0. The application
  -- layer is the authoritative validator (can return a structured 400
  -- with message), but the DB enforces a hard floor so a buggy writer
  -- can't park negative stock in the row.
  CONSTRAINT inventory_quantities_on_hand_nonneg
    CHECK (on_hand_quantity >= 0),
  CONSTRAINT inventory_quantities_reserved_nonneg
    CHECK (reserved_quantity >= 0)
);

CREATE INDEX IF NOT EXISTS inventory_quantities_company_idx
  ON inventory_quantities(company_id);
CREATE INDEX IF NOT EXISTS inventory_quantities_item_idx
  ON inventory_quantities(company_id, item_id);
CREATE INDEX IF NOT EXISTS inventory_quantities_location_idx
  ON inventory_quantities(company_id, location_id);
-- Low-stock queries: surfaces (item, location) rows where on_hand <=
-- reorder_point. The partial index makes the read cheap.
CREATE INDEX IF NOT EXISTS inventory_quantities_low_stock_idx
  ON inventory_quantities(company_id, item_id, location_id)
  WHERE reorder_point IS NOT NULL;

-- ---------------------------------------------------------------------
-- 4. inventory_transactions
-- ---------------------------------------------------------------------
-- Audit log for every quantity movement. Every change to
-- inventory_quantities MUST be paired with a row here. The transaction
-- type captures intent.
--
-- Movement direction:
--   - from_location_id NULL + to_location_id SET   → stock IN  (initial / receive / count up)
--   - from_location_id SET  + to_location_id NULL  → stock OUT (consumption / count down / write-off)
--   - from_location_id SET  + to_location_id SET   → transfer between locations
-- Adjustments use one of the IN / OUT shapes with transactionType =
-- 'adjustment' or 'count_correction'.
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id                varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        varchar NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  item_id           varchar NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  from_location_id  varchar REFERENCES inventory_locations(id) ON DELETE SET NULL,
  to_location_id    varchar REFERENCES inventory_locations(id) ON DELETE SET NULL,
  quantity          numeric(14, 4) NOT NULL,
  transaction_type  text NOT NULL,    -- initial | transfer | adjustment | job_consumption | return | count_correction
  reference_type    text,             -- e.g. 'job', 'invoice', 'count' (free-form, app validates)
  reference_id      varchar,          -- FK is intentionally NOT enforced — references span tables
  unit_cost         numeric(12, 2),   -- Snapshot at movement time (optional)
  notes             text,
  created_by        varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Direction sanity: at least one of from / to must be set.
  CONSTRAINT inventory_transactions_direction
    CHECK (from_location_id IS NOT NULL OR to_location_id IS NOT NULL),
  -- Quantity is always positive — direction is encoded by from/to,
  -- not by sign.
  CONSTRAINT inventory_transactions_quantity_positive
    CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS inventory_transactions_company_idx
  ON inventory_transactions(company_id);
CREATE INDEX IF NOT EXISTS inventory_transactions_item_recent_idx
  ON inventory_transactions(company_id, item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_transactions_location_recent_idx
  ON inventory_transactions(company_id, from_location_id, to_location_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 5. Register the inventory_core feature key
-- ---------------------------------------------------------------------
-- Adds the canonical feature row in subscription_features. Tenants
-- enable it per-company via tenant_feature_overrides OR by being
-- assigned a plan that links the feature via subscription_plan_features.
-- The migration intentionally does NOT auto-enable for any tenant —
-- enabling is a separate product/operations decision.
INSERT INTO subscription_features (
  feature_key,
  display_name,
  description,
  category,
  limit_type,
  is_core,
  active,
  metadata
) VALUES (
  'inventory_core',
  'Inventory Management',
  'Track items, stock levels, and locations. Item transfers, adjustments, low-stock alerts.',
  -- featureCategoryEnum ⊆ {core, users_team, technician_app, service_hvac,
  -- sales_revenue, integrations, reporting, communication, scale_advanced}.
  -- Inventory is HVAC operational tooling — service_hvac is the closest
  -- semantic fit and matches how PM contracts / equipment / scheduling
  -- features are categorized.
  'service_hvac',
  -- limit_type='none' = on/off feature, no count cap. (boolean limit-type
  -- is not in featureLimitTypeEnum; "none" is the canonical on/off form.)
  'none',
  false,
  true,
  '{}'::jsonb
)
ON CONFLICT (feature_key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 6. Register the inventory.view + inventory.manage permission rows
-- ---------------------------------------------------------------------
-- Two rows in the canonical permissions table so the requirePermission
-- middleware can gate routes. inventory.view = read access (lists /
-- detail rail / quantities / transactions). inventory.manage = write
-- access (create item, create location, transfer, adjustment).
-- The permissions table column is `group` (not group_key) and there is
-- no `sort_order`. The `group` column is `text` (no DB-level enum); the
-- TypeScript permissionGroupEnum lists schedule/jobs/clients/pricing/
-- billing/timesheets/reports/admin — we add `inventory` here as a new
-- group string and extend the TS enum in shared/schema.ts.
INSERT INTO permissions (key, "group", label, description)
VALUES
  ('inventory.view',
   'inventory',
   'View Inventory',
   'View items, locations, stock levels, and inventory transactions.'),
  ('inventory.manage',
   'inventory',
   'Manage Inventory',
   'Create / edit items + locations, perform stock transfers and adjustments.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 7. Grant the new permissions to the canonical management roles
-- ---------------------------------------------------------------------
-- owner / admin / manager get inventory.view + inventory.manage.
-- dispatcher gets inventory.view only (read access for triage).
-- Idempotent via ON CONFLICT — re-running drops nothing.
-- The roles table identifier column is `name` (not role_key).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('owner', 'admin', 'manager')
  AND p.key IN ('inventory.view', 'inventory.manage')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'dispatcher'
  AND p.key = 'inventory.view'
ON CONFLICT DO NOTHING;

COMMIT;
