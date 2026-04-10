-- 2026_04_09_invoice_permanent_delete.sql
-- Move invoices to a permanent-delete model. Drops the half-built soft-delete
-- columns, cleans up stale rows, and adds the missing FK constraints that the
-- new canonical delete path relies on.
--
-- Run instructions:
--   npm run db:migrate:one -- migrations/2026_04_09_invoice_permanent_delete.sql
--
-- Locked product decisions enforced by this migration:
--   1. Invoices have NO soft-delete state. The is_active and deleted_at columns
--      are dropped. No application code writes them; the only writers were
--      manual SQL outside the codebase.
--   2. Deleting an invoice must NOT break the linked job. The existing FK
--      jobs.invoice_id ON DELETE SET NULL already handles this; no change.
--   3. Deleting a job must NOT break the linked invoice. Add a missing FK on
--      invoices.job_id ON DELETE SET NULL so the back-pointer is auto-detached
--      by the database (in addition to the explicit detach in storage.deleteJob).
--   4. invoice_tax_lines must cascade-delete with the parent invoice. The
--      Drizzle schema declared the FK with ON DELETE CASCADE, but the live DB
--      was missing the constraint entirely. Add it.
--
-- Steps (all wrapped in one transaction for atomicity):
--   1. Hard-delete the 4 known stale soft-deleted draft invoices. They are all
--      status='draft', none have payments, none are QBO-synced. The FK
--      jobs.invoice_id ON DELETE SET NULL auto-clears the 1 dangling pointer
--      (job 108006 → invoice 85e28bb2-...) when the row is removed. Targets
--      only rows that explicitly carry soft-delete state, so a re-run after
--      step 2 is a no-op.
--   2. ALTER TABLE invoices DROP COLUMN is_active, DROP COLUMN deleted_at.
--   3. Add FK invoice_tax_lines.invoice_id REFERENCES invoices(id) ON DELETE
--      CASCADE, only if not already present (covers the live-DB drift case).
--   4. Add FK invoices.job_id REFERENCES jobs(id) ON DELETE SET NULL, only if
--      not already present.
--
-- Rollback: this migration is destructive on the soft-delete columns. To roll
-- back you would need to re-add the columns, repopulate them from a backup,
-- and drop the new FKs. Take a DB snapshot before running in production.

BEGIN;

-- 1. Clean up the stale soft-deleted draft invoices.
--    The targeted criteria (deleted_at IS NOT NULL OR is_active = false) only
--    matches rows that the half-built soft-delete touched. Verified live: 4 rows.
DELETE FROM invoices
WHERE deleted_at IS NOT NULL OR is_active = false;

-- 2. Drop the soft-delete columns. No application code writes them anymore
--    (verified by grep on 2026-04-09 — see CHANGELOG entry for that date).
ALTER TABLE invoices
  DROP COLUMN IF EXISTS is_active,
  DROP COLUMN IF EXISTS deleted_at;

-- 3. Create invoice_tax_lines table if missing.
--
--    Audited 2026-04-09: shared/schema.ts declares this table with FKs and
--    indexes, and 5 server files (server/services/invoiceCreationService.ts,
--    server/storage/invoices.ts, server/storage/tax.ts, server/routes/portal.ts,
--    server/routes/invoices.ts) reference it, but the live DB has never had
--    it. The table was supposed to be created by an earlier migration that
--    never landed. Creating it here is required by the new permanent-delete
--    storage path (storage.deleteInvoice explicitly deletes from this table
--    inside its transaction) AND it unblocks the tax-snapshot write path in
--    invoiceCreationService.applyTaxGroupCore which is currently dead because
--    the table is missing. Live audit confirmed 0 rows in invoices have a
--    tax_group_id set, so no historical tax snapshots are being lost by
--    creating an empty table now.
CREATE TABLE IF NOT EXISTS invoice_tax_lines (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id varchar NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id varchar NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  tax_rate_id varchar REFERENCES company_tax_rates(id) ON DELETE SET NULL,
  tax_rate_name text NOT NULL,
  rate_percent numeric(7, 4) NOT NULL,
  taxable_amount numeric(12, 2) NOT NULL DEFAULT '0.00',
  tax_amount numeric(12, 2) NOT NULL DEFAULT '0.00',
  tax_group_id varchar,
  tax_group_name text,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS invoice_tax_lines_invoice_idx ON invoice_tax_lines(invoice_id);
CREATE INDEX IF NOT EXISTS invoice_tax_lines_company_idx ON invoice_tax_lines(company_id);

-- 4. Add the missing FK on invoices.job_id so deleting a job auto-detaches the
--    back-pointer (mirrors the existing jobs.invoice_id FK ON DELETE SET NULL).
--    Idempotent. Verified live state: 0 dangling invoices.job_id rows, so the
--    constraint addition will not fail on existing data.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'invoices'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name = 'invoices_job_id_fk'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_job_id_fk
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;
