-- ============================================================================
-- Migration: 2026_05_03_rename_invoice_email_columns
-- ============================================================================
--
-- Purpose
--   Generalize the two reminder-specific columns on `invoices` to canonical
--   email-tracking columns:
--     last_reminder_at  → last_emailed_at
--     reminder_count    → email_send_count
--
--   Both columns now track ANY outbound email send for the invoice (manual
--   "Email invoice" or automated reminder sweep), not only reminder
--   sends. The cadence-based sweep worker continues to read these columns
--   to gate "first delay" / "repeat every" timing — its semantics are
--   unchanged because every email send (manual or automated) bumps the
--   same counter, which is what the cadence wants.
--
--   The reminder pause / snooze columns (`reminders_paused`,
--   `reminder_snooze_until`) keep their names — they remain
--   reminder-specific (they only suppress the AUTOMATED sweep; manual
--   email sends are not gated by them post-2026-05-03).
--
-- Schema source
--   shared/schema.ts::invoices (renames in same commit).
--
-- Run instructions
--   Local / dev:    npm run db:migrate:one -- migrations/2026_05_03_rename_invoice_email_columns.sql
--   Full sweep:     npm run db:migrate
--
-- Reversibility
--   `ALTER TABLE invoices RENAME COLUMN last_emailed_at TO last_reminder_at;`
--   `ALTER TABLE invoices RENAME COLUMN email_send_count TO reminder_count;`
--   No data is lost — RENAME is an in-place schema change.
--
-- Idempotency
--   Guarded by a `DO $$ ... END $$` block that inspects pg_attribute and
--   only renames when the OLD column name is present. Re-running on a
--   migrated DB is a no-op.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'last_reminder_at'
  ) THEN
    ALTER TABLE "invoices" RENAME COLUMN "last_reminder_at" TO "last_emailed_at";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'reminder_count'
  ) THEN
    ALTER TABLE "invoices" RENAME COLUMN "reminder_count" TO "email_send_count";
  END IF;
END $$;
