/// <reference lib="webworker" />
/**
 * Syntraro Service Worker (2026-04-21 Phase 1)
 *
 * Moved from generated Workbox SW → injectManifest custom SW so we can
 * add web-push support without losing the existing precache / runtime-cache
 * behavior the app depended on since 2026-04-14.
 *
 * PRESERVED BEHAVIOR (1:1 with the previous generateSW config):
 *   - Precaches all built static assets (via `injectManifest`).
 *   - skipWaiting + clientsClaim so a new deploy activates immediately.
 *   - cleanupOutdatedCaches so stale precache entries from prior builds
 *     are dropped.
 *   - SPA navigateFallback → /index.html, with /api/* denylisted.
 *   - Google Fonts CacheFirst for both stylesheets and webfonts.
 *   - API routes (/api/*) NetworkOnly — never cached.
 *
 * NEW BEHAVIOR:
 *   - `push` listener: parses the payload emitted by the backend and
 *     shows a system notification.
 *   - `notificationclick` listener: focuses an existing Syntraro client
 *     if one is open, or opens a new window on the notification's
 *     deep-link target.
 */

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst, NetworkOnly } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";

// Narrow the global so TS picks up ServiceWorkerGlobalScope members.
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// ---------------------------------------------------------------------------
// Precache + activation (same behavior as previous generateSW config)
// ---------------------------------------------------------------------------

// Injected by vite-plugin-pwa at build time.
precacheAndRoute(self.__WB_MANIFEST ?? []);
cleanupOutdatedCaches();
self.skipWaiting();
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// SPA navigation fallback to /index.html, except for /api/*.
const navigationHandler = createHandlerBoundToURL("/index.html");
registerRoute(
  new NavigationRoute(navigationHandler, {
    denylist: [/^\/api\//],
  }),
);

// ---------------------------------------------------------------------------
// Runtime caching (preserved 1:1 from the previous config)
// ---------------------------------------------------------------------------

// Google Fonts stylesheets — CacheFirst, 1-year TTL.
registerRoute(
  ({ url }) => url.origin === "https://fonts.googleapis.com",
  new CacheFirst({
    cacheName: "google-fonts-stylesheets",
    plugins: [
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  }),
);

// Google Fonts webfont files — CacheFirst, 1-year TTL, opaque-response safe.
registerRoute(
  ({ url }) => url.origin === "https://fonts.gstatic.com",
  new CacheFirst({
    cacheName: "google-fonts-webfonts",
    plugins: [
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
);

// API routes — always network, never cache. SSE + auth go through here.
registerRoute(
  ({ url }) => url.pathname.startsWith("/api/"),
  new NetworkOnly(),
);

// ---------------------------------------------------------------------------
// Push event (2026-04-21 Phase 1)
// ---------------------------------------------------------------------------
//
// Wire shape set by server/services/push/webPushAdapter.ts:
//   { title, body, type, data: { linkUrl, entityType?, entityId?, ... }, tag? }

interface PushPayloadWire {
  title?: string;
  body?: string;
  type?: string;
  data?: Record<string, unknown> & { linkUrl?: string };
  tag?: string;
}

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload: PushPayloadWire = {};
  try {
    payload = event.data.json();
  } catch {
    // If the payload isn't JSON, show a minimal notification rather than
    // dropping the push silently — makes misconfig obvious in the tray.
    payload = { title: "Syntraro", body: event.data.text?.() ?? "" };
  }

  const title = payload.title || "Syntraro";
  const body = payload.body || "";
  const tag = payload.tag;

  // `renotify` is a valid ServiceWorker NotificationOptions field per the
  // spec but isn't in the DOM lib's `NotificationOptions` type. Cast
  // narrowly so we keep the re-alert behavior on reassignment.
  const options = {
    body,
    tag,
    // Replaces any existing notification with the same tag — avoids
    // stacking on rapid reassignment. `renotify: true` additionally
    // re-fires the OS alert so the replacement isn't silent.
    renotify: Boolean(tag),
    // Icons sourced from the manifest set.
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // Carry the full data blob through — the click handler reads it.
    data: payload.data ?? {},
  } as NotificationOptions;

  event.waitUntil(self.registration.showNotification(title, options));
});

// ---------------------------------------------------------------------------
// Notification click (2026-04-21 Phase 1)
// ---------------------------------------------------------------------------
//
// If a Syntraro client is already open, focus it and navigate via postMessage
// (the React router handles the route change). If none is open, open a new
// window directly on the deep-link target.

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl =
    (event.notification.data && (event.notification.data as { linkUrl?: string }).linkUrl) ||
    "/tech/today";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Prefer a controlled Syntraro client at the same origin.
      const sameOrigin = allClients.filter((c) => {
        try {
          return new URL(c.url).origin === self.location.origin;
        } catch {
          return false;
        }
      });

      if (sameOrigin.length > 0) {
        const client = sameOrigin[0];
        try {
          await client.focus();
          // Ask the React app to navigate. App shell can listen for this
          // on `navigator.serviceWorker` to route cleanly; if it doesn't,
          // fall back to a URL change on the client itself.
          client.postMessage({ type: "navigate", url: targetUrl });
          return;
        } catch {
          // fall through to open a new window
        }
      }

      await self.clients.openWindow(targetUrl);
    })(),
  );
});
