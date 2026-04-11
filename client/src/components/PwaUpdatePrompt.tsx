/**
 * PWA update prompt — shows a banner when a new service worker is waiting.
 * Uses vite-plugin-pwa's useRegisterSW hook (registerType: "prompt").
 * Mounted once in App.tsx — covers both office and tech app.
 */
import { useRegisterSW } from "virtual:pwa-register/react";
import { RefreshCw, X } from "lucide-react";

export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      // Check for updates every 60 minutes
      if (registration) {
        setInterval(() => {
          registration.update();
        }, 60 * 60 * 1000);
      }
    },
  });

  const close = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
  };

  if (!needRefresh && !offlineReady) return null;

  return (
    <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-[9999] w-[calc(100%-2rem)] max-w-sm">
      <div className="bg-slate-900 text-white rounded-lg shadow-xl border border-slate-700 p-3 flex items-center gap-3">
        <div className="flex-1 text-sm">
          {needRefresh
            ? "A new version is available."
            : "App ready for offline use."}
        </div>
        {needRefresh && (
          <button
            onClick={() => updateServiceWorker()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-md transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Update
          </button>
        )}
        <button
          onClick={close}
          className="p-1 rounded-md text-slate-400 hover:text-white transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
