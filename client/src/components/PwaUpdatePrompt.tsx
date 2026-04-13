/**
 * PWA update prompt — shows a banner when a new service worker is waiting.
 *
 * Dynamically loads virtual:pwa-register at runtime so the import never blocks
 * the initial module graph. Renders nothing when:
 *   - service workers are not supported (desktop app, non-HTTPS)
 *   - the virtual module is unavailable (non-Vite runtime)
 */
import { useState, useEffect } from "react";
import { RefreshCw, X } from "lucide-react";

type SWRegistrationState = {
  needRefresh: boolean;
  offlineReady: boolean;
  updateServiceWorker: () => Promise<void>;
  dismiss: () => void;
};

// Opaque loader that Vite's static analysis cannot follow.
// At runtime it performs a standard dynamic import; at build/serve time
// Vite sees only `new Function(...)` and skips resolution.
const loadModule = new Function("m", "return import(m)") as (id: string) => Promise<any>;

export function PwaUpdatePrompt() {
  const [state, setState] = useState<SWRegistrationState | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    // Load virtual:pwa-register at runtime only — Vite cannot resolve this
    loadModule("virtual:pwa-register")
      .then((mod: any) => {
        if (cancelled) return;

        const updateSW = mod.registerSW({
          immediate: true,
          onNeedRefresh() {
            if (!cancelled) {
              setState((prev) => ({
                ...(prev ?? { offlineReady: false, updateServiceWorker: () => updateSW(true), dismiss }),
                needRefresh: true,
              }));
            }
          },
          onOfflineReady() {
            if (!cancelled) {
              setState((prev) => ({
                ...(prev ?? { needRefresh: false, updateServiceWorker: () => updateSW(true), dismiss }),
                offlineReady: true,
              }));
            }
          },
          onRegisteredSW(_swUrl: string, registration: ServiceWorkerRegistration | undefined) {
            if (registration) {
              setInterval(() => { registration.update(); }, 60 * 60 * 1000);
            }
          },
        });

        function dismiss() {
          setState(null);
        }

        // Initialize state with dismiss and update functions
        if (!cancelled) {
          setState({
            needRefresh: false,
            offlineReady: false,
            updateServiceWorker: () => updateSW(true),
            dismiss,
          });
        }
      })
      .catch(() => {
        // virtual:pwa-register not available — render nothing
      });

    return () => { cancelled = true; };
  }, []);

  if (!state || (!state.needRefresh && !state.offlineReady)) return null;

  return (
    <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-[9999] w-[calc(100%-2rem)] max-w-sm">
      <div className="bg-slate-900 text-white rounded-lg shadow-xl border border-slate-700 p-3 flex items-center gap-3">
        <div className="flex-1 text-sm">
          {state.needRefresh
            ? "A new version is available."
            : "App ready for offline use."}
        </div>
        {state.needRefresh && (
          <button
            onClick={state.updateServiceWorker}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-md transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Update
          </button>
        )}
        <button
          onClick={state.dismiss}
          className="p-1 rounded-md text-slate-400 hover:text-white transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
