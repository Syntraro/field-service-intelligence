-- Invoice Reminder System (2026-04-16)
--
-- Surgical addition per the FSI audit. Additive columns only. No new tables.
-- Extends communication_templates entity-type check so reminder copy can
-- live alongside the existing invoice/quote/job templates.

BEGIN;

-- 1. Per-invoice reminder tracking -------------------------------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS last_reminder_at       TIMESTAMP,
  ADD COLUMN IF NOT EXISTS reminder_count         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reminders_paused       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_snooze_until  TIMESTAMP;

-- Index supporting the sweep query. Only covers rows that can ever be
-- reminded — draft/paid/voided rows and zero-balance rows are excluded by
-- the partial predicate so the index stays tight.
CREATE INDEX IF NOT EXISTS idx_invoices_reminder_sweep
  ON invoices (company_id, due_date)
  WHERE status IN ('awaiting_payment', 'partial_paid', 'sent')
    AND balance::numeric > 0
    AND reminders_paused = false;

-- 2. Per-tenant reminder settings --------------------------------------------
ALTER TABLE tenant_features
  ADD COLUMN IF NOT EXISTS invoice_reminders_enabled        BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS invoice_reminder_first_delay_days INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS invoice_reminder_repeat_every_days INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS invoice_reminder_max_count        INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS invoice_reminder_tone             TEXT    NOT NULL DEFAULT 'friendly';

-- Existing tenants get the same defaults automatically by the NOT NULL
-- DEFAULT above — the ALTER back-fills on add. Verified by design with
-- Postgres `ADD COLUMN ... DEFAULT` semantics (no explicit UPDATE needed).

-- 3. Allow a distinct `invoice_reminder` template entity in
--    communication_templates so reminders can reuse the existing tenant
--    template editor / renderer without a new table. ------------------------
ALTER TABLE communication_templates
  DROP CONSTRAINT IF EXISTS comm_templates_entity_type_chk;

ALTER TABLE communication_templates
  ADD CONSTRAINT comm_templates_entity_type_chk
  CHECK (entity_type IN ('invoice', 'quote', 'job', 'invoice_reminder'));

COMMIT;
