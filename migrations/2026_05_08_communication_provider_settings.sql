-- 2026-05-08 Phase 5: provider-neutral SMS infrastructure foundation.
--
-- One row per (tenant, provider) carries the per-tenant phone-provider
-- credential needed to send SMS, plus the webhook secret used to verify
-- inbound signatures. Credentials + webhook secret are encrypted at rest
-- with AES-256-GCM (key sourced from `COMMUNICATION_CREDENTIAL_KEY` env
-- var, 32-byte base64). Encryption helpers live in
-- `server/services/communications/providerCredentialCrypto.ts`.
--
-- Why a dedicated table (vs reusing a generic integrations table):
--   * No `integrations` master table exists in this codebase today;
--     each integration owns its own table (QBO, Resend, etc.).
--   * Phone-provider credentials have a different access pattern than
--     OAuth integrations — they're a long-lived tenant-master shared
--     secret rather than an auto-rotating user OAuth token. They also
--     need to be reachable from a webhook handler that has no user
--     session, so a small purpose-built table keeps the lookup simple.
--
-- One-active-per-tenant invariant:
--   * The partial unique index `idx_comm_provider_settings_one_active_per_tenant`
--     enforces "at most one row with `is_active = true` per company" at
--     the database layer. Inserting a second active row for a tenant
--     fails with a unique violation; the storage layer surfaces a
--     friendly error.
--
-- Run via:
--   npm run db:migrate:one -- migrations/2026_05_08_communication_provider_settings.sql

CREATE TABLE IF NOT EXISTS communication_provider_settings (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id varchar NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Discriminated provider id — kept text rather than enum so adding a
  -- new provider in the TS union doesn't require a coordinated SQL
  -- migration. Server-side validation rejects unknown ids.
  provider_id text NOT NULL,

  -- Tenant's phone number on the provider (E.164 preferred). Stored
  -- raw for display + normalized for lookup. Both are populated on
  -- insert/update so neither view nor webhook handler has to renormalize.
  phone_number text NOT NULL,
  normalized_phone text NOT NULL,

  is_active boolean NOT NULL DEFAULT false,

  -- Account identifier (e.g., Twilio Account SID). NOT a secret on its
  -- own — pairing it with the encrypted auth token is what authenticates.
  -- Stored plaintext so the storage layer can show it back to the
  -- admin UI without a decrypt round-trip.
  account_identifier text,

  -- Encrypted credential blob (the auth token / API key). AES-256-GCM
  -- ciphertext + IV + auth tag, all base64. Decryption only at
  -- send time inside the provider adapter; never returned to client.
  encrypted_credential text NOT NULL,
  credential_iv text NOT NULL,
  credential_tag text NOT NULL,

  -- Encrypted webhook secret (the value used by `verifyWebhook` to
  -- confirm that inbound provider POSTs are authentic). Stored
  -- separately from the credential so credential rotation and webhook
  -- secret rotation don't have to be coordinated.
  encrypted_webhook_secret text NOT NULL,
  webhook_secret_iv text NOT NULL,
  webhook_secret_tag text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Active-per-tenant lookup. Used by:
--   * outbound SMS route: "find the active provider settings for this tenant"
--   * inbound webhook: "this providerId hit our endpoint, find the
--     active settings so we can verify signature with its secret"
CREATE UNIQUE INDEX IF NOT EXISTS idx_comm_provider_settings_one_active_per_tenant
  ON communication_provider_settings (company_id)
  WHERE is_active = true;

-- Companion lookup index (non-unique) for the inbound-webhook flow that
-- joins on `(company_id, provider_id)`. The partial unique above only
-- helps when you already know `is_active=true`; this index helps when
-- the route is iterating the small set of provider rows for a tenant.
CREATE INDEX IF NOT EXISTS idx_comm_provider_settings_company_provider
  ON communication_provider_settings (company_id, provider_id);

-- Status webhook lookup needs `(company_id, provider_message_id)` on
-- communication_messages so the route can update the right row in one
-- query. The base table has tenant + thread indexes already; this one
-- is the missing piece for the status flow.
CREATE INDEX IF NOT EXISTS idx_comm_messages_tenant_provider_msg
  ON communication_messages (company_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
