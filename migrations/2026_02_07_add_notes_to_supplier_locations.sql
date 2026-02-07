-- Migration: Add notes column to supplier_locations
-- Purpose: Support per-location notes (account numbers, branch-specific info, etc.)
-- Run: psql "$DATABASE_URL" -f migrations/2026_02_07_add_notes_to_supplier_locations.sql

ALTER TABLE supplier_locations ADD COLUMN IF NOT EXISTS notes text;
