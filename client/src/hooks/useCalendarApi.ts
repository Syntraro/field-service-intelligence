/**
 * Calendar API Hooks
 *
 * MODEL A: Job-Centric Scheduling
 * - Jobs ARE calendar events (no separate "assignment" entity)
 * - A job is scheduled iff scheduledStart IS NOT NULL
 * - Events are keyed by jobId only
 *
 * API Functions:
 * - fetchCalendarRange(start, end) - Get scheduled jobs in range
 * - scheduleJob(payload) - Schedule a job (sets scheduledStart/End)
 * - rescheduleJob(jobId, payload) - Update job schedule
 * - unscheduleJob(jobId, version) - Clear job schedule
 */

import { useQuery, useMutation, useQueryClient, QueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  CalendarEventDto,
  CalendarTechnicianDto,
  CalendarRangeResponseDto,
} from "@shared/types/calendar";
import { assertCalendarRangeResponseDto } from "@shared/types/calendar";

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
  technicianUserId?: string;
  version: number;       // REQUIRED for optimistic locking
}

/**
 * Payload for rescheduling a job (PATCH /api/calendar/schedule/:jobId)
 */
export interface RescheduleJobPayload {
  startAt?: string;
  endAt?: string;
  date?: string;
  allDay?: boolean;
  durationMinutes?: number;
  technicianUserId?: string | null;
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

/**
 * Schedule a job (sets scheduledStart/scheduledEnd/isAllDay)
 */
export async function scheduleJob(
  payload: ScheduleJobPayload
): Promise<ScheduleJobResponse> {
  return apiRequest("/api/calendar/schedule", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Reschedule a job (updates scheduledStart/scheduledEnd/isAllDay)
 */
export async function rescheduleJob(
  jobId: string,
  payload: RescheduleJobPayload
): Promise<ScheduleJobResponse> {
  return apiRequest(`/api/calendar/schedule/${jobId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/**
 * Unschedule a job (clears scheduledStart/scheduledEnd/isAllDay)
 */
export async function unscheduleJob(
  jobId: string,
  version: number
): Promise<ScheduleJobResponse> {
  return apiRequest(`/api/calendar/unschedule/${jobId}`, {
    method: "POST",
    body: JSON.stringify({ version }),
  });
}

/**
 * Mark a job as complete
 */
export async function completeJob(
  jobId: string,
  payload?: { completionNotes?: string }
): Promise<any> {
  return apiRequest(`/api/jobs/${jobId}/complete`, {
    method: "POST",
    body: JSON.stringify(payload || {}),
  });
}

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

/**
 * Hook to schedule a job
 *
 * INVALIDATION: calendar + unscheduled + jobs
 * Reason: Job moves FROM backlog TO calendar
 */
export function useScheduleJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: scheduleJob,
    onSuccess: (_, variables) => {
      // Job moves from backlog to calendar - invalidate both
      invalidateCalendarAndUnscheduledQueries(queryClient, "schedule", variables.jobId);
      invalidateJobQueries(queryClient, "schedule", variables.jobId);
    },
  });
}

/**
 * Hook to reschedule a job
 *
 * INVALIDATION: calendar + unscheduled + jobs
 * Reason: Reschedule may affect backlog sidebar (e.g. moving to a date
 * that changes which jobs appear in the unscheduled list)
 */
export function useRescheduleJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, payload }: { jobId: string; payload: RescheduleJobPayload }) =>
      rescheduleJob(jobId, payload),
    onSuccess: (_, variables) => {
      invalidateCalendarAndUnscheduledQueries(queryClient, "reschedule", variables.jobId);
      invalidateJobQueries(queryClient, "reschedule", variables.jobId);
    },
  });
}

/**
 * Hook to unschedule a job
 *
 * INVALIDATION: calendar + unscheduled + jobs + visits
 * Reason: Job moves FROM calendar TO backlog, visit becomes inactive
 */
export function useUnscheduleJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, version }: { jobId: string; version: number }) =>
      unscheduleJob(jobId, version),
    onSuccess: (_, variables) => {
      // Job moves from calendar to backlog - invalidate both
      invalidateCalendarAndUnscheduledQueries(queryClient, "unschedule", variables.jobId);
      invalidateJobQueries(queryClient, "unschedule", variables.jobId);
      // Also invalidate visits since unschedule marks visit as inactive
      invalidateVisitQueries(queryClient, "unschedule", variables.jobId);
    },
  });
}

/**
 * Hook to mark a job as complete
 *
 * INVALIDATION: calendar only + jobs (NOT unscheduled)
 * Reason: Job stays on calendar, status changes to completed
 */
export function useCompleteJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, payload }: { jobId: string; payload?: { completionNotes?: string } }) =>
      completeJob(jobId, payload),
    onSuccess: (_, variables) => {
      // Job stays on calendar - no need to invalidate unscheduled
      invalidateCalendarQueries(queryClient, "complete", variables.jobId);
      invalidateJobQueries(queryClient, "complete", variables.jobId);
      // Phase 5 Step B3: canonical dashboard family key
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
