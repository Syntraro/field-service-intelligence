-- Run: npm run db:migrate:one -- migrations/2026_05_18_shift_enums.sql

-- shift_type: top-level classification for every shift row.
-- shift_subtype: reason code for unavailable shifts only.
-- Both enums feed the CHECK constraints on technician_shift_templates
-- and technician_shifts (see companion migrations).

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_type') THEN
    CREATE TYPE shift_type AS ENUM ('normal', 'on_call', 'unavailable');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_subtype') THEN
    CREATE TYPE shift_subtype AS ENUM (
      'vacation', 'sick', 'personal', 'training',
      'holiday', 'scheduled_off', 'other'
    );
  END IF;
END $$;

COMMIT;
