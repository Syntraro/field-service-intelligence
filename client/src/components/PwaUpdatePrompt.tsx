/**
 * PWA registration + auto-reload on deploy (2026-04-14, hardened 2026-04-26).
 *
 * Paired with `registerType: "autoUpdate"` + `skipWaiting` + `clientsClaim`
 * in vite.config.ts. The complete flow is:
 *
 *   1. A new deploy ships a new SW. The browser discovers it on next page
 *      load, on the hourly `registration.update()` poll, OR — added 2026-04-26
 *      — on every `visibilitychange` to "visible".
 *   2. The new SW installs, skips waiting, and claims the existing client.
 *   3. `navigator.serviceWorker.controller` changes — we perform a single
 *      hard reload so the tab re-bootstraps against the NEW index.html
 *      and the NEW hashed chunks.
 *
 * Without step 3, the tab keeps running the old in-memory bundle. Any
 * lazy-imported chunk it requests uses old hashes whose files were purged
 * from the server by the new deploy, producing mixed-bundle runtime
 * failures (React #310, blank screens).
 *
 * The `reloaded` session flag prevents reload loops if the SW keeps
 * changing during the lifetime of the tab.
 *
 * 2026-04-26 stale-deploy hardening:
 *   - The `visibilitychange` listener triggers `registration.update()` the
 *     moment a backgrounded PWA comes back to the foreground. iPad PWAs
 *     can be suspended for hours; the prior 1-hour `setInterval` poll
 *     never fires while suspended, so the SW would only check for updates
 *     on the next manual interaction. Foregrounding now bridges that gap.
 *   - A secondary "Update available — Refresh" banner appears if a new
 *     `waiting` worker has been around for more than 5 seconds without
 *     auto-claiming the page (rare; happens on iOS PWA when the OS parks
 *     the SW between sessions). Tapping it calls the canonical
 *     `updateServiceWorker(true)` which posts SKIP_WAITING + reloads.
 *     The banner is intentionally secondary — the cache-header fix in
 *     `server/vite.ts` plus the visibility-driven update check are the
 *     load-bearing pieces. The banner only shows when those still leave
 *     the user stuck.
 */
import { useEffect, useState } from "react";

const loadModule = new Function("m", "return import(m)") as (id: string) => Promise<any>;
const RELOAD_FLAG = "__syntraro_sw_reloaded__";
const WAITING_GRACE_MS = 5000;

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

    // Auto-reload guard — controllerchange fires when the SW takes control
    // of an existing client. The session-flag stops repeat reloads if the
    // SW updates again later in the same tab session.
    const onControllerChange = () => {
      if (sessionStorage.getItem(RELOAD_FLAG) === "1") return;
      sessionStorage.setItem(RELOAD_FLAG, "1");
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    let unbindWaiting: (() => void) | null = null;
    let unbindVisibility: (() => void) | null = null;

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
    // headers) and the new SW will take over on the fresh load.
    sessionStorage.removeItem(RELOAD_FLAG);
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
