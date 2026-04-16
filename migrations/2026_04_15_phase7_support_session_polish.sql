-- Phase 7 (Production Readiness): support-session polish
--
-- Adds `requested_duration_minutes` so the approval path no longer has to
-- derive the original requested minutes from (expires_at - created_at).
-- Backfills existing rows from that same derivation.

BEGIN;

ALTER TABLE impersonation_sessions
  ADD COLUMN IF NOT EXISTS requested_duration_minutes INTEGER;

UPDATE impersonation_sessions
  SET requested_duration_minutes = GREATEST(
    15,
    ROUND(EXTRACT(EPOCH FROM (expires_at - created_at)) / 60.0)::int
  )
  WHERE requested_duration_minutes IS NULL;

COMMIT;
