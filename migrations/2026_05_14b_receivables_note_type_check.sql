-- migrations/2026_05_14b_receivables_note_type_check.sql
-- Run with: npm run db:migrate:one -- migrations/2026_05_14b_receivables_note_type_check.sql
--
-- Extends the receivables_notes note_type CHECK constraint to include 'communication'.
-- The original constraint (from 2026_05_13) omitted this value, causing INSERT failures
-- when logging communication notes via the Contact Client modal.

ALTER TABLE receivables_notes
  DROP CONSTRAINT IF EXISTS receivables_notes_note_type_check;

ALTER TABLE receivables_notes
  ADD CONSTRAINT receivables_notes_note_type_check
  CHECK (note_type IN ('general','reminder','promise_to_pay','dispute','escalation','payment_received','communication'));
