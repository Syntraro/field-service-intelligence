-- ============================================================================
-- 2026-05-04 — Tenant deletion requests (4-phase secure teardown).
--
-- WHY:
--   Replaces the prior "direct delete" model with an auditable, two-actor,
--   time-delayed workflow. No single platform user can hard-delete a tenant
--   alone: an initiator creates a Request bound to a fresh preview hash, a
--   different user with `platform:tenant_teardown_approve` capability
--   approves it, and a background worker executes the cascade only after
--   the configured intervention window AND only when the live preview hash
--   still matches the snapshot.
--
-- DESIGN NOTES:
--   • `company_id` is a plain varchar (NO foreign key). The cascade-delete
--     of the company at execution time would otherwise destroy the audit
--     row that proves who initiated/approved the deletion. The whole point
--     of this table is to OUTLIVE the company.
--   • `preview_hash` is the deterministic SHA-256 of the dry-run preview
--     payload at request time. The worker recomputes it before delete and
--     refuses if it drifted (e.g. someone added invoices in the gap).
--   • `preview_payload_json` is the exact snapshot the initiator approved.
--     Stored both for the worker's hash recomputation AND for forensic
--     audit ("what state did the tenant have when the request was filed?").
--   • Status enum enforced by CHECK constraint — Postgres `text` keeps
--     migration / drop ergonomics simple while still rejecting drift.
--
-- SAFETY:
--   • `CREATE TABLE IF NOT EXISTS` — re-runs are no-ops.
--   • `CREATE INDEX IF NOT EXISTS` — same.
--   • No existing rows mutated; this is a wholly new surface.
--
-- HOW TO RUN:
--   npm run db:migrate:one -- migrations/2026_05_04_tenant_deletion_requests.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS "tenant_deletion_requests" (
  "id"                          varchar PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant target. Plain varchar — NO FK. The company is hard-deleted at
  -- execution time and we MUST keep this row.
  "company_id"                  varchar NOT NULL,
  "company_name_snapshot"       text NOT NULL,
  "company_email_snapshot"      text,

  -- Preview binding. `preview_hash` is the canonical SHA-256 of
  -- `preview_payload_json`; the worker recomputes it before deleting and
  -- refuses on mismatch.
  "preview_hash"                text NOT NULL,
  "preview_payload_json"        jsonb NOT NULL,

  -- Actors. `initiated_by_user_id` and `approved_by_user_id` are plain
  -- varchars (NO FK to users) so the row survives if those users are
  -- later removed. Email + role snapshots are kept on the audit_logs row
  -- already; here we only need the ids for the "different actor" check.
  "initiated_by_user_id"        varchar NOT NULL,
  "initiated_by_email"          text NOT NULL,
  "approved_by_user_id"         varchar,
  "approved_by_email"           text,

  -- Required reason (min length enforced at the service layer; this
  -- table accepts NOT NULL only).
  "reason"                      text NOT NULL,

  -- State machine: pending → approved → executing → completed
  --                              ↘ cancelled / expired
  --                              ↘ failed (terminal)
  "status"                      text NOT NULL DEFAULT 'pending',
  "failure_reason"              text,

  -- Timeline.
  "created_at"                  timestamptz NOT NULL DEFAULT now(),
  "expires_at"                  timestamptz NOT NULL,
  "approved_at"                 timestamptz,
  "execution_scheduled_at"      timestamptz,
  "executed_at"                 timestamptz,
  "cancelled_at"                timestamptz,
  "cancelled_by_user_id"        varchar,
  "cancelled_by_email"          text,

  -- Environment + request fingerprint. Kept for forensic audit; never
  -- driving authorization logic.
  "environment_snapshot"        jsonb,
  "request_ip"                  text,
  "request_user_agent"          text,

  CONSTRAINT "tenant_deletion_requests_status_chk" CHECK (
    "status" IN (
      'pending', 'approved', 'executing', 'completed',
      'cancelled', 'expired', 'failed'
    )
  )
);

-- Hot paths.
CREATE INDEX IF NOT EXISTS "tenant_deletion_requests_company_id_idx"
  ON "tenant_deletion_requests" ("company_id");
CREATE INDEX IF NOT EXISTS "tenant_deletion_requests_status_idx"
  ON "tenant_deletion_requests" ("status");
-- Worker hot path: "find pending rows whose expires_at has passed".
CREATE INDEX IF NOT EXISTS "tenant_deletion_requests_expires_at_idx"
  ON "tenant_deletion_requests" ("expires_at")
  WHERE "status" IN ('pending', 'approved');

-- Rate-limit invariant: at most ONE active request per tenant at a time.
-- Active = pending OR approved OR executing. Once the request lands in a
-- terminal state (completed/cancelled/expired/failed) a new one can be
-- filed.
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_deletion_requests_one_active_per_tenant_uq"
  ON "tenant_deletion_requests" ("company_id")
  WHERE "status" IN ('pending', 'approved', 'executing');

COMMIT;
