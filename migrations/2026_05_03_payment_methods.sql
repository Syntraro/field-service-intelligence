-- ============================================================================
-- 2026-05-03 — provider-neutral saved payment methods (PR A).
--
-- WHY:
--   Foundation for the customer-portal saved-card feature. Adds:
--     1. `customer_companies.provider_customer_id` — opaque token issued
--        by whichever payment provider the tenant uses (Stripe today,
--        future providers possible). Holds the provider's own
--        Customer-object id; lazily minted by the resolver on first
--        save-card request and reused thereafter.
--     2. `payment_methods` table — one row per saved card, tenant +
--        customer-company scoped. Stores ONLY the metadata the
--        provider returns (card_brand / last4 / exp_*); raw card
--        numbers + CVV NEVER touch this table by design.
--
--   Deliberately provider-neutral column names (`provider_source`,
--   `provider_customer_id`, `provider_payment_method_id`) so a future
--   non-Stripe adapter (e.g. Adyen, Square) can write to the same
--   table without a schema migration.
--
-- INVARIANTS (enforced by indexes below — see also repo guards in
-- server/storage/paymentMethods.ts):
--   * `(company_id, provider_source, provider_payment_method_id)` is
--     UNIQUE — webhook replay collides on this index, the application
--     service classifies SQLSTATE 23505 as "replay" + ACKs 200 (same
--     idempotency contract PR 1's `payments_provider_event_id_uq`
--     established).
--   * At most ONE active default per (company_id, customer_company_id)
--     — partial unique index excludes detached rows so the soft-delete
--     of an old default doesn't block setting a new one.
--   * `(company_id, provider_customer_id)` on customer_companies is
--     UNIQUE — prevents two tenants from claiming the same provider
--     Customer id (defence-in-depth on top of the row-level
--     companyId filters every read enforces).
--
-- SAFETY:
--   * `ADD COLUMN ... IF NOT EXISTS` — re-runs as no-op.
--   * `CREATE TABLE IF NOT EXISTS` — same.
--   * `CREATE ... INDEX IF NOT EXISTS` — same.
--   * No existing rows mutated. Existing payment paths + portal flow
--     keep working bit-identically — this PR is schema-only.
--
-- HOW TO RUN:
--   npm run db:migrate:one -- migrations/2026_05_03_payment_methods.sql
--
-- ROLLBACK (advisory — safe only if no payment_methods rows exist yet):
--     DROP INDEX IF EXISTS payment_methods_lookup_idx;
--     DROP INDEX IF EXISTS payment_methods_one_default_per_customer;
--     DROP INDEX IF EXISTS payment_methods_provider_pm_uq;
--     DROP TABLE IF EXISTS payment_methods;
--     DROP INDEX IF EXISTS customer_companies_company_provider_customer_id_uq;
--     ALTER TABLE customer_companies DROP COLUMN IF EXISTS provider_customer_id;
-- ============================================================================

BEGIN;

-- 1. Provider-neutral customer reference on customer_companies.
ALTER TABLE "customer_companies"
  ADD COLUMN IF NOT EXISTS "provider_customer_id" text;

-- Tenant-scoped uniqueness — partial because the column is NULLable
-- (most legacy rows will stay NULL forever; only customer_companies
-- whose customers actually save a card get one minted).
CREATE UNIQUE INDEX IF NOT EXISTS "customer_companies_company_provider_customer_id_uq"
  ON "customer_companies" ("company_id", "provider_customer_id")
  WHERE "provider_customer_id" IS NOT NULL;

-- 2. payment_methods table — one row per saved card.
CREATE TABLE IF NOT EXISTS "payment_methods" (
  "id"                          varchar PRIMARY KEY DEFAULT gen_random_uuid(),

  "company_id"                  varchar NOT NULL REFERENCES "companies"("id")            ON DELETE CASCADE,
  "customer_company_id"         varchar NOT NULL REFERENCES "customer_companies"("id")   ON DELETE CASCADE,

  -- Provider attribution. `provider_source` is the same enum the
  -- payments table uses ("manual", "qbo", "stripe") — but only
  -- `stripe` is meaningful here today; other providers join the same
  -- table when they ship.
  "provider_source"             text NOT NULL,
  "provider_customer_id"        text NOT NULL,
  "provider_payment_method_id"  text NOT NULL,

  -- Card metadata mirrored from the provider's PaymentMethod object.
  -- These are SAFE to mirror locally (they are public-facing details
  -- the customer sees on their statement). Raw PAN + CVV stay at the
  -- provider — they NEVER touch our DB.
  "card_brand"                  text NOT NULL,
  "card_last4"                  text NOT NULL,
  "card_exp_month"              integer NOT NULL,
  "card_exp_year"               integer NOT NULL,
  "card_funding"                text,
  "card_country"                text,

  "is_default"                  boolean NOT NULL DEFAULT false,

  -- Consent capture — every row was explicitly authorized by the
  -- customer at save-time. Storing the verbatim copy + IP + UA makes
  -- consent auditable when a regulator asks "what did the customer
  -- agree to?".
  "consent_at"                  timestamptz NOT NULL,
  "consent_text"                text NOT NULL,
  "consent_ip"                  text,
  "consent_user_agent"          text,
  "created_by_contact_id"       varchar REFERENCES "contact_persons"("id") ON DELETE SET NULL,

  -- Soft-delete: provider-side detach happens at delete time, the row
  -- stays for forensic / audit queries. `detached_at IS NULL` = active.
  "detached_at"                 timestamptz,
  "detached_by_contact_id"      varchar REFERENCES "contact_persons"("id") ON DELETE SET NULL,
  "detach_reason"               text,

  "created_at"                  timestamptz NOT NULL DEFAULT now(),
  "updated_at"                  timestamptz NOT NULL DEFAULT now()
);

-- Webhook replay anchor — see header invariant note.
CREATE UNIQUE INDEX IF NOT EXISTS "payment_methods_provider_pm_uq"
  ON "payment_methods" ("company_id", "provider_source", "provider_payment_method_id");

-- At-most-one active default per (tenant, customer-company). Partial
-- so detached rows don't block the next default flip.
CREATE UNIQUE INDEX IF NOT EXISTS "payment_methods_one_default_per_customer"
  ON "payment_methods" ("company_id", "customer_company_id")
  WHERE "is_default" = true AND "detached_at" IS NULL;

-- Hot-path lookup index for the portal "list my saved cards" screen.
CREATE INDEX IF NOT EXISTS "payment_methods_lookup_idx"
  ON "payment_methods" ("company_id", "customer_company_id", "detached_at");

COMMIT;
