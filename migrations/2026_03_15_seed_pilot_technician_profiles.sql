-- Migration: Create missing technician profiles for pilot tenant
-- Date: 2026-03-15
-- Purpose: Ensure all schedulable users in the production tenant have
--          technician_profiles for dispatch board colors, labor costing,
--          and billable rate calculations.
--
-- Run: npm run db:migrate:one -- migrations/2026_03_15_seed_pilot_technician_profiles.sql
--
-- Target tenant: 617dac31-2c3d-49f7-bc49-6b1bfedd37d4
--
-- Missing profiles (2 users):
--   - Mikel Elias (d2536dd3-de0a-4d7a-9960-5494814e66c9) — technician
--   - Solomon Rahimi (0fc1d52f-3d06-4d39-8c69-64304582a928) — technician
--
-- Defaults: Uses $45/hr labor cost, $75/hr billable rate (common HVAC technician rates).
--           Colors chosen from a palette that does not conflict with existing profiles
--           (existing: #111212 Nadeem, #ce3bf7 Juliana, #f76a3b Jonah, #3b82f6 Jad).
--
-- Safe to re-run: INSERT ... ON CONFLICT DO NOTHING on PK (user_id).

-- Step 0: Preview missing profiles (run manually)
-- SELECT u.id, u.full_name, u.role
-- FROM users u
-- LEFT JOIN technician_profiles tp ON tp.user_id = u.id
-- WHERE u.company_id = '617dac31-2c3d-49f7-bc49-6b1bfedd37d4'
--   AND u.deleted_at IS NULL AND u.disabled = false AND u.is_schedulable = true
--   AND tp.user_id IS NULL;

-- Step 1: Create profile for Mikel Elias
INSERT INTO technician_profiles (user_id, labor_cost_per_hour, billable_rate_per_hour, color)
VALUES ('d2536dd3-de0a-4d7a-9960-5494814e66c9', '45.00', '75.00', '#10b981')
ON CONFLICT (user_id) DO NOTHING;

-- Step 2: Create profile for Solomon Rahimi
INSERT INTO technician_profiles (user_id, labor_cost_per_hour, billable_rate_per_hour, color)
VALUES ('0fc1d52f-3d06-4d39-8c69-64304582a928', '45.00', '75.00', '#f59e0b')
ON CONFLICT (user_id) DO NOTHING;

-- Step 3: Verify all schedulable users now have profiles
-- SELECT u.id, u.full_name, u.role, tp.labor_cost_per_hour, tp.billable_rate_per_hour, tp.color
-- FROM users u
-- LEFT JOIN technician_profiles tp ON tp.user_id = u.id
-- WHERE u.company_id = '617dac31-2c3d-49f7-bc49-6b1bfedd37d4'
--   AND u.deleted_at IS NULL AND u.disabled = false
-- ORDER BY u.full_name;
