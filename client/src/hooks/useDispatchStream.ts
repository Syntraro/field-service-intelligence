/**
 * useDispatchStream — SSE subscription for real-time dispatch freshness.
 *
 * Connects to GET /api/dispatch/stream and invalidates TanStack Query keys
 * when other users (or other tabs) mutate dispatch-relevant data.
 *
 * Also uses BroadcastChannel for same-user cross-tab invalidation
 * without an extra server round-trip.
 */

import { useEffect, useRef, useState } from "react";
import { queryClient } from "@/lib/queryClient";

/** Matches the server-side DispatchSignal shape */
interface DispatchSignal {
  scope: string;
  entityType: "job" | "visit" | "task";
  entityId: string;
  ts: string;
}

const BROADCAST_CHANNEL_NAME = "dispatch-freshness";

/**
 * Invalidate the right query keys based on what changed.
 * Uses broad prefix matching — TanStack will refetch only stale queries.
 */
function invalidateForSignal(_signal: DispatchSignal): void {
  // Calendar grid data (events in range)
  queryClient.invalidateQueries({ queryKey: ["/api/calendar"], exact: false });
  // Backlog sidebar
  queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"], exact: false });
  // Needs follow-up sidebar
  queryClient.invalidateQueries({ queryKey: ["/api/calendar/needs-follow-up"], exact: false });
  // Day summary counts (Hardening: was missing from initial implementation)
  queryClient.invalidateQueries({ queryKey: ["/api/calendar/day-summary"], exact: false });
  // Activity timeline in dispatch panel (any open panel will refetch)
  queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey[0];
      return typeof key === "string" && key.startsWith("/api/activity/dispatch");
    },
  });
  // Tasks (if task changed)
  if (_signal.entityType === "task") {
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"], exact: false });
  }
}

/**
 * Activate the dispatch SSE stream. Call once in the Calendar page component.
 * Returns connection status for optional UI indicator.
 */
export function useDispatchStream(): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const retryDelay = useRef(1000);

  useEffect(() => {
    // --- SSE connection ---
    let es: EventSource | null = null;
    let closed = false;

    function connect() {
      if (closed) return;
      es = new EventSource("/api/dispatch/stream", { withCredentials: true });

      es.addEventListener("connected", () => {
        setConnected(true);
        retryDelay.current = 1000; // Reset backoff on success
      });

      es.addEventListener("dispatch", (e: MessageEvent) => {
        try {
          const signal: DispatchSignal = JSON.parse(e.data);
          invalidateForSignal(signal);
          // Broadcast to sibling tabs (they skip their own SSE-originated events)
          bc?.postMessage(signal);
        } catch {
          // Malformed event — ignore
        }
      });

      es.onerror = () => {
        setConnected(false);
        es?.close();
        // Exponential backoff capped at 30s
        if (!closed) {
          setTimeout(connect, retryDelay.current);
          retryDelay.current = Math.min(retryDelay.current * 2, 30_000);
        }
      };
    }

    connect();

    // --- BroadcastChannel for cross-tab ---
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      bc.onmessage = (e: MessageEvent) => {
        try {
          const signal: DispatchSignal = e.data;
          if (signal && signal.scope) {
            invalidateForSignal(signal);
          }
        } catch {
          // Ignore malformed
        }
      };
    } catch {
      // BroadcastChannel not supported (e.g., Safari < 15.4) — degrade gracefully
    }

    return () => {
      closed = true;
      es?.close();
      bc?.close();
      setConnected(false);
    };
  }, []);

  return { connected };
}
