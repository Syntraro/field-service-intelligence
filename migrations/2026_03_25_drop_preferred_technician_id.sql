-- Migration: Drop preferred_technician_id from recurring_job_templates
-- Run: npm run db:migrate:one -- migrations/2026_03_25_drop_preferred_technician_id.sql
--
-- Context: PM system no longer assigns technicians at the template level.
-- Generated PM jobs are always unscheduled. Technician assignment happens
-- at visit scheduling time via dispatch.

ALTER TABLE recurring_job_templates
  DROP COLUMN IF EXISTS preferred_technician_id;
