/**
 * Web Push Adapter (2026-04-21 Phase 1)
 *
 * Implements DeliveryAdapter for the standard Web Push Protocol (RFC 8030)
 * using the `web-push` npm package. Phase 1 is the only adapter shipped;
 * APNS / FCM will be added in Phase 3 as peer modules behind the same
 * interface.
 *
 * VAPID keys are read from process.env at module load:
 *   VAPID_PUBLIC_KEY    — base64url-encoded public application server key
 *   VAPID_PRIVATE_KEY   — base64url-encoded private key
 *   VAPID_SUBJECT       — `mailto:ops@example.com` or `https://example.com`
 *                         (optional, defaults to the Resend from-email so
 *                          we reuse the existing configured contact surface)
 *
 * To generate keys in a dev shell:
 *   npx web-push generate-vapid-keys
 *
 * Failure modes handled:
 *   - Missing VAPID config → log + return `{ ok: false }` for every call so
 *     assignment requests never fail because of push misconfiguration.
 *   - 404 / 410 from the push service → `{ ok: false, revoke: true }` so the
 *     service layer soft-revokes the stale target.
 *   - Any other error → `{ ok: false, error }` without revoke (transient).
 */

import webPush from "web-push";
import type { NotificationTarget } from "@shared/schema";
import type { DeliveryAdapter, DeliveryResult, PushPayload } from "./types";

// ---------------------------------------------------------------------------
// VAPID config (module-scoped, read once at import time)
// ---------------------------------------------------------------------------

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY?.trim() || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY?.trim() || "";
const VAPID_SUBJECT =
  process.env.VAPID_SUBJECT?.trim() ||
  (process.env.RESEND_FROM_EMAIL?.trim()
    ? `mailto:${process.env.RESEND_FROM_EMAIL.trim()}`
    : "");

let configured = false;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  try {
    webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configured = true;
  } catch (err) {
    console.error("[webPushAdapter] Failed to configure VAPID:", err);
  }
} else {
  // Intentionally logged as a warning, not an error. Push is additive — the
  // rest of the app must work fine without it configured (e.g. local dev,
  // CI runs). Every deliver() call returns ok=false; nothing crashes.
  console.warn(
    "[webPushAdapter] Disabled — missing VAPID config. " +
      "Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and (optionally) VAPID_SUBJECT to enable push.",
  );
}

// ---------------------------------------------------------------------------
// Exposed helper: public key for the client to subscribe with
// ---------------------------------------------------------------------------

export function getPublicVapidKey(): string | null {
  return configured ? VAPID_PUBLIC_KEY : null;
}

export function isWebPushConfigured(): boolean {
  return configured;
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

export const webPushAdapter: DeliveryAdapter = {
  provider: "webpush",

  async deliver(payload: PushPayload, target: NotificationTarget): Promise<DeliveryResult> {
    if (!configured) {
      return { ok: false, error: "web_push_not_configured" };
    }

    // Guard: the target must have the web-push crypto keys. A row lacking
    // them is malformed (should never happen — upsert enforces the shape
    // from the registration route) but we fail soft rather than throw.
    if (!target.endpoint || !target.keyP256dh || !target.keyAuth) {
      return {
        ok: false,
        revoke: true,
        error: "missing_web_push_keys",
      };
    }

    const subscription = {
      endpoint: target.endpoint,
      keys: {
        p256dh: target.keyP256dh,
        auth: target.keyAuth,
      },
    };

    // Wire shape the service worker's `push` event parses.
    const wireBody = JSON.stringify({
      title: payload.title,
      body: payload.body,
      type: payload.type,
      data: payload.data,
      tag: payload.tag,
    });

    try {
      await webPush.sendNotification(subscription, wireBody, {
        // 4 hours. The push service caches until TTL; if the device is
        // offline longer than that the notification is dropped silently.
        TTL: 60 * 60 * 4,
        urgency: "normal",
      });
      return { ok: true, statusCode: 201 };
    } catch (err: any) {
      const statusCode: number | undefined = err?.statusCode;

      // 404 = endpoint not found; 410 = gone. Either way the subscription
      // is permanently dead and must be revoked.
      if (statusCode === 404 || statusCode === 410) {
        return {
          ok: false,
          revoke: true,
          statusCode,
          error: `stale_subscription_${statusCode}`,
        };
      }

      // 413 (payload too large) is our fault — log loudly so payload bloat
      // gets caught in staging, but don't revoke the target.
      if (statusCode === 413) {
        console.error("[webPushAdapter] payload too large", {
          endpoint: target.endpoint,
          bodyLength: wireBody.length,
        });
      }

      return {
        ok: false,
        statusCode,
        error: err?.body ?? err?.message ?? "unknown_web_push_error",
      };
    }
  },
};
