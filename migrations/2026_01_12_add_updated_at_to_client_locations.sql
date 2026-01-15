-- Add missing updated_at column to client_locations table
-- This fixes the 500 error on /api/clients when sorting by updatedAt
--
-- Run: psql $DATABASE_URL -f migrations/2026_01_12_add_updated_at_to_client_locations.sql

-- Step 1: Add the column if it doesn't exist
-- Using TIMESTAMPTZ for timezone-aware timestamps
ALTER TABLE client_locations
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Step 2: Backfill existing rows with created_at value (or NOW() if created_at is null)
UPDATE client_locations
SET updated_at = COALESCE(created_at::timestamptz, NOW())
WHERE updated_at IS NULL;

-- Step 3: Make the column NOT NULL with a default
ALTER TABLE client_locations
ALTER COLUMN updated_at SET NOT NULL,
ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;

-- Step 4: Create the trigger function (if not exists)
-- This function auto-updates the updated_at column on any UPDATE
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 5: Create the trigger on client_locations
-- DROP first to make migration idempotent
DROP TRIGGER IF EXISTS trigger_client_locations_updated_at ON client_locations;
CREATE TRIGGER trigger_client_locations_updated_at
    BEFORE UPDATE ON client_locations
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- Verify
-- SELECT id, company_name, created_at, updated_at FROM client_locations LIMIT 5;
