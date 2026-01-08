-- Migration: Make clients.next_due nullable
-- Date: 2026-01-08
-- Issue: Cannot add location to client - "null value in column 'next_due' violates not-null constraint"
--
-- The next_due column is only needed for PM scheduling and should be optional
-- when creating new locations under customer companies.

-- Make next_due column nullable
ALTER TABLE clients
ALTER COLUMN next_due DROP NOT NULL;

-- Add comment explaining the column
COMMENT ON COLUMN clients.next_due IS 'Next PM due date - optional, only used for locations with PM scheduling';
