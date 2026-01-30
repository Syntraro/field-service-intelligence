-- Migration: Add company_business_hours table for per-tenant business hours
-- Run: psql "$DATABASE_URL" -f migrations/2026_01_28_add_company_business_hours.sql
--
-- This creates a table to store company business hours with one row per weekday (7 rows per company).
-- Defaults are seeded for all existing companies.

-- ============================================================================
-- CREATE TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS company_business_hours (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
  company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL,  -- 0=Sunday, 1=Monday, ..., 6=Saturday
  is_open BOOLEAN NOT NULL DEFAULT true,
  start_minutes INT,  -- 0..1439 (minutes from midnight)
  end_minutes INT,    -- 1..1440 (minutes from midnight, 1440 = midnight next day)
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Ensure one row per company per day
  CONSTRAINT company_business_hours_company_day_unique UNIQUE(company_id, day_of_week),

  -- day_of_week must be 0-6
  CONSTRAINT company_business_hours_dow_check CHECK (day_of_week BETWEEN 0 AND 6),

  -- start_minutes valid range when not null
  CONSTRAINT company_business_hours_start_check CHECK (start_minutes IS NULL OR (start_minutes BETWEEN 0 AND 1439)),

  -- end_minutes valid range when not null
  CONSTRAINT company_business_hours_end_check CHECK (end_minutes IS NULL OR (end_minutes BETWEEN 1 AND 1440)),

  -- Closed days must have null times; open days must have valid times with end > start
  CONSTRAINT company_business_hours_open_times_check CHECK (
    (is_open = false AND start_minutes IS NULL AND end_minutes IS NULL)
    OR
    (is_open = true AND start_minutes IS NOT NULL AND end_minutes IS NOT NULL AND end_minutes > start_minutes)
  )
);

-- Index for efficient lookups by company
CREATE INDEX IF NOT EXISTS idx_company_business_hours_company_id ON company_business_hours(company_id);

-- ============================================================================
-- SEED DEFAULTS FOR EXISTING COMPANIES
-- ============================================================================
-- Default schedule:
--   Sunday (0): closed
--   Monday-Friday (1-5): open 06:00-16:30 (360-990 minutes)
--   Saturday (6): closed
--
-- Using INSERT ... SELECT with ON CONFLICT DO NOTHING for idempotency.

-- Sunday (0) - closed
INSERT INTO company_business_hours (company_id, day_of_week, is_open, start_minutes, end_minutes)
SELECT id, 0, false, NULL, NULL
FROM companies
ON CONFLICT (company_id, day_of_week) DO NOTHING;

-- Monday (1) - open 06:00-16:30
INSERT INTO company_business_hours (company_id, day_of_week, is_open, start_minutes, end_minutes)
SELECT id, 1, true, 360, 990
FROM companies
ON CONFLICT (company_id, day_of_week) DO NOTHING;

-- Tuesday (2) - open 06:00-16:30
INSERT INTO company_business_hours (company_id, day_of_week, is_open, start_minutes, end_minutes)
SELECT id, 2, true, 360, 990
FROM companies
ON CONFLICT (company_id, day_of_week) DO NOTHING;

-- Wednesday (3) - open 06:00-16:30
INSERT INTO company_business_hours (company_id, day_of_week, is_open, start_minutes, end_minutes)
SELECT id, 3, true, 360, 990
FROM companies
ON CONFLICT (company_id, day_of_week) DO NOTHING;

-- Thursday (4) - open 06:00-16:30
INSERT INTO company_business_hours (company_id, day_of_week, is_open, start_minutes, end_minutes)
SELECT id, 4, true, 360, 990
FROM companies
ON CONFLICT (company_id, day_of_week) DO NOTHING;

-- Friday (5) - open 06:00-16:30
INSERT INTO company_business_hours (company_id, day_of_week, is_open, start_minutes, end_minutes)
SELECT id, 5, true, 360, 990
FROM companies
ON CONFLICT (company_id, day_of_week) DO NOTHING;

-- Saturday (6) - closed
INSERT INTO company_business_hours (company_id, day_of_week, is_open, start_minutes, end_minutes)
SELECT id, 6, false, NULL, NULL
FROM companies
ON CONFLICT (company_id, day_of_week) DO NOTHING;

-- ============================================================================
-- VERIFICATION QUERY (optional, run after migration)
-- ============================================================================
-- SELECT c.name, cbh.day_of_week, cbh.is_open, cbh.start_minutes, cbh.end_minutes
-- FROM company_business_hours cbh
-- JOIN companies c ON c.id = cbh.company_id
-- ORDER BY c.name, cbh.day_of_week;
