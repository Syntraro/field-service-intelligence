-- 2026-03-18: Drop deprecated actionRequired* columns from jobs table
--
-- These columns were part of the legacy "action required" workflow that has been
-- fully replaced by canonical hold fields (on_hold_at, hold_reason, hold_notes).
--
-- Prerequisites (all applied):
-- - 2026_03_18_backfill_canonical_hold_fields.sql (copied data to canonical fields)
-- - 2026_03_18_migrate_needs_review_to_on_hold.sql (converted legacy substatus)
--
-- Runtime reads removed in prior pass. Zero live code references these columns.
-- previousStatus is NOT dropped — it is actively used by CLOSE/UNDO_CLOSE lifecycle.

ALTER TABLE jobs DROP COLUMN IF EXISTS action_required_reason;
ALTER TABLE jobs DROP COLUMN IF EXISTS action_required_notes;
ALTER TABLE jobs DROP COLUMN IF EXISTS action_required_at;
ALTER TABLE jobs DROP COLUMN IF EXISTS action_required_escalated_at;
