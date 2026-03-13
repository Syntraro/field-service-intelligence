-- PM Templates Phase 2: Add optional scheduling, billing defaults
-- Run: npm run db:migrate:one -- migrations/2026_03_10_pm_templates_phase2.sql

-- Optional scheduling defaults
ALTER TABLE pm_templates ADD COLUMN IF NOT EXISTS default_months_of_year INTEGER[];
ALTER TABLE pm_templates ADD COLUMN IF NOT EXISTS default_generation_mode TEXT;
ALTER TABLE pm_templates ADD COLUMN IF NOT EXISTS default_generation_day_of_month INTEGER;
ALTER TABLE pm_templates ADD COLUMN IF NOT EXISTS default_service_window_days_before INTEGER;
ALTER TABLE pm_templates ADD COLUMN IF NOT EXISTS default_service_window_days_after INTEGER;
ALTER TABLE pm_templates ADD COLUMN IF NOT EXISTS default_include_location_pm_parts BOOLEAN;

-- Optional billing defaults
ALTER TABLE pm_templates ADD COLUMN IF NOT EXISTS billing_mode TEXT;
ALTER TABLE pm_templates ADD COLUMN IF NOT EXISTS billing_label TEXT;
ALTER TABLE pm_templates ADD COLUMN IF NOT EXISTS default_price NUMERIC;
