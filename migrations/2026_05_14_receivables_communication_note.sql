-- migrations/2026_05_14_receivables_communication_note.sql
-- Run with: npm run db:migrate:one -- migrations/2026_05_14_receivables_communication_note.sql
--
-- Adds Contact-Client communication workflow fields:
--   1. receivables_notes.outcome          — outcome code (spoke_with, left_message, …)
--   2. receivables_notes.contact_person_id — FK to contact_persons (nullable)
--   3. receivables_notes.communicated_at  — user-selected date+time of contact
--   4. invoices.last_contacted_at         — set on each logged communication;
--      used by the "No Recent Contact" view alongside last_emailed_at

ALTER TABLE receivables_notes
  ADD COLUMN IF NOT EXISTS outcome text,
  ADD COLUMN IF NOT EXISTS contact_person_id varchar REFERENCES contact_persons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS communicated_at timestamptz;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS last_contacted_at timestamptz;

-- Extend note_type CHECK to include 'communication' (original constraint from 2026_05_13 omitted it)
ALTER TABLE receivables_notes
  DROP CONSTRAINT IF EXISTS receivables_notes_note_type_check;

ALTER TABLE receivables_notes
  ADD CONSTRAINT receivables_notes_note_type_check
  CHECK (note_type IN ('general','reminder','promise_to_pay','dispute','escalation','payment_received','communication'));
