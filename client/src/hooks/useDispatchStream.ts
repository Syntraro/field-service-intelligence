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
//   Dashboard:
//     - ["dashboard","workflow"]      Jobs widget (incl. live overdueCount), invoices/quotes/PM
//     - ["dashboard","today-summary"] Today's Operations live counts
//     - ["dashboard-action"]          Modal action lists (overdue/on_hold/unscheduled/ready_to_invoice)
//     - /api/tasks* (URL-style key)   Tasks panel (predicate-matched, see below)
//   JobDetailPage: ["jobs", "detail", jobId], ["visits", jobId, "all"],
//                  ["/api/jobs", jobId, "notes"|"time-summary"|"time-entries"|"expenses"|"parts"]
//   Jobs list: ["jobs", ...]
//
// Not invalidated (static config, not changed by mutations):
//   ["/api/team/technicians/working-hours"]
//
// 2026-04-08: Dashboard "attention" query is no longer used by Dashboard.tsx —
// the Jobs widget now reads ["dashboard","workflow"].jobs.overdueCount (live SQL).
// The ["attention"] prefix is still listed for non-dashboard consumers.

/** Prefix-matched query keys for visit/job dispatch signals */
const VISIT_JOB_KEYS: readonly (readonly string[])[] = [
  ["/api/calendar"],
  ["/api/calendar/unscheduled"],
  ["visit-detail"],
  // 2026-04-08: Narrowed from broad ["dashboard"] prefix to the two specific
  // operational dashboard query keys. Both are now driven by live SQL, so SSE
  // invalidation is the primary refresh path; the staleTime values on the
  // dashboard queries are fallbacks only.
  ["dashboard", "workflow"],         // Jobs widget + invoices/quotes/PM bundled
  ["dashboard", "today-summary"],    // Today's Operations cards
  // Modal action lists still keyed broadly (modal opens on demand)
  ["dashboard-action"],
  // Attention API stays for non-dashboard consumers (per-entity badges, etc.)
  ["attention"],
  // 2026-04-05: Job/visit detail surfaces — tech status changes must propagate to office
  ["jobs"],          // prefix-matches ["jobs", "detail", jobId] and ["jobs", ...] list queries
  ["visits"],        // prefix-matches ["visits", jobId, "all"] visit list on job detail
  ["/api/jobs"],     // prefix-matches ["/api/jobs", jobId, "notes"|"time-summary"|"time-entries"|...]
];

/** Prefix-matched query keys for task signals */
const TASK_KEYS: readonly (readonly string[])[] = [
  // Tasks don't drive operational dashboard counts; the dashboard's only
  // task-affected surface is the Tasks panel, which is invalidated via the
  // TASKS_PREDICATE below. No dashboard-workflow / today-summary invalidation
  // needed for task signals.
  ["dashboard-action"],
  ["attention"],
];

/**
 * Prefix-matched query keys for time/payroll signals.
 * Consumed by PayrollPage, AdminTimesheets, and any office surface that displays
 * tech check-in/clock-out state.
 * 2026-04-08: Added so office sees realtime tech time-tracking changes.
 * 2026-04-08: Also refresh operational dashboard counts on time-scope events
 * — clock-in/out can drive visit transitions which the operational widgets
 * surface. Calendar-scope events from the same techField mutations cover the
 * common path; this is belt-and-suspenders for time-only signals.
 */
const TIME_KEYS: readonly (readonly string[])[] = [
  ["/api/payroll"],            // PayrollPage QK_WEEKLY (/api/payroll/weekly)
  ["/api/admin/timesheets"],   // PayrollPage QK_DAY/QK_WEEK_ENTRIES/QK_USERS
  ["/api/time"],               // any office /api/time queries (e.g., team time summaries)
  ["/api/jobs"],               // Job Detail time-summary/time-entries (sub-resources)
  ["dashboard", "workflow"],       // Jobs widget — operational counts
  ["dashboard", "today-summary"],  // Today's Operations cards
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
const FLAG_TIME = 4;

function applySignalFlags(signal: DispatchSignal): number {
  if (signal.scope === "calendar") {
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
  if (signal.scope === "time") {
    // Tech clock-in/out/time-entry updates → refresh office payroll/timesheet surfaces.
    // Also covers Job Detail time-summary because TIME_KEYS includes ["/api/jobs"].
    return FLAG_TIME;
  }
  return 0;
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
  if (flags & FLAG_TIME) {
    for (let i = 0; i < TIME_KEYS.length; i++) {
      qc.invalidateQueries({ queryKey: TIME_KEYS[i] as string[] });
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
      pendingFlagsRef.current |= FLAG_VISIT_JOB | FLAG_TASK | FLAG_TIME;
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
