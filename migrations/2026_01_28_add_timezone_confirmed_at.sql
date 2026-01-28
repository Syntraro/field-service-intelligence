-- Migration: Add timezone_confirmed_at to company_settings for onboarding gate
-- Null means timezone was never explicitly confirmed by the tenant.
-- Run: psql "$DATABASE_URL" -f migrations/2026_01_28_add_timezone_confirmed_at.sql

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS timezone_confirmed_at TIMESTAMP;
