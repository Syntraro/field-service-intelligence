-- ============================================================================
-- 2026-05-03 — payment_allocations table + payments.invoice_id nullable.
--
-- WHY:
--   PR 1 of the customer-portal multi-invoice-payment upgrade. The
--   existing `payments` schema models 1:1 payment-to-invoice via a
--   NOT NULL FK at `payments.invoice_id`. To support "select multiple
--   open invoices, pay them in one Stripe checkout" we need a junction
--   table that captures how a single payment row was allocated across
--   N invoices.
--
--   This migration is intentionally schema-only — no service logic
--   changes. The new table sits alongside `payments`. Existing rows
--   keep their singular `invoice_id` value and continue to work
--   unchanged through the legacy 1:1 read path. The nullability change
--   is what unlocks future multi-invoice payment rows (which will leave
--   `invoice_id` NULL and rely entirely on `payment_allocations`).
--
-- INVARIANT (enforced in repo + tests; not a CHECK because the cross-
-- table predicate is awkward to express and we'd rather catch it at
-- service-layer write time):
--   Every payment row has either:
--     • `invoice_id IS NOT NULL`  (legacy 1:1 — single invoice paid),
--   OR
--     • `invoice_id IS NULL` AND ≥1 row in `payment_allocations` with
--       `payment_id = payments.id`  (modern multi-invoice).
--
--   Never both, never neither.
--
-- SAFETY:
--   * `CREATE TABLE IF NOT EXISTS` — re-runs are no-ops.
--   * `CREATE … INDEX IF NOT EXISTS` — same.
--   * `ALTER TABLE … DROP NOT NULL` — idempotent on PG (no error on
--     already-nullable column, runs as a no-op).
--   * No existing rows mutated. Existing 1:1 payments remain valid.
--   * No FK constraints removed; the existing `payments.invoice_id →
--     invoices.id ON DELETE CASCADE` stays exactly as-is.
--
-- HOW TO RUN:
--   npm run db:migrate:one -- migrations/2026_05_03_payment_allocations.sql
--
-- ROLLBACK (advisory — only safe if no multi-invoice payments have been
--           created yet, i.e. no rows where payments.invoice_id IS NULL):
--     DROP INDEX IF EXISTS payment_allocations_invoice_idx;
--     DROP INDEX IF EXISTS payment_allocations_payment_invoice_uq;
--     DROP TABLE IF EXISTS payment_allocations;
--     ALTER TABLE payments ALTER COLUMN invoice_id SET NOT NULL;
--   (The final SET NOT NULL only succeeds if every payments row has a
--   non-null invoice_id, which is guaranteed pre-PR-2.)
-- ============================================================================

BEGIN;

-- 1. New junction table. One row per (payment, invoice) allocation.
--    `allocated_amount` is the slice of the payment's gross amount
--    applied to that specific invoice. Sum of allocated_amount across a
--    payment's allocations should equal payments.amount, but we don't
--    enforce that as a CHECK at DB level — it's a service-layer
--    invariant validated at write time (and by the upcoming
--    paymentApplicationService).
CREATE TABLE IF NOT EXISTS "payment_allocations" (
  "id"                varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id"        varchar NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "payment_id"        varchar NOT NULL REFERENCES "payments"("id")  ON DELETE CASCADE,
  "invoice_id"        varchar NOT NULL REFERENCES "invoices"("id")  ON DELETE RESTRICT,
  "allocated_amount"  numeric(12,2) NOT NULL,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now()
);

-- 2. Uniqueness: at most one allocation row per (payment, invoice) pair.
--    Prevents accidental double-allocation of the same payment to the
--    same invoice; if we want to top up an existing allocation, the
--    code path is to UPDATE the existing row, not INSERT another.
CREATE UNIQUE INDEX IF NOT EXISTS "payment_allocations_payment_invoice_uq"
  ON "payment_allocations" ("payment_id", "invoice_id");

-- 3. Per-invoice lookup index. Tenant-scoped because every legitimate
--    query is. The portal "show me how much has been paid against this
--    invoice" path will reach here via (company_id, invoice_id).
CREATE INDEX IF NOT EXISTS "payment_allocations_invoice_idx"
  ON "payment_allocations" ("company_id", "invoice_id");

-- 4. Payments: drop NOT NULL on invoice_id so future multi-invoice
--    payment rows can leave it NULL and rely on payment_allocations.
--    The FK + cascade-delete behaviour stays intact for legacy rows.
--    PG accepts DROP NOT NULL as a no-op on already-nullable columns,
--    so this is fully idempotent.
ALTER TABLE "payments" ALTER COLUMN "invoice_id" DROP NOT NULL;

COMMIT;
