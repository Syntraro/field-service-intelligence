-- =====================================================================
-- Migration: 2026-05-07 — Communications Hub Phase 3 — durable threads
-- =====================================================================
-- Adds the durable, provider-neutral conversation model that backs the
-- Communications Hub right-panel + center-stream. Phase 1 ran on mocks;
-- Phase 2 added phone-based contact resolution; Phase 3 ships real
-- persistence so the same UI stops reading from mock fixtures and
-- starts reading from these tables.
--
-- Design decisions
-- ----------------
--   • Tenant-scoped via `company_id` FK (matches the rest of the schema).
--   • Provider-neutral — no vendor-specific field names. The only
--     vendor-issued fields are `provider_message_id` / `provider_call_id`
--     (opaque text) so a future webhook can rejoin a vendor event to our
--     canonical row without leaking adapter shape into the schema.
--   • Visibility metadata on the thread row itself (`scope` +
--     `assigned_user_ids` + `participant_user_ids`) so the read-time
--     access predicate in `shared/communicationsAccess.ts` runs identically
--     against either the Phase 1 mock objects OR a SQL row.
--   • `normalized_phone` precomputed (trailing 10 digits, NANP) so a
--     future inbound webhook routing path can `WHERE normalized_phone = $1`
--     against a hot index instead of regex-stripping every row.
--
-- Run with
-- --------
--   npm run db:migrate:one -- migrations/2026_05_07_communication_threads.sql
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- communication_threads — one row per conversation (left list)
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS communication_threads (
  id                       varchar       PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               varchar       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Type + visibility metadata (the access predicate runs on these)
  thread_type              text          NOT NULL,
  scope                    text          NOT NULL DEFAULT 'office',

  -- Linked canonical entities — every column is nullable; a thread can be
  -- attached to as little as a phone number (unknown inbound) and as much
  -- as the full job/customer/location chain.
  contact_id               varchar       REFERENCES contact_persons(id) ON DELETE SET NULL,
  customer_company_id      varchar       REFERENCES customer_companies(id) ON DELETE SET NULL,
  location_id              varchar       REFERENCES client_locations(id) ON DELETE SET NULL,
  job_id                   varchar       REFERENCES jobs(id) ON DELETE SET NULL,
  -- Team-chat 1:1 anchor (peer user). Group team-chat membership lives
  -- in `participant_user_ids` — this column is populated only on direct
  -- 1:1 team threads as a convenience pointer.
  team_user_id             varchar       REFERENCES users(id) ON DELETE SET NULL,

  -- Phone presentation + canonical match key (NANP trailing-10 form)
  phone_number             text,
  normalized_phone         text,

  -- Display + activity snapshot. `last_message_at` doubles as the list-
  -- ordering column and the cursor for pagination.
  display_name             text,
  last_message_preview     text,
  last_message_at          timestamptz,
  unread_count             integer       NOT NULL DEFAULT 0,

  -- Visibility membership (matches shared/communicationsAccess.ts).
  -- Empty arrays default — `text[]` so we can use Postgres `= ANY(...)`.
  assigned_user_ids        text[]        NOT NULL DEFAULT ARRAY[]::text[],
  participant_user_ids     text[]        NOT NULL DEFAULT ARRAY[]::text[],

  archived_at              timestamptz,

  created_at               timestamptz   NOT NULL DEFAULT NOW(),
  updated_at               timestamptz   NOT NULL DEFAULT NOW(),

  -- Enum-shape guards. We deliberately use CHECK constraints rather than
  -- pg_enum types so adding a value is a one-line migration without an
  -- enum-rebuild dance.
  CONSTRAINT communication_threads_thread_type_chk
    CHECK (thread_type IN ('client_sms', 'team_chat', 'unknown')),
  CONSTRAINT communication_threads_scope_chk
    CHECK (scope IN ('tech_visible', 'office', 'tenant_global'))
);

-- List ordering — the `/api/communications/threads` endpoint always
-- orders by last_message_at DESC, scoped to a tenant.
CREATE INDEX IF NOT EXISTS idx_comm_threads_tenant_last_msg
  ON communication_threads (company_id, last_message_at DESC NULLS LAST);

-- Phone routing — a future inbound webhook will look up "which thread
-- does this number belong to?" via this index.
CREATE INDEX IF NOT EXISTS idx_comm_threads_tenant_phone
  ON communication_threads (company_id, normalized_phone)
  WHERE normalized_phone IS NOT NULL;

-- Tech visibility — assigned_user_ids array containment. Postgres can
-- use a GIN index for `= ANY(assigned_user_ids)` patterns.
CREATE INDEX IF NOT EXISTS idx_comm_threads_assigned_user_ids
  ON communication_threads USING GIN (assigned_user_ids);
CREATE INDEX IF NOT EXISTS idx_comm_threads_participant_user_ids
  ON communication_threads USING GIN (participant_user_ids);

-- ─────────────────────────────────────────────────────────────────────
-- communication_messages — message stream within a thread
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS communication_messages (
  id                       varchar       PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               varchar       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  thread_id                varchar       NOT NULL REFERENCES communication_threads(id) ON DELETE CASCADE,

  direction                text          NOT NULL,
  channel                  text          NOT NULL,

  body                     text          NOT NULL,
  provider_message_id      text,

  sender_user_id           varchar       REFERENCES users(id) ON DELETE SET NULL,
  -- Snapshotted at write time so historical rows survive a sender rename.
  sender_display_name      text,

  from_number              text,
  to_number                text,
  status                   text,

  created_at               timestamptz   NOT NULL DEFAULT NOW(),

  CONSTRAINT communication_messages_direction_chk
    CHECK (direction IN ('inbound', 'outbound', 'internal')),
  CONSTRAINT communication_messages_channel_chk
    CHECK (channel IN ('sms', 'internal_note', 'team_chat', 'voicemail', 'system')),
  CONSTRAINT communication_messages_status_chk
    CHECK (status IS NULL OR status IN ('queued', 'sent', 'delivered', 'failed', 'read'))
);

-- Stream ordering for `/threads/:id/messages` (oldest → newest).
CREATE INDEX IF NOT EXISTS idx_comm_messages_thread_created
  ON communication_messages (thread_id, created_at);

-- Tenant-wide message scans (debug, future search). Cheap to keep.
CREATE INDEX IF NOT EXISTS idx_comm_messages_tenant_created
  ON communication_messages (company_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- communication_calls — call history rows
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS communication_calls (
  id                       varchar       PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               varchar       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  thread_id                varchar       REFERENCES communication_threads(id) ON DELETE SET NULL,

  direction                text          NOT NULL,
  from_number              text,
  to_number                text,
  status                   text          NOT NULL,

  duration_seconds         integer,
  recording_url            text,
  transcription            text,
  provider_call_id         text,

  created_at               timestamptz   NOT NULL DEFAULT NOW(),

  CONSTRAINT communication_calls_direction_chk
    CHECK (direction IN ('inbound', 'outbound')),
  CONSTRAINT communication_calls_status_chk
    CHECK (status IN ('completed', 'missed', 'voicemail', 'in_progress', 'failed'))
);

-- Default call-history listing surface — newest first per tenant.
CREATE INDEX IF NOT EXISTS idx_comm_calls_tenant_created
  ON communication_calls (company_id, created_at DESC);

-- Per-thread call lookup (right panel timeline can union calls + messages).
CREATE INDEX IF NOT EXISTS idx_comm_calls_thread_created
  ON communication_calls (thread_id, created_at DESC)
  WHERE thread_id IS NOT NULL;
