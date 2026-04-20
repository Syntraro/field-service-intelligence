-- 2026-04-19 Company profile consolidation — Phase 1 of 2 (settings-wins backfill).
--
-- Context:
--   `companies` and `company_settings` both stored the tenant's profile
--   (name/phone/email/address/city/province_state/postal_code). Until the
--   2026-04-16 write-through patch, the two could drift — Settings UI wrote
--   to `company_settings` while PDFs/emails/QBO read from `companies`.
--
--   Decision (2026-04-19): `companies` becomes the single canonical owner of
--   the profile fields. `company_settings` keeps ONLY preferences
--   (timezone, date/time format, weekStartsOn, calendarStartHour,
--   defaultPaymentTermsDays, timezoneConfirmedAt).
--
-- Phase 1 scope (this migration):
--   - Backfill `companies.*` from `company_settings.*` using SETTINGS-WINS:
--     whenever `company_settings` holds a meaningful (non-empty, trimmed)
--     value, copy it onto `companies`. Empty/whitespace-only/null settings
--     values never overwrite good `companies` values.
--   - Do NOT drop the duplicated columns from `company_settings` — code
--     still references them during this deploy window. The Phase 2
--     migration drops them after validation.
--
-- Phase 2 (later migration, intentionally separate):
--   - ALTER TABLE company_settings DROP COLUMN company_name, address, city,
--     province_state, postal_code, email, phone.
--   - Runs only after Phase 1 code has been live and verified.
--
-- Safety:
--   - `companies.name` is NOT NULL; COALESCE(..., c.name) preserves it
--     even if the settings value is empty.
--   - Idempotent: running twice is a no-op because any meaningful drift
--     is resolved on the first pass.
--
-- Run via: npm run db:migrate

BEGIN;

UPDATE companies c
   SET name           = COALESCE(NULLIF(TRIM(s.company_name),    ''), c.name),
       phone          = COALESCE(NULLIF(TRIM(s.phone),           ''), c.phone),
       email          = COALESCE(NULLIF(TRIM(s.email),           ''), c.email),
       address        = COALESCE(NULLIF(TRIM(s.address),         ''), c.address),
       city           = COALESCE(NULLIF(TRIM(s.city),            ''), c.city),
       province_state = COALESCE(NULLIF(TRIM(s.province_state),  ''), c.province_state),
       postal_code    = COALESCE(NULLIF(TRIM(s.postal_code),     ''), c.postal_code)
  FROM company_settings s
 WHERE s.company_id = c.id;

COMMIT;
