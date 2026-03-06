-- Equipment Catalog Items — reference associations between equipment and catalog items
-- Run: npm run db:migrate:one -- migrations/2026_03_06_equipment_catalog_items.sql

CREATE TABLE IF NOT EXISTS equipment_catalog_items (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  equipment_id VARCHAR NOT NULL REFERENCES location_equipment(id) ON DELETE CASCADE,
  catalog_item_id VARCHAR NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP
);

-- Prevent duplicate associations
ALTER TABLE equipment_catalog_items
  ADD CONSTRAINT equipment_catalog_items_unique
  UNIQUE (company_id, equipment_id, catalog_item_id);

-- Fast lookup by equipment (primary query path)
CREATE INDEX equipment_catalog_items_equip_idx
  ON equipment_catalog_items (company_id, equipment_id, sort_order);

-- Reverse lookup: find all equipment using a specific catalog item
CREATE INDEX equipment_catalog_items_item_idx
  ON equipment_catalog_items (company_id, catalog_item_id);
