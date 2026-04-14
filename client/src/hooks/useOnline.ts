/**
 * useOnline — reactive wrapper around `navigator.onLine`.
 *
 * 2026-04-14, Phase 2 offline queue scaffolding. Subscribes to the browser's
 * `online`/`offline` events plus `visibilitychange` (so returning to the tab
 * re-asserts connectivity). Exposes `isOnline` and the last reconnect time
 * so the replay engine can trigger drains on transition edges.
 */

import { useEffect, useState } from "react";

export interface OnlineState {
  isOnline: boolean;
  /** Epoch ms of the last offline → online transition (null if never). */
  lastReconnectedAt: number | null;
}

export function useOnline(): OnlineState {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [lastReconnectedAt, setLastReconnectedAt] = useState<number | null>(null);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setLastReconnectedAt(Date.now());
    };
    const handleOffline = () => setIsOnline(false);
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        // Re-assert reconnect on resume; the drain loop listens for changes
        // to `lastReconnectedAt`.
        setLastReconnectedAt(Date.now());
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return { isOnline, lastReconnectedAt };
}
