/**
 * PWA registration + auto-reload on deploy (2026-04-14).
 *
 * Paired with `registerType: "autoUpdate"` + `skipWaiting` + `clientsClaim`
 * in vite.config.ts. The flow is:
 *
 *   1. A new deploy ships a new SW. The browser discovers it on next page
 *      load or during the hourly `registration.update()` poll.
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
 */
import { useEffect } from "react";

const loadModule = new Function("m", "return import(m)") as (id: string) => Promise<any>;
const RELOAD_FLAG = "__syntraro_sw_reloaded__";

export function PwaUpdatePrompt() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    const onControllerChange = () => {
      if (sessionStorage.getItem(RELOAD_FLAG) === "1") return;
      sessionStorage.setItem(RELOAD_FLAG, "1");
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    loadModule("virtual:pwa-register")
      .then((mod: any) => {
        if (cancelled) return;
        mod.registerSW({
          immediate: true,
          onRegisteredSW(_swUrl: string, registration: ServiceWorkerRegistration | undefined) {
            if (!registration) return;
            setInterval(() => { registration.update().catch(() => {}); }, 60 * 60 * 1000);
          },
        });
      })
      .catch(() => {
        // virtual:pwa-register not available (non-Vite runtime) — no-op.
      });

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}
