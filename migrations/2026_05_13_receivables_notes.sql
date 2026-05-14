-- Run: npm run db:migrate:one -- migrations/2026_05_13_receivables_notes.sql
--
-- Creates the receivables_notes table: customer/account-scoped collections
-- activity log. Used by the Receivables workspace for promise tracking,
-- dispute recording, and general collection notes.
--
-- Design decisions:
--   * customer_company_id is required — notes are account-level, not just
--     per-invoice. A single conversation can span many invoices.
--   * invoice_id and payment_id are optional — customer-scoped notes
--     survive invoice deletion (ON DELETE SET NULL).
--   * created_by_system marks auto-created rows (e.g. system reminder
--     confirmation note) so the UI can render them differently.
--   * note_type CHECK prevents drift between DB and application layer.
--   * promise_to_pay note_type requires promised_at (DB-level invariant).

CREATE TABLE IF NOT EXISTS receivables_notes (
  id                   varchar       PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           varchar       NOT NULL REFERENCES companies(id)          ON DELETE CASCADE,
  customer_company_id  varchar       NOT NULL REFERENCES customer_companies(id) ON DELETE CASCADE,
  invoice_id           varchar                REFERENCES invoices(id)           ON DELETE SET NULL,
  payment_id           varchar                REFERENCES payments(id)           ON DELETE SET NULL,
  user_id              varchar                REFERENCES users(id)              ON DELETE SET NULL,
  note_type            text          NOT NULL,
  note_text            text          NOT NULL,
  promised_at          timestamptz,
  contact_method       text,
  created_by_system    boolean       NOT NULL DEFAULT false,
  created_at           timestamptz   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           timestamptz,

  CONSTRAINT receivables_notes_note_type_check
    CHECK (note_type IN ('general','reminder','promise_to_pay','dispute','escalation','payment_received')),

  CONSTRAINT receivables_notes_promise_requires_promised_at
    CHECK (note_type != 'promise_to_pay' OR promised_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS receivables_notes_company_customer_idx
  ON receivables_notes(company_id, customer_company_id);

CREATE INDEX IF NOT EXISTS receivables_notes_company_invoice_idx
  ON receivables_notes(company_id, invoice_id)
  WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS receivables_notes_company_payment_idx
  ON receivables_notes(company_id, payment_id)
  WHERE payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS receivables_notes_company_created_at_idx
  ON receivables_notes(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS receivables_notes_company_note_type_idx
  ON receivables_notes(company_id, note_type);
