-- Migration: Make jobs.job_type nullable
-- Purpose: Tech-created jobs should not be auto-tagged with a job type.
-- The column retains its default('maintenance') for office-created jobs,
-- but DROP NOT NULL allows tech route to insert NULL when type is unselected.
-- Run: npm run db:migrate:one -- migrations/2026_04_06_jobs_job_type_nullable.sql

ALTER TABLE jobs ALTER COLUMN job_type DROP NOT NULL;
