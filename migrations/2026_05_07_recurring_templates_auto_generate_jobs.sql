-- =====================================================================
-- Migration: 2026-05-07 — recurring_job_templates.auto_generate_jobs
-- =====================================================================
-- Add an explicit per-template toggle that controls whether the
-- background generator (and the post-create handler) auto-promotes
-- newly created PENDING instances into UNSCHEDULED jobs.
--
-- Why
-- ---
-- This is the user-facing "Service Plans → Automatically generate
-- work" toggle. Until now, the worker only ever created pending
-- recurring_job_instances rows; converting those into jobs was an
-- always-manual step driven by the dispatcher in the Maintenance/PM
-- workspace. Several customers want a "set and forget" mode where a
-- service plan auto-creates the unscheduled job/work order so it
-- lands directly on the dispatch backlog. This column is the toggle.
--
-- IMPORTANT product invariant (do NOT change without revisiting the
-- generation pipeline):
--   - When auto_generate_jobs = true the system creates an UNSCHEDULED
--     job (status = 'open', scheduledStart NULL, no primary_technician,
--     no visit row, no calendar reservation). Job creation goes
--     through the same `generateFromInstances()` path used by the
--     manual "generate selected" UI, which already enforces these
--     invariants (see server/domain/recurrence.ts).
--   - When auto_generate_jobs = false the worker only creates pending
--     instances; converting them to jobs remains a manual step. This
--     preserves the historical behavior.
--
-- Default
-- -------
-- Defaults to FALSE for both new rows AND existing rows. The current
-- system never auto-creates jobs, so the safe default is the
-- historical behavior. Customers opt in per plan via the wizard's
-- "Automatically generate work" toggle.
--
-- Schema
-- ------
--   auto_generate_jobs   boolean NOT NULL DEFAULT false
--
-- Idempotent
-- ----------
-- IF NOT EXISTS guards make this safe to re-run.
-- =====================================================================

ALTER TABLE recurring_job_templates
  ADD COLUMN IF NOT EXISTS auto_generate_jobs boolean NOT NULL DEFAULT false;

-- Backfill existing rows to the safe default explicitly so we don't
-- depend on the DEFAULT clause for previously-created rows under any
-- adapter that skips DEFAULT propagation on ADD COLUMN.
UPDATE recurring_job_templates
SET auto_generate_jobs = false
WHERE auto_generate_jobs IS NULL;
