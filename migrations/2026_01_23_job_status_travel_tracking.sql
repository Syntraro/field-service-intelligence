-- Migration: Add travel tracking fields and update job status system
-- Date: 2026-01-23
--
-- This migration:
-- 1. Adds travel tracking fields (travelStartedAt, arrivedOnSiteAt)
-- 2. Adds holdReason field for on_hold status
-- 3. Adds holdNotes and onHoldAt fields
-- 4. Updates the default status from 'draft' to 'unscheduled'
-- 5. Migrates existing statuses to new values
--
-- IMPORTANT: Run this migration AFTER backing up the database

-- ============================================================================
-- 1. Add new columns
-- ============================================================================

-- Travel tracking fields
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS travel_started_at TIMESTAMP;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS arrived_on_site_at TIMESTAMP;

-- Hold reason field (parts, customer, access, approval, weather, other)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS hold_reason TEXT;

-- Hold state fields
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS hold_notes TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS on_hold_at TIMESTAMP;

-- ============================================================================
-- 2. Migrate existing status values to new values
-- ============================================================================

-- Map old statuses to new ones:
-- 'draft' -> 'unscheduled'
-- 'dispatched' -> 'scheduled' (dispatched is just a scheduled job that's been assigned)
-- 'en_route' -> 'in_progress' (travel tracking is now via timestamp, not status)
-- 'on_site' -> 'in_progress'
-- 'action_required' -> 'on_hold'
-- 'cancelled' (UK spelling) -> 'canceled' (US spelling, canonical)
-- 'needs_parts' -> 'on_hold' with hold_reason = 'parts'

-- Migrate 'draft' to 'unscheduled'
UPDATE jobs SET status = 'unscheduled' WHERE status = 'draft';

-- Migrate 'dispatched' to 'scheduled'
UPDATE jobs SET status = 'scheduled' WHERE status = 'dispatched';

-- Migrate 'en_route' to 'in_progress', record travel start time if available
UPDATE jobs
SET status = 'in_progress',
    travel_started_at = COALESCE(travel_started_at, updated_at)
WHERE status = 'en_route';

-- Migrate 'on_site' to 'in_progress', record arrival time if available
UPDATE jobs
SET status = 'in_progress',
    arrived_on_site_at = COALESCE(arrived_on_site_at, updated_at)
WHERE status = 'on_site';

-- Migrate 'action_required' to 'on_hold', preserve the reason
UPDATE jobs
SET status = 'on_hold',
    hold_reason = CASE
        WHEN action_required_reason ILIKE '%part%' THEN 'parts'
        WHEN action_required_reason ILIKE '%customer%' THEN 'customer'
        WHEN action_required_reason ILIKE '%access%' THEN 'access'
        WHEN action_required_reason ILIKE '%approv%' THEN 'approval'
        WHEN action_required_reason ILIKE '%weather%' THEN 'weather'
        ELSE 'other'
    END,
    hold_notes = action_required_notes,
    on_hold_at = action_required_at
WHERE status = 'action_required';

-- Migrate 'needs_parts' to 'on_hold' with hold_reason = 'parts'
UPDATE jobs
SET status = 'on_hold',
    hold_reason = 'parts',
    on_hold_at = COALESCE(on_hold_at, updated_at)
WHERE status = 'needs_parts';

-- Migrate 'cancelled' (UK) to 'canceled' (US, canonical)
UPDATE jobs SET status = 'canceled' WHERE status = 'cancelled';

-- ============================================================================
-- 3. Update constraints
-- ============================================================================

-- Drop old constraint if it exists
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_action_required_reason_check;

-- Add new constraint: on_hold status requires a hold_reason (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_hold_reason_check') THEN
    ALTER TABLE jobs ADD CONSTRAINT jobs_hold_reason_check
      CHECK (status <> 'on_hold' OR hold_reason IS NOT NULL);
  END IF;
END $$;

-- ============================================================================
-- 4. Update default status (for new jobs)
-- ============================================================================

ALTER TABLE jobs ALTER COLUMN status SET DEFAULT 'unscheduled';

-- ============================================================================
-- 5. Add comments for documentation
-- ============================================================================

COMMENT ON COLUMN jobs.travel_started_at IS 'When technician started traveling to job (for billing drive time)';
COMMENT ON COLUMN jobs.arrived_on_site_at IS 'When technician arrived at job site';
COMMENT ON COLUMN jobs.hold_reason IS 'Required when status=on_hold. Values: parts, customer, access, approval, weather, other';
COMMENT ON COLUMN jobs.hold_notes IS 'Optional notes about why job is on hold';
COMMENT ON COLUMN jobs.on_hold_at IS 'When job entered on_hold status (for aging)';

-- ============================================================================
-- Verification queries (run manually to verify migration)
-- ============================================================================

-- Check for any jobs still with old statuses (should return 0)
-- SELECT status, COUNT(*) FROM jobs WHERE status IN ('draft', 'dispatched', 'en_route', 'on_site', 'action_required', 'needs_parts', 'cancelled') GROUP BY status;

-- Check new status distribution
-- SELECT status, COUNT(*) FROM jobs GROUP BY status ORDER BY COUNT(*) DESC;

-- Verify on_hold jobs have hold_reason
-- SELECT id, status, hold_reason FROM jobs WHERE status = 'on_hold' AND hold_reason IS NULL;
