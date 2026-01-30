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

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  CalendarEventDto,
  CalendarTechnicianDto,
  CalendarRangeResponseDto,
} from "@shared/types/calendar";
import { assertCalendarRangeResponseDto } from "@shared/types/calendar";

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
 */
export function useScheduleJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: scheduleJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/range"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
  });
}

/**
 * Hook to reschedule a job
 */
export function useRescheduleJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, payload }: { jobId: string; payload: RescheduleJobPayload }) =>
      rescheduleJob(jobId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/range"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
  });
}

/**
 * Hook to unschedule a job
 */
export function useUnscheduleJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, version }: { jobId: string; version: number }) =>
      unscheduleJob(jobId, version),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/range"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
  });
}

/**
 * Hook to mark a job as complete
 */
export function useCompleteJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, payload }: { jobId: string; payload?: { completionNotes?: string } }) =>
      completeJob(jobId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/range"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
  });
}
