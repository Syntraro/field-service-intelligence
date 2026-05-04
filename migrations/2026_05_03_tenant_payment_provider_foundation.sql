-- ============================================================================
-- 2026-05-03 — Tenant payment provider foundation (PR1, schema-only).
--
-- WHY:
--   Foundation for tenant-owned payment collection (Stripe Connect-style
--   onboarding, payouts, disputes). Today's runtime collects all payments
--   to a single platform Stripe account; PR2+ will route collection
--   through per-tenant provider accounts. This migration adds ONLY the
--   storage shape needed for that future flow:
--     1. `companies.payment_provider` — nullable text. Carries which
--        provider the tenant has onboarded with (today only `stripe`
--        is meaningful). NULL = "not yet onboarded". Drives the future
--        provider resolver.
--     2. `payments.payment_provider_account_id` — nullable FK to the
--        new `payment_provider_accounts` table. Identifies which
--        tenant connected account processed each payment row. NULL on
--        legacy `manual` / `qbo` rows AND on pre-PR2 `stripe` rows that
--        ran on the platform account.
--     3. `payments.provider_account_id` — nullable text mirror of the
--        provider's own opaque account id (Stripe `acct_...`). Pairs
--        with the FK above so cross-reference with the provider
--        dashboard doesn't require a join.
--     4. `payment_provider_accounts` — one row per (tenant, provider).
--        Holds onboarding lifecycle (charges_enabled / payouts_enabled
--        / requirements_due / disabled_reason / country / currency).
--     5. `payment_payouts` — one row per provider payout event.
--        Mirrors what the provider tells us; we never initiate payouts.
--     6. `payment_disputes` — one row per provider dispute event.
--        Backfillable: payment_id / invoice_id are NULLable so a
--        webhook arriving before the local payment row can land
--        cleanly and be wired up later.
--
--   Provider-neutral by design: every column uses `provider_*` (not
--   `stripe_*`) naming, so a future Adyen / Square / etc. adapter
--   writes to the same tables without a schema migration. The
--   `provider` text column carries the adapter id (today only `stripe`
--   is valid; enforced at the adapter / repo layer, not via DB CHECK
--   so a future provider doesn't require a CHECK update).
--
-- INVARIANTS (enforced by indexes below; service-layer comments in
-- shared/schema.ts):
--   * `(company_id, provider)` UNIQUE on `payment_provider_accounts`
--     — a tenant has at most one account per provider.
--   * `(provider, provider_payout_id)` UNIQUE WHERE NOT NULL on
--     `payment_payouts` — webhook replay collides on this index, the
--     application service classifies SQLSTATE 23505 as "replay" + ACKs
--     200 (same idempotency contract `payments_provider_event_id_uq`
--     established).
--   * `(provider, provider_dispute_id)` UNIQUE WHERE NOT NULL on
--     `payment_disputes` — same pattern as payouts.
--
-- BEHAVIOR CHANGE: NONE.
--   * No checkout flow change.
--   * No webhook handler change.
--   * No service / route / UI change.
--   * Existing rows in `companies` and `payments` keep working
--     bit-identically — every new column is nullable or has a default.
--
-- SAFETY:
--   * `ADD COLUMN ... IF NOT EXISTS` — re-runs as no-op.
--   * `CREATE TABLE IF NOT EXISTS` — same.
--   * `CREATE ... INDEX IF NOT EXISTS` — same.
--   * Safe to run on the test DB. App is in test mode, no production
--     tenants, no real payments — this PR can be re-applied freely.
--   * No existing rows mutated.
--
-- HOW TO RUN:
--   npm run db:migrate:one -- migrations/2026_05_03_tenant_payment_provider_foundation.sql
--
-- ROLLBACK (advisory — safe only on test DB before PR2 ships):
--     ALTER TABLE payments DROP COLUMN IF EXISTS provider_account_id;
--     ALTER TABLE payments DROP COLUMN IF EXISTS payment_provider_account_id;
--     ALTER TABLE companies DROP COLUMN IF EXISTS payment_provider;
--     DROP INDEX IF EXISTS payment_disputes_provider_payment_id_idx;
--     DROP INDEX IF EXISTS payment_disputes_company_created_idx;
--     DROP INDEX IF EXISTS payment_disputes_provider_dispute_id_uq;
--     DROP TABLE IF EXISTS payment_disputes;
--     DROP INDEX IF EXISTS payment_payouts_account_idx;
--     DROP INDEX IF EXISTS payment_payouts_company_arrival_idx;
--     DROP INDEX IF EXISTS payment_payouts_provider_payout_id_uq;
--     DROP TABLE IF EXISTS payment_payouts;
--     DROP INDEX IF EXISTS payment_provider_accounts_provider_account_id_idx;
--     DROP INDEX IF EXISTS payment_provider_accounts_company_provider_uq;
--     DROP TABLE IF EXISTS payment_provider_accounts;
-- ============================================================================

BEGIN;

-- 1. Companies: tenant's chosen payment-collection provider.
ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "payment_provider" text;

-- 2. payment_provider_accounts — one row per (tenant, provider).
CREATE TABLE IF NOT EXISTS "payment_provider_accounts" (
  "id"                    varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id"            varchar NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "provider"              text NOT NULL,
  -- Opaque provider account id (Stripe `acct_...`). NULL until the
  -- provider's `accounts.create` returns (PR2 will mint it).
  "provider_account_id"   text,
  "status"                text NOT NULL DEFAULT 'not_started',
  "charges_enabled"       boolean NOT NULL DEFAULT false,
  "payouts_enabled"       boolean NOT NULL DEFAULT false,
  "details_submitted"     boolean NOT NULL DEFAULT false,
  -- Provider-specific structured payload (Stripe returns nested
  -- currently_due / eventually_due / past_due / pending_verification
  -- arrays). Mirrored whole so the onboarding UI can render the live
  -- remediation list without a second provider round-trip.
  "requirements_due"      jsonb,
  "disabled_reason"       text,
  "default_currency"      text,
  "country"               text,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now()
);

-- One account per (tenant, provider).
CREATE UNIQUE INDEX IF NOT EXISTS "payment_provider_accounts_company_provider_uq"
  ON "payment_provider_accounts" ("company_id", "provider");

-- Webhook resolver hot path: incoming `account.updated` arrives with
-- `acct_...` and needs to find its owning row fast.
CREATE INDEX IF NOT EXISTS "payment_provider_accounts_provider_account_id_idx"
  ON "payment_provider_accounts" ("provider", "provider_account_id");

-- 3. Payments: provider-account attribution columns. Both nullable —
--    legacy `manual` / `qbo` / pre-PR2 `stripe` rows leave them NULL.
ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "payment_provider_account_id" varchar
    REFERENCES "payment_provider_accounts"("id") ON DELETE SET NULL;

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "provider_account_id" text;

-- 4. payment_payouts — provider payout lifecycle.
CREATE TABLE IF NOT EXISTS "payment_payouts" (
  "id"                              varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id"                      varchar NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "provider"                        text NOT NULL,
  "payment_provider_account_id"     varchar NOT NULL REFERENCES "payment_provider_accounts"("id") ON DELETE RESTRICT,
  "provider_account_id"             text NOT NULL,
  -- Opaque provider-issued payout id (Stripe `po_...`). Nullable to
  -- support local-only rows queued before a provider call.
  "provider_payout_id"              text,
  -- Same money convention as `payments.amount` — numeric(12,2). Always
  -- positive (gross transferred-to-bank); reversals are explained via
  -- failure_* fields, not negative amounts.
  "amount"                          numeric(12,2) NOT NULL,
  "currency"                        text NOT NULL,
  "status"                          text NOT NULL,
  "arrival_date"                    timestamptz,
  "destination_last4"               text,
  "failure_code"                    text,
  "failure_message"                 text,
  "raw_provider_status"             text,
  "created_at"                      timestamptz NOT NULL DEFAULT now(),
  "updated_at"                      timestamptz NOT NULL DEFAULT now()
);

-- Webhook replay anchor — partial because provider_payout_id is
-- nullable for the edge-case local-only row.
CREATE UNIQUE INDEX IF NOT EXISTS "payment_payouts_provider_payout_id_uq"
  ON "payment_payouts" ("provider", "provider_payout_id")
  WHERE "provider_payout_id" IS NOT NULL;

-- Tenant + recency index — drives the future Payouts dashboard.
CREATE INDEX IF NOT EXISTS "payment_payouts_company_arrival_idx"
  ON "payment_payouts" ("company_id", "arrival_date");

-- Per-account drilldown.
CREATE INDEX IF NOT EXISTS "payment_payouts_account_idx"
  ON "payment_payouts" ("payment_provider_account_id");

-- 5. payment_disputes — chargeback / dispute lifecycle.
CREATE TABLE IF NOT EXISTS "payment_disputes" (
  "id"                              varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id"                      varchar NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  -- Both refs nullable: webhook can arrive before the local payment row
  -- (race against `charge.refunded` ordering, or standalone disputes
  -- opened from the provider dashboard for unknown payments). Backfill
  -- happens on next match.
  "payment_id"                      varchar REFERENCES "payments"("id") ON DELETE SET NULL,
  "invoice_id"                      varchar REFERENCES "invoices"("id") ON DELETE SET NULL,
  "provider"                        text NOT NULL,
  "payment_provider_account_id"     varchar NOT NULL REFERENCES "payment_provider_accounts"("id") ON DELETE RESTRICT,
  "provider_account_id"             text NOT NULL,
  "provider_dispute_id"             text,
  -- Stripe `ch_...` — the disputed charge. Always populated; lets us
  -- backfill `payment_id` later if the local row arrives out of order.
  "provider_payment_id"             text NOT NULL,
  "amount"                          numeric(12,2) NOT NULL,
  "currency"                        text NOT NULL,
  "status"                          text NOT NULL,
  "reason"                          text,
  "evidence_due_by"                 timestamptz,
  "raw_provider_status"             text,
  "created_at"                      timestamptz NOT NULL DEFAULT now(),
  "updated_at"                      timestamptz NOT NULL DEFAULT now()
);

-- Webhook replay anchor.
CREATE UNIQUE INDEX IF NOT EXISTS "payment_disputes_provider_dispute_id_uq"
  ON "payment_disputes" ("provider", "provider_dispute_id")
  WHERE "provider_dispute_id" IS NOT NULL;

-- Tenant + recency index — drives the future Disputes dashboard.
CREATE INDEX IF NOT EXISTS "payment_disputes_company_created_idx"
  ON "payment_disputes" ("company_id", "created_at");

-- Backfill helper: when a payment row arrives after its dispute, the
-- resolver looks up open disputes by provider_payment_id.
CREATE INDEX IF NOT EXISTS "payment_disputes_provider_payment_id_idx"
  ON "payment_disputes" ("provider", "provider_payment_id");

COMMIT;
