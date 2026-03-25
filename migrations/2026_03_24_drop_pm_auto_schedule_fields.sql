-- Migration: Drop deprecated PM auto-schedule fields from recurring_job_templates
-- Date: 2026-03-24
-- Reason: PM jobs are now always generated unscheduled. Auto-schedule and scheduled time
--         are no longer used in the recurring PM workflow.
-- Run: npm run db:migrate:one -- migrations/2026_03_24_drop_pm_auto_schedule_fields.sql

-- Drop auto_schedule column (was boolean, default false)
ALTER TABLE recurring_job_templates DROP COLUMN IF EXISTS auto_schedule;

-- Drop scheduled_time_local column (was text, HH:MM format)
ALTER TABLE recurring_job_templates DROP COLUMN IF EXISTS scheduled_time_local;
