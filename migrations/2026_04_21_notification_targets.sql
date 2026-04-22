-- 2026_04_21_notification_targets.sql
-- Canonical push-delivery-target registry for the tenant notification system.
--
-- Run instructions:
--   npm run db:migrate:one -- migrations/2026_04_21_notification_targets.sql
--
-- Purpose:
--   The existing `notifications` table (shared/schema.ts:4036-4058) is the
--   canonical user-addressed communication record — channel-agnostic.
--   `notification_targets` is the sibling registry that stores one row per
--   device/browser/app-install a user has registered to receive pushes.
--
--   Splitting target storage from notification storage gives us a clean
--   channel-agnostic model: a single Notification fans out to every
--   non-revoked Target for its recipient. Phase 1 ships a WebPushAdapter
--   only; the table's (platform, channel, provider) triple is shaped so
--   Phase 3 can add APNS/FCM rows with zero schema change.
--
-- Model:
--   platform — "web" | future "ios" | "android"
--   channel  — "web_push" | future "native_push"
--   provider — "webpush" | future "apns" | "fcm"
--   endpoint — web-push subscription URL | future APNS/FCM token
--   key_p256dh / key_auth — web-push only; NULL for native providers
--
-- Uniqueness:
--   A given user may have many browsers/devices. The natural uniqueness
--   is (tenant_id, user_id, endpoint) — the same endpoint can never be
--   registered twice, but the same user can have N endpoints.
--
-- Soft-revoke:
--   Instead of deleting rows on a 410 Gone / 404 response from the push
--   service, we set revoked_at and filter it out on delivery. Keeping
--   revoked rows lets ops + audits see the full device history.

BEGIN;

CREATE TABLE IF NOT EXISTS notification_targets (
  id              varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       varchar NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id         varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform        text NOT NULL,                                   -- "web" (Phase 1) | "ios" | "android" (Phase 3)
  channel         text NOT NULL,                                   -- "web_push" (Phase 1) | "native_push" (Phase 3)
  provider        text NOT NULL,                                   -- "webpush" (Phase 1) | "apns" | "fcm" (Phase 3)
  endpoint        text NOT NULL,                                   -- web-push URL | native device token
  key_p256dh      text,                                            -- web-push only
  key_auth        text,                                            -- web-push only
  user_agent      text,                                            -- diagnostic only (last registering UA)
  app_version     text,                                            -- future native app version
  last_seen_at    timestamp,                                       -- updated on every successful delivery
  revoked_at      timestamp,                                       -- soft-revoke (stale subscription cleanup)
  created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A single endpoint can only belong to one (tenant, user). Upsert-on-endpoint
-- is the registration semantic: if a browser sends the same endpoint again
-- (e.g. on PWA reopen) we update last_seen_at + clear revoked_at rather
-- than inserting a duplicate row.
CREATE UNIQUE INDEX IF NOT EXISTS notification_targets_unique_endpoint_idx
  ON notification_targets (tenant_id, user_id, endpoint);

-- Fan-out lookup: "all non-revoked targets for this user" must be fast.
CREATE INDEX IF NOT EXISTS notification_targets_user_live_idx
  ON notification_targets (tenant_id, user_id)
  WHERE revoked_at IS NULL;

-- Tenant-wide listing (admin / diagnostics).
CREATE INDEX IF NOT EXISTS notification_targets_tenant_idx
  ON notification_targets (tenant_id);

COMMIT;
