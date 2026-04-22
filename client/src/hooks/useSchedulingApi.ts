/**
 * Scheduling API Hooks (renamed from useCalendarApi.ts — 2026-03-07)
 *
 * Visit-centric scheduling model:
 * - First-schedule: POST /api/calendar/schedule (job-based, creates visit)
 * - Reschedule existing: PATCH /api/calendar/visit/:visitId/reschedule
 * - Unschedule existing: POST /api/calendar/visit/:visitId/unschedule
 * - Resize existing: POST /api/calendar/visit/:visitId/resize
 *
 * API Functions:
 * - fetchCalendarRange(start, end) - Get scheduled jobs in range
 * - scheduleJob(payload) - First-schedule a job (creates visit)
 * - unscheduleVisit(visitId, version) - Unschedule a visit
 */

import { useQuery, useMutation, useQueryClient, QueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  CalendarEventDto,
  CalendarTechnicianDto,
  CalendarRangeResponseDto,
} from "@shared/types/scheduling";
import { assertCalendarRangeResponseDto } from "@shared/types/scheduling";

// ============================================================================
// Centralized Invalidation Helpers
// ============================================================================
// These helpers ensure consistent cache invalidation across all calendar operations
// and provide DEV-only logging to track which queries are invalidated.
//
// INVALIDATION RULES:
// - schedule: calendar + unscheduled (job moves FROM backlog TO calendar)
// - reschedule: calendar only (job stays on calendar, just different slot)
// - unschedule: calendar + unscheduled (job moves FROM calendar TO backlog)
// - complete: calendar only (job stays on calendar, status changes)
// ============================================================================

/** DEV-only flag to enable invalidation logging */
const INVALIDATION_DEBUG = process.env.NODE_ENV === "development";

/** Track invalidated keys within a single operation to detect duplicates */
let currentOperationKeys: Set<string> | null = null;

/**
 * DEV-only: Log which query keys are being invalidated
 * Warns if the same key is invalidated twice within a single operation
 */
function logInvalidation(operation: string, keys: string[], context?: string) {
  if (!INVALIDATION_DEBUG) return;

  const timestamp = new Date().toISOString().split("T")[1].slice(0, 12);
  const contextStr = context ? ` [${context}]` : "";

  // Check for duplicates within this operation
  if (currentOperationKeys) {
    const duplicates = keys.filter((k) => currentOperationKeys!.has(k));
    if (duplicates.length > 0) {
      console.warn(
        `[INVALIDATE ${timestamp}] ⚠️ DUPLICATE in ${operation}${contextStr}:`,
        duplicates
      );
    }
    keys.forEach((k) => currentOperationKeys!.add(k));
  }

  console.log(
    `[INVALIDATE ${timestamp}] ${operation}${contextStr}:`,
    keys.join(", ")
  );
}

/**
 * Start tracking invalidations for a single operation
 * Call this at the start of an onSuccess handler
 */
function startInvalidationTracking() {
  if (!INVALIDATION_DEBUG) return;
  currentOperationKeys = new Set();
}

/**
 * End tracking invalidations for a single operation
 * Call this at the end of an onSuccess handler
 */
function endInvalidationTracking() {
  if (!INVALIDATION_DEBUG) return;
  currentOperationKeys = null;
}

/**
 * Invalidate calendar-related queries (scheduled events on calendar)
 * Used by: reschedule, complete (operations where job stays on calendar)
 */
export function invalidateCalendarQueries(
  queryClient: QueryClient,
  operation: string,
  context?: string
) {
  startInvalidationTracking();

  const keys = ["/api/calendar", "/api/calendar/range"];
  logInvalidation(operation, keys, context);

  queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
  queryClient.invalidateQueries({ queryKey: ["/api/calendar/range"] });

  endInvalidationTracking();
}

/**
 * Invalidate calendar + unscheduled queries (backlog)
 * Used by: schedule, unschedule (operations where job moves between calendar and backlog)
 */
export function invalidateCalendarAndUnscheduledQueries(
  queryClient: QueryClient,
  operation: string,
  context?: string
) {
  startInvalidationTracking();

  const keys = [
    "/api/calendar",
    "/api/calendar/range",
    "/api/calendar/unscheduled",
  ];
  logInvalidation(operation, keys, context);

  queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
  queryClient.invalidateQueries({ queryKey: ["/api/calendar/range"] });
  queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });

  endInvalidationTracking();
}

/**
 * Invalidate job queries using the canonical ['jobs'] family key.
 * Phase 4 Step C5: Single family-wide invalidation replaces individual key patterns.
 * invalidateQueries({ queryKey: ['jobs'] }) matches all keys starting with 'jobs':
 *   ['jobs', 'feed', ...], ['jobs', 'detail', jobId], etc.
 */
export function invalidateJobQueries(
  queryClient: QueryClient,
  operation: string,
  jobId?: string,
  context?: string
) {
  startInvalidationTracking();

  logInvalidation(operation, ["jobs"], context);

  // Family-wide invalidation: matches feed + detail + any sub-keys
  queryClient.invalidateQueries({ queryKey: ["jobs"] });

  endInvalidationTracking();
}

/**
 * Invalidate visit queries for a specific job
 * Used after schedule/unschedule operations that affect job visits
 */
export function invalidateVisitQueries(
  queryClient: QueryClient,
  operation: string,
  jobId: string,
  context?: string
) {
  startInvalidationTracking();

  const keys = [
    `/api/jobs/${jobId}/visits`,
    `/api/jobs/${jobId}/visits/all`,
  ];
  logInvalidation(operation, keys, context);

  // Phase 4 Step C5: use visit family key
  queryClient.invalidateQueries({ queryKey: ["visits"] });

  endInvalidationTracking();
}

// ============================================================================
// Types
// ============================================================================

export type CalendarTechnician = CalendarTechnicianDto;
export type CalendarEvent = CalendarEventDto;
export type CalendarRangeResponse = CalendarRangeResponseDto;

/**
 * Payload for scheduling a job (POST /api/calendar/schedule)
 */
export interface ScheduleJobPayload {
  jobId: string;
  startAt?: string;      // ISO datetime (required for timed events)
  endAt?: string;        // ISO datetime (optional - computed from duration if not provided)
  date?: string;         // YYYY-MM-DD (required for all-day events)
  allDay?: boolean;      // True = all-day event
  durationMinutes?: number; // For timed events
  // 2026-04-12 final cleanup: canonical crew array — single-tech callers pass [id].
  assignedTechnicianIds?: string[] | null;
  version: number;       // REQUIRED for optimistic locking
}

/**
 * Response from schedule/reschedule/unschedule endpoints
 */
export interface ScheduleJobResponse {
  id: string;
  jobId: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  isAllDay: boolean;
  version: number;
  status: string;
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Fetch scheduled jobs for a date range
 */
export async function fetchCalendarRange(
  start: Date | string,
  end: Date | string
): Promise<CalendarRangeResponse> {
  const startISO = typeof start === "string" ? start : start.toISOString();
  const endISO = typeof end === "string" ? end : end.toISOString();

  const res = await fetch(
    `/api/calendar?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`,
    { credentials: "include" }
  );

  if (!res.ok) {
    throw new Error("Failed to fetch calendar range");
  }

  const data = await res.json();

  // DEV validation
  if (process.env.NODE_ENV === "development") {
    assertCalendarRangeResponseDto(data, "fetchCalendarRange");
  }

  return data;
}

// ============================================================================
// 2026-04-21 Phase 1.5 canonicalization: `scheduleJob` and `unscheduleVisit`
// helpers REMOVED. Every office schedule/unschedule write now routes
// through `useDispatchPreviewMutations` (canonical client hook). The
// `ScheduleJobPayload` and `ScheduleJobResponse` types remain for any
// consumer that needs the wire shape; they are NOT the canonical mutation
// surface.
// ============================================================================

// ============================================================================
// React Query Hooks
// ============================================================================

/**
 * Hook to fetch scheduled jobs for a date range
 *
 * OPTIMIZED: 2026-01-30 - Prevent unnecessary refetches during drag operations
 */
export function useCalendarRange(
  start: Date | string | null,
  end: Date | string | null,
  enabled = true
) {
  return useQuery({
    queryKey: [
      "/api/calendar/range",
      typeof start === "string" ? start : start?.toISOString(),
      typeof end === "string" ? end : end?.toISOString(),
    ],
    queryFn: async () => {
      if (!start || !end) {
        return { events: [], outsideVisibleHoursCount: 0, timezone: "UTC" };
      }
      return fetchCalendarRange(start, end);
    },
    enabled: enabled && !!start && !!end,
    staleTime: 30000,
    // OPTIMIZED: Prevent refetches during interaction - let mutations handle cache updates
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });
}

// 2026-04-21 Phase 1.5: `useScheduleJob` and `useUnscheduleVisit` REMOVED.
// Every office schedule/unschedule write goes through the canonical
// `useDispatchPreviewMutations.scheduleVisit` / `.unscheduleVisit`.
// Do NOT add a new `useSchedule*` hook here — extend the canonical hook.
