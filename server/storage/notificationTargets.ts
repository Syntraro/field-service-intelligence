/**
 * Notification Targets Repository (2026-04-21 Phase 1)
 *
 * Canonical storage layer for push delivery endpoints (one row per
 * browser/device/app install). Sibling to server/storage/notifications.ts
 * which stores the channel-agnostic notification records.
 *
 * Writes are idempotent on (tenant_id, user_id, endpoint) so a PWA that
 * re-registers the same subscription (page reload, re-permission) updates
 * last_seen_at + clears revoked_at instead of creating duplicates.
 */

import { db } from "../db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { notificationTargets, type NotificationTarget } from "@shared/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Input for upsertTarget. `endpoint` is the idempotency key. All other
 * fields are rewritten on conflict.
 */
export interface UpsertTargetInput {
  tenantId: string;
  userId: string;
  platform: "web" | "ios" | "android";
  channel: "web_push" | "native_push";
  provider: "webpush" | "apns" | "fcm";
  endpoint: string;
  keyP256dh?: string | null;
  keyAuth?: string | null;
  userAgent?: string | null;
  appVersion?: string | null;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Return all non-revoked targets for a user. Used by pushDeliveryService
 * when fanning out a single notification to every device the user has
 * currently registered.
 */
export async function listLiveTargetsForUser(
  tenantId: string,
  userId: string,
): Promise<NotificationTarget[]> {
  return db
    .select()
    .from(notificationTargets)
    .where(
      and(
        eq(notificationTargets.tenantId, tenantId),
        eq(notificationTargets.userId, userId),
        isNull(notificationTargets.revokedAt),
      ),
    );
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Idempotent target registration.
 *
 * Conflict target: (tenant_id, user_id, endpoint). If the same browser
 * re-subscribes (permission reset, PWA reinstall, etc.) the existing row
 * is updated in place — last_seen_at is refreshed, revoked_at cleared,
 * and diagnostic fields overwritten. This is the semantic the tech
 * `POST /api/tech/push-subscription` endpoint relies on.
 */
export async function upsertTarget(input: UpsertTargetInput): Promise<NotificationTarget> {
  const now = new Date();
  const row = {
    tenantId: input.tenantId,
    userId: input.userId,
    platform: input.platform,
    channel: input.channel,
    provider: input.provider,
    endpoint: input.endpoint,
    keyP256dh: input.keyP256dh ?? null,
    keyAuth: input.keyAuth ?? null,
    userAgent: input.userAgent ?? null,
    appVersion: input.appVersion ?? null,
  };

  const [result] = await db
    .insert(notificationTargets)
    .values({ ...row, lastSeenAt: now })
    .onConflictDoUpdate({
      target: [
        notificationTargets.tenantId,
        notificationTargets.userId,
        notificationTargets.endpoint,
      ],
      set: {
        platform: row.platform,
        channel: row.channel,
        provider: row.provider,
        keyP256dh: row.keyP256dh,
        keyAuth: row.keyAuth,
        userAgent: row.userAgent,
        appVersion: row.appVersion,
        lastSeenAt: now,
        revokedAt: null, // Clear stale-revocation when a client re-registers the same endpoint.
      },
    })
    .returning();

  return result;
}

/**
 * Mark a target as revoked by endpoint. Called by the WebPushAdapter when
 * the push service returns 404/410 for this endpoint. We do NOT delete —
 * keeping the row preserves the audit trail and makes it cheap to detect
 * churn (lots of revocations from one device = broken client).
 */
export async function revokeTargetByEndpoint(endpoint: string): Promise<void> {
  await db
    .update(notificationTargets)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(notificationTargets.endpoint, endpoint),
        isNull(notificationTargets.revokedAt),
      ),
    );
}

/**
 * Explicit user-initiated revoke by id. Used by the tech DELETE route
 * when a user turns off notifications from inside the PWA. Scoped to
 * (tenantId, userId) to prevent cross-tenant deletion by id.
 */
export async function revokeTargetById(
  tenantId: string,
  userId: string,
  id: string,
): Promise<boolean> {
  const result = await db
    .update(notificationTargets)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(notificationTargets.id, id),
        eq(notificationTargets.tenantId, tenantId),
        eq(notificationTargets.userId, userId),
      ),
    );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Touch last_seen_at after a successful delivery. Lets ops see which
 * endpoints are still active without having to trigger a test push.
 */
export async function markDelivered(id: string): Promise<void> {
  await db
    .update(notificationTargets)
    .set({ lastSeenAt: new Date() })
    .where(eq(notificationTargets.id, id));
}

// ---------------------------------------------------------------------------
// Exported repository object
// ---------------------------------------------------------------------------

export const notificationTargetsRepository = {
  listLiveTargetsForUser,
  upsertTarget,
  revokeTargetByEndpoint,
  revokeTargetById,
  markDelivered,
};
