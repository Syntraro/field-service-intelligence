-- 2026-04-22 Payment Ops Dashboard — ROLLBACK of PR2 (reconciliation queue).
--
-- Drops the `payment_reconciliation_pending` table + its indexes. The
-- Payment Ops Dashboard was rolled back; the sidecar queue is no
-- longer written or read from anywhere. The canonical `payments`
-- ledger is unaffected — this table never carried money state.
--
-- Apply only on environments where the forward migration
-- (2026_04_22_payment_reconciliation_pending.sql) was run. Skip on
-- environments that never received it.
--
-- NOTE: The `payment_webhook_events` table is RETAINED as a
-- lightweight error-only webhook log. This rollback affects PR2 only.
--
-- Run:
--   npm run db:migrate:one -- migrations/2026_04_22_rollback_payment_reconciliation_pending.sql

DROP INDEX IF EXISTS payment_reconciliation_pending_unique_idx;
DROP INDEX IF EXISTS payment_reconciliation_pending_company_status_idx;
DROP INDEX IF EXISTS payment_reconciliation_pending_status_created_idx;
DROP INDEX IF EXISTS payment_reconciliation_pending_provider_refund_idx;
DROP TABLE IF EXISTS payment_reconciliation_pending;
