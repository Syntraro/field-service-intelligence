-- Migration: Fix all-day CHECK constraints to evaluate in UTC
--
-- PROBLEM: EXTRACT(HOUR/MINUTE/SECOND FROM timestamptz) uses the DB session
-- timezone, so UTC values (00:00:00Z, 23:59:59Z) can fail the constraint
-- when the session timezone is not UTC.
--
-- FIX: Use "AT TIME ZONE 'UTC'" so EXTRACT always evaluates against the UTC
-- representation of the timestamp, regardless of session timezone.
--
-- RUN:
--   psql "$DATABASE_URL" -f migrations/2026_01_27_fix_all_day_constraints_utc.sql
--
-- DO NOT use -1 / --single-transaction (no CONCURRENTLY usage, but keeping
-- consistent with project convention).

-- Drop existing constraints
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_all_day_start_midnight_check;
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_all_day_end_2359_check;

-- Recreate with AT TIME ZONE 'UTC' for timezone-invariant evaluation
ALTER TABLE jobs ADD CONSTRAINT jobs_all_day_start_midnight_check CHECK (
  is_all_day IS DISTINCT FROM TRUE
  OR (
    EXTRACT(HOUR   FROM (scheduled_start AT TIME ZONE 'UTC')) = 0 AND
    EXTRACT(MINUTE FROM (scheduled_start AT TIME ZONE 'UTC')) = 0 AND
    EXTRACT(SECOND FROM (scheduled_start AT TIME ZONE 'UTC')) = 0
  )
);

ALTER TABLE jobs ADD CONSTRAINT jobs_all_day_end_2359_check CHECK (
  is_all_day IS DISTINCT FROM TRUE
  OR (
    EXTRACT(HOUR   FROM (scheduled_end AT TIME ZONE 'UTC')) = 23 AND
    EXTRACT(MINUTE FROM (scheduled_end AT TIME ZONE 'UTC')) = 59 AND
    EXTRACT(SECOND FROM (scheduled_end AT TIME ZONE 'UTC')) = 59
  )
);
