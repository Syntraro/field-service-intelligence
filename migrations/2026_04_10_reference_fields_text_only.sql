-- Reference Fields: Lock to text-only
-- 2026-04-10: Remove dead number/date columns and constrain type to 'text'.
--
-- Pre-flight verified: zero non-null values in number_value and date_value.
--
-- Changes:
--   1. Drop the single-value CHECK (references columns being dropped)
--   2. Drop number_value and date_value columns from reference_field_values
--   3. Replace type CHECK constraint to allow only 'text'
--
-- Run: npm run db:migrate:one -- migrations/2026_04_10_reference_fields_text_only.sql
-- Renamed from ref_fields_text_only → reference_fields_text_only to fix lexical sort order
-- (must run after 2026_04_10_reference_fields.sql which creates the tables)

-- Step 1: Drop the single-value CHECK constraint (references number_value, date_value)
ALTER TABLE reference_field_values
  DROP CONSTRAINT IF EXISTS ref_field_vals_single_value_check;

-- Step 2: Drop dead columns
ALTER TABLE reference_field_values
  DROP COLUMN IF EXISTS number_value,
  DROP COLUMN IF EXISTS date_value;

-- Step 3: Replace type CHECK constraint — lock to text only
ALTER TABLE reference_field_definitions
  DROP CONSTRAINT IF EXISTS ref_field_defs_type_check;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ref_field_defs_type_check') THEN
    ALTER TABLE reference_field_definitions
      ADD CONSTRAINT ref_field_defs_type_check
      CHECK (type = 'text');
  END IF;
END $$;

-- Step 4: Update the attribution isolation constraint (references number_value/date_value)
-- The old constraint was on time_entries, not reference_field_values — no change needed here.
-- The ref_field_vals_single_value_check was the only constraint referencing dropped columns.
