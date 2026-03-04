-- Phase 1: Google Places Autocomplete — add geocoding columns
-- Run: psql "$DATABASE_URL" -f migrations/2026_03_04_google_places_geocoding_columns.sql
-- Safe to re-run (IF NOT EXISTS on all columns).
-- No transaction wrapping required.

-- client_locations: add country, lat, lng, place_id
ALTER TABLE client_locations ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE client_locations ADD COLUMN IF NOT EXISTS lat numeric(10, 7);
ALTER TABLE client_locations ADD COLUMN IF NOT EXISTS lng numeric(10, 7);
ALTER TABLE client_locations ADD COLUMN IF NOT EXISTS place_id text;

-- supplier_locations: add lat, lng, place_id (country already exists)
ALTER TABLE supplier_locations ADD COLUMN IF NOT EXISTS lat numeric(10, 7);
ALTER TABLE supplier_locations ADD COLUMN IF NOT EXISTS lng numeric(10, 7);
ALTER TABLE supplier_locations ADD COLUMN IF NOT EXISTS place_id text;
