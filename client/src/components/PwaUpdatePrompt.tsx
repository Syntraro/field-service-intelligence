/**
 * PWA registration + auto-reload on deploy (2026-04-14, hardened 2026-04-26,
 * 2026-04-30 Balanced fix).
 *
 * Paired with `registerType: "autoUpdate"` + `skipWaiting` + `clientsClaim`
 * in vite.config.ts and the NetworkFirst navigation strategy in
 * `client/src/sw.ts`. The complete flow is:
 *
 *   1. A new deploy ships a new SW + new index.html. The next navigation
 *      hits the network (NetworkFirst) and immediately renders the new
 *      shell, so users see fresh UI on every refresh/cold-launch when
 *      online.
 *   2. The browser also discovers the new SW on next page load, on the
 *      hourly `registration.update()` poll, on every `visibilitychange`
 *      to "visible", and on the `online` event.
 *   3. The new SW installs, skips waiting, and claims the existing client.
 *   4. `navigator.serviceWorker.controller` changes — we perform a single
 *      hard reload so the tab re-bootstraps against the NEW chunks. This
 *      is gated by a build-aware guard (see RELOAD_BUILD_KEY below) so
 *      a SECOND deploy in the same tab session ALSO triggers a reload —
 *      the prior boolean guard wedged the tab on the old in-memory
 *      bundle if the user kept it open across multiple deploys.
 *
 * Build-aware reload guard:
 *   - `__SYNTRARO_BUILD__` is injected at build time by
 *     `vite.config.ts::syntraroBuildIdPlugin` (git short SHA, with a
 *     timestamp fallback).
 *   - When `controllerchange` fires, we compare the page's current
 *     build ID against the one we last reloaded for; we reload iff
 *     they differ. A 10s rate-limit on top is a defense-in-depth
 *     against any pathological loop where build IDs disagree but
 *     content doesn't.
 *
 * Update-check triggers (in addition to the SW's own 24h check):
 *   - Initial registration (`immediate: true`).
 *   - Hourly `setInterval` for long-lived foreground tabs.
 *   - `visibilitychange` to "visible" — bridges iPad PWA suspension.
 *   - `online` event — covers the "left a tunnel / re-joined Wi-Fi"
 *     case where visibility never changed but the network came back.
 *
 * Secondary "Update available" banner:
 *   - Appears only if a `waiting` worker has been around for more than
 *     5 seconds without auto-claiming the page. Rare in practice now
 *     that NetworkFirst fronts the navigation; kept as belt-and-
 *     suspenders for the iOS-PWA-parked-SW edge case.
 */
import { useEffect, useState } from "react";

const loadModule = new Function("m", "return import(m)") as (id: string) => Promise<any>;
// Stores the build ID for which the last full-page reload occurred —
// makes `controllerchange` reloads idempotent per build but allows a
// future deploy in the same tab session to reload again. Replaces the
// pre-2026-04-30 `__syntraro_sw_reloaded__` boolean flag, which kept
// long-lived tabs stuck on stale bundles after the second deploy.
const RELOAD_BUILD_KEY = "__syntraro_sw_last_reload_build__";
// Hard floor on reload cadence — prevents tight loops if build IDs
// somehow disagree (e.g., meta tag missing). 10s is comfortably above
// any legitimate post-deploy reload latency.
const RELOAD_AT_KEY = "__syntraro_sw_last_reload_at__";
const MIN_RELOAD_INTERVAL_MS = 10_000;
const WAITING_GRACE_MS = 5000;

/**
 * Read the current build ID — preferring the runtime-injected window
 * global (set by an inline `<script>` in index.html before any module
 * code runs), with a meta-tag fallback. Returns `null` if neither is
 * present (dev server, malformed HTML, etc.) — callers degrade to the
 * rate-limit guard alone.
 */
function getCurrentBuildId(): string | null {
  if (typeof window !== "undefined" && typeof window.__SYNTRARO_BUILD__ === "string" && window.__SYNTRARO_BUILD__) {
    return window.__SYNTRARO_BUILD__;
  }
  if (typeof document !== "undefined") {
    const meta = document.querySelector('meta[name="build-id"]');
    const content = meta?.getAttribute("content");
    if (content) return content;
  }
  return null;
}

export function PwaUpdatePrompt() {
  // Secondary fallback — see the file-level comment. Auto-reload via
  // controllerchange is the primary path; this banner only renders if
  // a `waiting` worker has been present for >= WAITING_GRACE_MS.
  const [needsRefresh, setNeedsRefresh] = useState(false);
  // Captured once registerSW returns so the banner button can call it.
  const [updater, setUpdater] = useState<((reloadPage?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    // Build-aware auto-reload guard. `controllerchange` fires when the
    // SW takes control of an existing client. We allow ONE reload per
    // distinct build, with a 10s rate-limit floor as a loop trap.
    //
    //   • Different build than the one we last reloaded for → reload.
    //   • Same build as last reload → suppress (already did this dance).
    //   • Reloaded < 10s ago regardless of build → suppress (loop trap).
    //
    // The previous boolean flag was set permanently for the tab session,
    // so a SECOND deploy in the same long-lived tab silently failed to
    // reload — the user sat on the new SW + old in-memory React bundle
    // and any lazy chunk fetch 404'd.
    const onControllerChange = () => {
      const now = Date.now();
      const lastAt = Number(sessionStorage.getItem(RELOAD_AT_KEY) ?? "0");
      if (now - lastAt < MIN_RELOAD_INTERVAL_MS) return;
      const currentBuild = getCurrentBuildId();
      const lastBuild = sessionStorage.getItem(RELOAD_BUILD_KEY);
      if (currentBuild && lastBuild === currentBuild) return;
      if (currentBuild) sessionStorage.setItem(RELOAD_BUILD_KEY, currentBuild);
      sessionStorage.setItem(RELOAD_AT_KEY, String(now));
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    let unbindWaiting: (() => void) | null = null;
    let unbindVisibility: (() => void) | null = null;
    let unbindOnline: (() => void) | null = null;

    loadModule("virtual:pwa-register")
      .then((mod: any) => {
        if (cancelled) return;
        const updateSW = mod.registerSW({
          immediate: true,
          // 2026-04-26: registerType is "autoUpdate" so onNeedRefresh
          // shouldn't fire in the steady state. We still wire it as a
          // belt-and-suspenders signal; it will only flip needsRefresh
          // if the new worker is somehow stuck waiting.
          onNeedRefresh() {
            setNeedsRefresh(true);
          },
          onRegisteredSW(_swUrl: string, registration: ServiceWorkerRegistration | undefined) {
            if (!registration) return;

            // Hourly background poll — preserves the prior safety net for
            // long-lived foreground tabs. The visibilitychange listener
            // below covers the iPad-PWA-was-backgrounded case.
            setInterval(() => {
              registration.update().catch(() => {});
            }, 60 * 60 * 1000);

            // Visibility-driven update check. iOS suspends background JS
            // for PWAs and Safari tabs; the moment the user returns to
            // the app, ask the SW to verify it has the latest version.
            // No-op on errors; the controllerchange path will still fire
            // when the new SW installs + claims.
            const onVisible = () => {
              if (document.visibilityState === "visible") {
                registration.update().catch(() => {});
              }
            };
            document.addEventListener("visibilitychange", onVisible);
            unbindVisibility = () => document.removeEventListener("visibilitychange", onVisible);

            // 2026-04-30: also re-check when the network comes back.
            // visibilitychange covers "user returned to the tab", but
            // not "user was on the tab the whole time, lost connection,
            // and just regained it." The hourly poll would eventually
            // catch this, but `online` makes it instant.
            const onOnline = () => {
              registration.update().catch(() => {});
            };
            window.addEventListener("online", onOnline);
            unbindOnline = () => window.removeEventListener("online", onOnline);

            // Watch for a `waiting` worker that doesn't activate in time.
            // A `waiting` worker is one that has installed but hasn't
            // taken over yet. Our SW calls self.skipWaiting() at module
            // eval, so this state is normally transient. If it persists
            // past the grace window, surface the banner so the user can
            // manually trigger activation.
            let timer: ReturnType<typeof setTimeout> | null = null;
            const armBanner = () => {
              if (timer) clearTimeout(timer);
              timer = setTimeout(() => {
                if (registration.waiting) {
                  setNeedsRefresh(true);
                }
              }, WAITING_GRACE_MS);
            };
            const onUpdateFound = () => {
              const installing = registration.installing;
              if (!installing) return;
              installing.addEventListener("statechange", () => {
                if (installing.state === "installed" && registration.waiting) {
                  armBanner();
                }
              });
            };
            registration.addEventListener("updatefound", onUpdateFound);
            // If a worker is already waiting at registration time
            // (multi-tab scenario), arm the banner immediately too.
            if (registration.waiting) armBanner();

            unbindWaiting = () => {
              registration.removeEventListener("updatefound", onUpdateFound);
              if (timer) clearTimeout(timer);
            };
          },
        });
        // Capture for the banner button. updateSW(true) → posts
        // SKIP_WAITING to the waiting worker + reloads after activation.
        if (typeof updateSW === "function") {
          setUpdater(() => updateSW);
        }
      })
      .catch(() => {
        // virtual:pwa-register not available (non-Vite runtime) — no-op.
      });

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      if (unbindWaiting) unbindWaiting();
      if (unbindVisibility) unbindVisibility();
      if (unbindOnline) unbindOnline();
    };
  }, []);

  // Secondary fallback UI. Only renders when the auto-reload path didn't
  // fire within WAITING_GRACE_MS of a new worker installing. Tap the
  // button to force-update via the canonical helper — handles the iOS
  // PWA "the SW parked itself" edge case that even the cache-header fix
  // can't solve on its own.
  if (!needsRefresh) return null;

  const handleRefresh = async () => {
    try {
      if (updater) {
        // Calls postMessage SKIP_WAITING on the waiting worker AND reloads.
        await updater(true);
        return;
      }
    } catch {
      // fall through to a plain reload
    }
    // Belt-and-suspenders fallback: even without virtual:pwa-register, a
    // hard reload re-fetches index.html (which now carries no-cache
    // headers AND is served NetworkFirst by the SW) and the new SW
    // will take over on the fresh load. Clear both reload-guard keys
    // so the post-reload controllerchange isn't accidentally suppressed.
    sessionStorage.removeItem(RELOAD_BUILD_KEY);
    sessionStorage.removeItem(RELOAD_AT_KEY);
    window.location.reload();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="pwa-update-banner"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2 shadow-lg"
    >
      <span className="text-xs font-medium text-slate-700">Update available</span>
      <button
        type="button"
        onClick={handleRefresh}
        className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 underline-offset-2 hover:underline"
        data-testid="pwa-update-refresh"
      >
        Refresh
      </button>
    </div>
  );
}
