-- 2026-04-10: Add account_number and notes columns to suppliers table.
-- Supports the enhanced create-supplier modal which collects more than just name.

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS account_number text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notes text;
