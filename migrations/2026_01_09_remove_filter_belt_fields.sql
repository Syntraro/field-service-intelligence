-- Migration: Remove filter/belt fields from items table
-- Date: 2026-01-09
-- Description: Remove preventative maintenance specific fields (filter_type, belt_type, size)
--              as the app is transitioning to a full-service dispatch system

-- Drop the columns (IF EXISTS to make this migration idempotent)
ALTER TABLE items DROP COLUMN IF EXISTS filter_type;
ALTER TABLE items DROP COLUMN IF EXISTS belt_type;
ALTER TABLE items DROP COLUMN IF EXISTS size;

-- Verify columns are removed (informational query - will show remaining columns)
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_name = 'items'
-- ORDER BY ordinal_position;
