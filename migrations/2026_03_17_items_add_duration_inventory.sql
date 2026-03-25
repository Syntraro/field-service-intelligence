-- Migration: Add estimated_duration_minutes and track_inventory to items table
-- Purpose: Support Products & Services CSV import with future-proofing fields
-- Run: npm run db:migrate:one -- migrations/2026_03_17_items_add_duration_inventory.sql

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS estimated_duration_minutes integer,
  ADD COLUMN IF NOT EXISTS track_inventory boolean NOT NULL DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN items.estimated_duration_minutes IS 'Estimated service duration in minutes (nullable, for services)';
COMMENT ON COLUMN items.track_inventory IS 'Whether to track inventory for this item (default false, future use)';
