-- Add item_categories table for named, persistent product/service categories.
-- Run: npm run db:migrate:one -- migrations/2026_05_10_add_item_categories.sql
--
-- Categories are per-company named labels. The items.category text column
-- remains the FK-free authoritative field on each item; this table is the
-- catalog / registry that enables Add / Rename / Delete from the UI without
-- needing to derive categories purely from item data.
--
-- A functional unique index on lower(name) enforces case-insensitive
-- uniqueness per company. "Uncategorized" is NOT a row — it is derived
-- at read time from items with a null category value.

CREATE TABLE IF NOT EXISTS item_categories (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS item_categories_company_name_idx
  ON item_categories (company_id, lower(name));

CREATE INDEX IF NOT EXISTS item_categories_company_id_idx
  ON item_categories (company_id);
