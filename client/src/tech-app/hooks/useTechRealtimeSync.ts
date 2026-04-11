/**
 * useTechRealtimeSync — SSE consumer for the technician app.
 *
 * Connects to the existing dispatch stream (GET /api/dispatch/stream)
 * and maps incoming signals to targeted tech-app query invalidations.
 *
 * Signal → invalidation mapping:
 *   scope:"calendar" + entityType:"visit"|"job" → today visits + visit detail
 *   scope:"time" → time summary + timesheet day
 *
 * Reuses the same SSE infrastructure as the main app's useDispatchStream,
 * but with tech-app-specific query keys.
 *
 * Safety: exponential backoff + jitter on reconnect, debounced invalidation,
 * catch-up on reconnect, clean teardown. App works without socket.
 */
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";

interface DispatchSignal {
  scope: string;
  entityType: "job" | "visit" | "task";
  entityId: string;
  ts: string;
}

// ── Tech-app query keys to invalidate ──

/** Visit/dispatch changes → refresh today visits + any open visit detail + tasks */
const VISIT_KEYS: readonly (readonly string[])[] = [
  ["/api/tech/visits/today"],
  ["/api/tech/visits"],  // prefix-matches visit detail queries
  ["/api/tech/tasks/mine"],  // 2026-04-10: task create/complete/update invalidation
];

/** Time changes → refresh shift summary + timesheet day data */
const TIME_KEYS: readonly (readonly string[])[] = [
  ["/api/tech/time/summary"],
  ["/api/tech/time/day"],  // prefix-matches all day queries
];

// ── Reconnect constants (same as main app) ──
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const JITTER_MAX_MS = 2000;
const DEBOUNCE_MS = 300;

// Bit flags for pending invalidation
const FLAG_VISITS = 1;
const FLAG_TIME = 2;

function signalToFlags(signal: DispatchSignal): number {
  let flags = 0;
  if (signal.scope === "calendar" && (signal.entityType === "visit" || signal.entityType === "job" || signal.entityType === "task")) {
    flags |= FLAG_VISITS;
  }
  if (signal.scope === "time") {
    flags |= FLAG_TIME;
  }
  return flags;
}

export function useTechRealtimeSync() {
  const queryClient = useQueryClient();
  const { user, isLoading } = useAuth();
  const esRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFlagsRef = useRef(0);
  // Track rapid failures to detect auth rejection (SSE returns 401 immediately)
  const lastConnectAttemptRef = useRef(0);
  const rapidFailCountRef = useRef(0);
  const MAX_RAPID_FAILS = 3; // Stop retrying after 3 immediate failures
  const RAPID_FAIL_THRESHOLD_MS = 2000; // Failure within 2s of connect = rapid

  useEffect(() => {
    // Wait until auth is fully resolved AND user is authenticated
    if (isLoading || !user) return;

    let closed = false;

    function flush() {
      const flags = pendingFlagsRef.current;
      if (flags === 0) return;
      pendingFlagsRef.current = 0;

      if (flags & FLAG_VISITS) {
        for (const key of VISIT_KEYS) {
          queryClient.invalidateQueries({ queryKey: key as string[] });
        }
      }
      if (flags & FLAG_TIME) {
        for (const key of TIME_KEYS) {
          queryClient.invalidateQueries({ queryKey: key as string[] });
        }
      }
    }

    function scheduleFlush() {
      if (debounceTimerRef.current) return;
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        flush();
      }, DEBOUNCE_MS);
    }

    function connect() {
      if (closed) return;
      if (esRef.current) { esRef.current.close(); esRef.current = null; }

      lastConnectAttemptRef.current = Date.now();
      const es = new EventSource("/api/dispatch/stream", { withCredentials: true });
      esRef.current = es;

      es.addEventListener("connected", () => {
        const wasReconnect = retryCountRef.current > 0;
        retryCountRef.current = 0;
        rapidFailCountRef.current = 0; // Reset rapid-fail counter on successful connect
        if (wasReconnect) {
          pendingFlagsRef.current |= FLAG_VISITS | FLAG_TIME;
          scheduleFlush();
        }
      });

      es.addEventListener("dispatch", (event) => {
        try {
          const signal = JSON.parse(event.data) as DispatchSignal;
          const flags = signalToFlags(signal);
          if (flags === 0) return;
          pendingFlagsRef.current |= flags;
          scheduleFlush();
        } catch { /* malformed event */ }
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (closed) return;

        // Detect rapid failure (e.g., 401 auth rejection — SSE fails immediately)
        const elapsed = Date.now() - lastConnectAttemptRef.current;
        if (elapsed < RAPID_FAIL_THRESHOLD_MS) {
          rapidFailCountRef.current++;
          if (rapidFailCountRef.current >= MAX_RAPID_FAILS) {
            // Likely auth issue — stop retrying to prevent infinite loop.
            // SSE will reconnect on next user state change (re-render).
            return;
          }
        } else {
          rapidFailCountRef.current = 0;
        }

        const attempt = retryCountRef.current++;
        const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
        retryTimerRef.current = setTimeout(connect, delay + Math.random() * JITTER_MAX_MS);
      };
    }

    connect();

    return () => {
      closed = true;
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
      if (debounceTimerRef.current) { clearTimeout(debounceTimerRef.current); debounceTimerRef.current = null; }
      pendingFlagsRef.current = 0;
    };
  }, [user, isLoading, queryClient]);
}
