/**
 * usePushRegistration (2026-04-21 Phase 1)
 *
 * Tech-app hook for the web-push subscription lifecycle.
 *
 * Responsibilities:
 *   - Detect browser support (Notification + PushManager + ServiceWorker).
 *   - Expose current `Notification.permission` in a React-reactive way.
 *   - `requestAndSubscribe()` — ask for permission, subscribe to PushManager
 *     with the server's VAPID key, POST the subscription to the backend.
 *     Idempotent: re-subscribing an already-subscribed browser is a no-op
 *     because `/api/tech/push/subscription` upserts on endpoint.
 *   - `unsubscribe()` — reverse: unsubscribe locally + DELETE on backend.
 *
 * NON-responsibilities:
 *   - No auto-prompting. The caller decides when to ask. We do NOT ambush
 *     the user on mount.
 *   - No toast/UI. The caller shows whatever feedback it wants.
 */

import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/queryClient";

// ---------------------------------------------------------------------------
// Support + permission detection
// ---------------------------------------------------------------------------

function detectSupport(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function readPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a base64url VAPID public key into the Uint8Array shape
 * `pushManager.subscribe({ applicationServerKey })` requires.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface PushRegistrationState {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  /** True if this browser has an active PushSubscription right now. */
  subscribed: boolean;
  /** True while request/subscribe/unsubscribe is in flight. */
  busy: boolean;
  /** Last error message surfaced by the hook (e.g. server 503). */
  error: string | null;
}

export interface UsePushRegistrationResult extends PushRegistrationState {
  requestAndSubscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<boolean>;
  refresh: () => Promise<void>;
}

export function usePushRegistration(): UsePushRegistrationResult {
  const [supported] = useState<boolean>(() => detectSupport());
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() =>
    readPermission(),
  );
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Read current subscription state on mount and when permission changes.
  const refresh = useCallback(async () => {
    if (!supported) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const current = await reg.pushManager.getSubscription();
      setSubscribed(Boolean(current));
    } catch {
      setSubscribed(false);
    }
  }, [supported]);

  useEffect(() => {
    void refresh();
  }, [refresh, permission]);

  // ── Main action: permission → subscribe → POST to backend.
  const requestAndSubscribe = useCallback(async (): Promise<boolean> => {
    if (!supported) {
      setError("Your browser does not support push notifications.");
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      // 1) Permission — if already granted, this resolves instantly.
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        setError(perm === "denied" ? "Notification permission was denied." : "Permission prompt dismissed.");
        return false;
      }

      // 2) Pull VAPID public key. The server may return { enabled: false }
      //    when push is disabled at the deployment level.
      const keyRes = await apiRequest<{ enabled: boolean; publicKey?: string }>(
        "/api/tech/push/public-key",
      );
      if (!keyRes.enabled || !keyRes.publicKey) {
        setError("Push notifications are not enabled on this server.");
        return false;
      }

      // 3) Subscribe via PushManager. If a subscription already exists on
      //    this browser it's reused — idempotent.
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const subscription =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyRes.publicKey),
        }));

      // 4) Register with backend. Upsert on endpoint → safe to repeat.
      const raw = subscription.toJSON() as {
        endpoint: string;
        keys?: { p256dh?: string; auth?: string };
      };
      if (!raw.endpoint || !raw.keys?.p256dh || !raw.keys?.auth) {
        setError("Browser returned an incomplete subscription.");
        return false;
      }
      await apiRequest("/api/tech/push/subscription", {
        method: "POST",
        body: JSON.stringify({
          endpoint: raw.endpoint,
          keys: { p256dh: raw.keys.p256dh, auth: raw.keys.auth },
          userAgent: navigator.userAgent.slice(0, 512),
        }),
      });

      setSubscribed(true);
      return true;
    } catch (err: any) {
      const msg = err?.message ?? "Failed to enable notifications.";
      setError(msg);
      return false;
    } finally {
      setBusy(false);
    }
  }, [supported]);

  // ── Reverse: unsubscribe locally + tell the backend.
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!supported) return false;
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const current = await reg.pushManager.getSubscription();
      if (current) {
        await current.unsubscribe();
      }
      // Backend soft-revoke happens server-side on next 410 from the push
      // service. We don't have the target.id client-side to DELETE by id
      // explicitly; leaving that as a v2 refinement (the /api/tech/push/
      // subscription/:id route exists for that flow when we surface a
      // "Manage devices" UI).
      setSubscribed(false);
      return true;
    } catch (err: any) {
      setError(err?.message ?? "Failed to disable notifications.");
      return false;
    } finally {
      setBusy(false);
    }
  }, [supported]);

  return {
    supported,
    permission,
    subscribed,
    busy,
    error,
    requestAndSubscribe,
    unsubscribe,
    refresh,
  };
}
