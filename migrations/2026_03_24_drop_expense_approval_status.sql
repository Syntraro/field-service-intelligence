-- Drop approval_status column from job_expenses.
-- Approval workflow removed in favor of simpler edit/delete/billable model.
--
-- Run: npm run db:migrate:one -- migrations/2026_03_24_drop_expense_approval_status.sql

ALTER TABLE job_expenses DROP COLUMN IF EXISTS approval_status;
