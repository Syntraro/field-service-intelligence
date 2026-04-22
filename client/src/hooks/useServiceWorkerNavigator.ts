/**
 * useServiceWorkerNavigator (2026-04-21 Phase 1.1)
 *
 * Bridges the custom service worker's `notificationclick` postMessage
 * (`{ type: "navigate", url }`, emitted by client/src/sw.ts) to the
 * React app's router. Mount ONCE at the app shell level so every
 * authenticated surface (office + tech) picks up the navigation.
 *
 * Behavior:
 *   - If the app is already open when a notification is clicked, the
 *     SW focuses an existing client and posts `{ type: "navigate", url }`.
 *     This hook consumes that and routes via wouter's `setLocation` — a
 *     smooth in-SPA route change, no reload.
 *   - If the app is closed, the SW's `clients.openWindow(url)` fallback
 *     opens a new tab directly on the target route. This hook is not
 *     involved in that path — there is no duplicate-navigation risk.
 *   - The already-on-target guard (`url === current`) prevents a loop if
 *     the SW (or a future caller) rebroadcasts the same message.
 *
 * Security:
 *   - Only absolute same-origin paths (starting with `/`) are accepted.
 *     Any payload missing `url` or carrying a non-string URL is ignored.
 *   - This hook never trusts anything outside the canonical SW contract;
 *     it does not follow fragments or external origins.
 */

import { useEffect } from "react";
import { useLocation } from "wouter";

export function useServiceWorkerNavigator(): void {
  const [current, setLocation] = useLocation();

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const handler = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      if (!data || typeof data !== "object") return;
      if (data.type !== "navigate") return;
      if (typeof data.url !== "string") return;
      const url = data.url;
      // Same-origin path gate — refuse anything that isn't an absolute
      // path on our own origin (no protocol, no domain).
      if (!url.startsWith("/")) return;
      // Loop guard — already on the target URL means nothing to do.
      if (url === current) return;
      setLocation(url);
    };

    navigator.serviceWorker.addEventListener("message", handler);
    return () => {
      navigator.serviceWorker.removeEventListener("message", handler);
    };
  }, [current, setLocation]);
}
