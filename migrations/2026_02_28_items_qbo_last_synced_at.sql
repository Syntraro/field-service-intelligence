-- Add qboLastSyncedAt timestamp to items table for catalog sync tracking
-- Run: psql "$DATABASE_URL" -f migrations/2026_02_28_items_qbo_last_synced_at.sql

ALTER TABLE items ADD COLUMN IF NOT EXISTS qbo_last_synced_at TIMESTAMP;
