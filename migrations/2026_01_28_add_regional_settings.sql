-- Migration: Add regional display preferences to company_settings
-- Run: psql "$DATABASE_URL" -f migrations/2026_01_28_add_regional_settings.sql

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS date_format TEXT NOT NULL DEFAULT 'MM/DD/YYYY',
  ADD COLUMN IF NOT EXISTS time_format TEXT NOT NULL DEFAULT '12h',
  ADD COLUMN IF NOT EXISTS week_starts_on TEXT NOT NULL DEFAULT 'monday';
