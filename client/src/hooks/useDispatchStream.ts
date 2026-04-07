/**
 * useDispatchStream — SSE consumer for office/admin realtime invalidation.
 *
 * Connects to GET /api/dispatch/stream and maps incoming signals to targeted
 * TanStack Query invalidations. Provides cross-tab and cross-user freshness
 * for dispatch board, unscheduled queue, task surfaces, and job/visit detail pages.
 *
 * Safety features:
 * - Exponential backoff + jitter on reconnect
 * - Debounced invalidation to prevent storms from rapid signals
 * - Singleton guard prevents duplicate connections from re-renders
 * - Catch-up invalidation after reconnect to cover signals missed during gap
 * - Clean teardown on unmount
 *
 * 2026-03-31: Initial implementation — wired to existing server SSE infrastructure.
 * 2026-03-31: Tightened signal→key mapping to minimum necessary per mounted surface.
 * 2026-04-05: Extended invalidation to job/visit detail surfaces so office users
 *             see tech status changes (en_route, in_progress, completed) without refresh.
 */

import { useEffect, useRef } from "react";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";

/** Matches DispatchSignal from server/lib/dispatchBus.ts */
interface DispatchSignal {
  scope: string;
  entityType: "job" | "visit" | "task";
  entityId: string;
  ts: string;
}

// ── Signal → invalidation mapping ──
// Keys actively consumed by office/admin surfaces:
//   DispatchPreview: /api/calendar, /api/calendar/unscheduled, /api/tasks (dispatch*), visit-detail
//   Dashboard: dashboard (workflow, today-summary), attention (summary),
//              dashboard-action, /api/tasks* (URL-style key)
//   JobDetailPage: ["jobs", "detail", jobId], ["visits", jobId, "all"],
//                  ["/api/jobs", jobId, "notes"|"time-summary"|"time-entries"|"expenses"|"parts"]
//   Jobs list: ["jobs", ...]
//
// Not invalidated (static config, not changed by mutations):
//   ["/api/team/technicians/working-hours"]

/** Prefix-matched query keys for visit/job dispatch signals */
const VISIT_JOB_KEYS: readonly (readonly string[])[] = [
  ["/api/calendar"],
  ["/api/calendar/unscheduled"],
  ["visit-detail"],
  // Dashboard keys dependent on dispatch state
  ["dashboard"],
  ["attention"],
  ["dashboard-action"],
  // 2026-04-05: Job/visit detail surfaces — tech status changes must propagate to office
  ["jobs"],          // prefix-matches ["jobs", "detail", jobId] and ["jobs", ...] list queries
  ["visits"],        // prefix-matches ["visits", jobId, "all"] visit list on job detail
  ["/api/jobs"],     // prefix-matches ["/api/jobs", jobId, "notes"|"time-summary"|"time-entries"|...]
];

/** Prefix-matched query keys for task signals */
const TASK_KEYS: readonly (readonly string[])[] = [
  // Dashboard keys that reflect task counts
  ["dashboard"],
  ["attention"],
  ["dashboard-action"],
];

// Task queries need predicate-based invalidation because:
// - Dispatch uses ["/api/tasks", "dispatch", dayStr] (prefix-matchable)
// - Dashboard uses ["/api/tasks?offset=0&limit=50"] (URL-style, NOT prefix-matchable)
// This matches the pattern Dashboard's own mutation handlers use.
const TASKS_PREDICATE = (q: { queryKey: readonly unknown[] }) =>
  String(q.queryKey[0]).startsWith("/api/tasks");

// ── Reconnect constants ──
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const JITTER_MAX_MS = 2000;
// Debounce: coalesce rapid signals into one invalidation pass
const DEBOUNCE_MS = 300;

// Bit flags for pending invalidation categories (avoids Set<string> serialization overhead)
const FLAG_VISIT_JOB = 1;
const FLAG_TASK = 2;

function applySignalFlags(signal: DispatchSignal): number {
  if (signal.scope !== "calendar") return 0;
  switch (signal.entityType) {
    case "visit":
    case "job":
      // Visit/job dispatch changes affect calendar + dashboard + tasks (task may share time slots)
      return FLAG_VISIT_JOB | FLAG_TASK;
    case "task":
      return FLAG_TASK;
    default:
      return 0;
  }
}

function flushFlags(flags: number, qc: QueryClient) {
  if (flags & FLAG_VISIT_JOB) {
    for (let i = 0; i < VISIT_JOB_KEYS.length; i++) {
      qc.invalidateQueries({ queryKey: VISIT_JOB_KEYS[i] as string[] });
    }
  }
  if (flags & FLAG_TASK) {
    // Predicate-based: catches both prefix-style dispatch keys and URL-style dashboard keys
    qc.invalidateQueries({ predicate: TASKS_PREDICATE });
    // Dashboard keys only if not already covered by VISIT_JOB path
    if (!(flags & FLAG_VISIT_JOB)) {
      for (let i = 0; i < TASK_KEYS.length; i++) {
        qc.invalidateQueries({ queryKey: TASK_KEYS[i] as string[] });
      }
    }
  }
}

export function useDispatchStream() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const esRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Accumulated flags during debounce window
  const pendingFlagsRef = useRef(0);

  useEffect(() => {
    // Only connect when authenticated
    if (!user) return;

    let closed = false;

    function flushInvalidations() {
      const flags = pendingFlagsRef.current;
      if (flags === 0) return;
      pendingFlagsRef.current = 0;
      flushFlags(flags, queryClient);
    }

    function scheduleFlush() {
      if (debounceTimerRef.current) return; // Already scheduled
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        flushInvalidations();
      }, DEBOUNCE_MS);
    }

    function enqueueInvalidation(signal: DispatchSignal) {
      const flags = applySignalFlags(signal);
      if (flags === 0) return;
      pendingFlagsRef.current |= flags;
      scheduleFlush();
    }

    /** Full catch-up invalidation after reconnect to cover missed signals */
    function catchUpInvalidation() {
      pendingFlagsRef.current |= FLAG_VISIT_JOB | FLAG_TASK;
      scheduleFlush();
    }

    function connect() {
      if (closed) return;
      // Singleton guard: close any stale connection
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }

      const es = new EventSource("/api/dispatch/stream", { withCredentials: true });
      esRef.current = es;

      es.addEventListener("connected", () => {
        // Connection established — reset backoff
        const wasReconnect = retryCountRef.current > 0;
        retryCountRef.current = 0;
        // Catch-up: invalidate all scoped queries to cover signals missed during disconnect
        if (wasReconnect) {
          catchUpInvalidation();
        }
      });

      es.addEventListener("dispatch", (event) => {
        try {
          const signal = JSON.parse(event.data) as DispatchSignal;
          enqueueInvalidation(signal);
        } catch {
          // Malformed event — ignore
        }
      });

      es.onerror = () => {
        // EventSource auto-closes on error; schedule reconnect with backoff
        es.close();
        esRef.current = null;
        if (closed) return;

        const attempt = retryCountRef.current++;
        const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
        const jitter = Math.random() * JITTER_MAX_MS;
        retryTimerRef.current = setTimeout(connect, delay + jitter);
      };
    }

    connect();

    return () => {
      closed = true;
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      pendingFlagsRef.current = 0;
    };
  }, [user, queryClient]);
}
