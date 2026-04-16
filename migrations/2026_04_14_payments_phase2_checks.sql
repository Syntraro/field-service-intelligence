-- Payments Phase 2 (2026-04-14): non-payment ledger writers go live.
--
-- Adds the invariants that Phase 1 deferred until refund/reversal rows
-- could actually exist. All Phase 1 rows satisfy these (payment_type
-- defaulted to 'payment', parent null, positive amount), so no backfill
-- is required. Replay-safe — running twice is a no-op.
--
-- Run: npm run db:migrate:one -- migrations/2026_04_14_payments_phase2_checks.sql

-- Compound CHECK: ledger shape invariant. Every row is either a payment
-- (positive amount, no parent) or a refund/reversal (negative amount,
-- parent set). Paired with the paymentType enum default at the column
-- level, this prevents any row that would violate single-source-of-truth
-- semantics.
DO $$
BEGIN
  ALTER TABLE payments
    ADD CONSTRAINT payments_ledger_shape_chk CHECK (
      (payment_type = 'payment' AND amount > 0 AND parent_payment_id IS NULL)
      OR
      (payment_type IN ('refund', 'reversal') AND amount < 0 AND parent_payment_id IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Partial UNIQUE: catches webhook-replay / double-submit of a refund
-- keyed by (tenant, parent, reference). Applies only to rows that carry
-- a parent id and a non-empty reference. The existing
-- payments_company_invoice_reference_uq still guards invoice-wide
-- duplicates; both must hold.
CREATE UNIQUE INDEX IF NOT EXISTS payments_company_parent_reference_uq
  ON payments (company_id, parent_payment_id, reference)
  WHERE parent_payment_id IS NOT NULL AND reference IS NOT NULL AND reference <> '';
