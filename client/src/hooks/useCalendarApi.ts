/**
 * Calendar API Hooks - Slice 1
 *
 * Provides client-side API functions for calendar operations:
 * - fetchCalendarRange(start, end)
 * - createAssignment(payload)
 * - updateAssignment(id, payload)
 * - deleteAssignment(id)
 * - completeAssignment(id, notes?)
 *
 * All mutations use apiRequest for CSRF protection.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

// ============================================================================
// Types
// ============================================================================

export interface CalendarTechnician {
  id: string;
  name: string;
  color: string | null;
}

export interface CalendarAssignment {
  id: string;
  jobId: string;
  jobNumber: number;
  jobType: string;
  summary: string;
  status: string;
  locationId: string;
  locationName: string;
  customerCompanyId: string | null;
  customerCompanyName: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  assignedTechnicianIds: string[] | null;
  primaryTechnicianId: string | null;
  technicians: CalendarTechnician[];
  // Legacy fields for backwards compatibility
  year: number | null;
  month: number | null;
  day: number | null;
  scheduledHour: number | null;
  scheduledStartMinutes: number | null;
  durationMinutes: number;
}

export interface CalendarRangeResponse {
  assignments: CalendarAssignment[];
}

export interface CreateAssignmentPayload {
  jobId: string;
  technicianUserId?: string;
  startAt: string; // ISO datetime
  endAt: string; // ISO datetime
  notes?: string;
}

export interface UpdateAssignmentPayload {
  technicianUserId?: string | null;
  startAt?: string; // ISO datetime
  endAt?: string; // ISO datetime
  notes?: string | null;
  jobId?: string;
}

export interface CompleteAssignmentPayload {
  completionNotes?: string;
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Fetch calendar assignments for a date range
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

  return res.json();
}

/**
 * Create a calendar assignment (schedule a job)
 */
export async function createAssignment(
  payload: CreateAssignmentPayload
): Promise<any> {
  return apiRequest("/api/calendar/assignments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Update a calendar assignment
 */
export async function updateAssignment(
  id: string,
  payload: UpdateAssignmentPayload
): Promise<any> {
  return apiRequest(`/api/calendar/assignments/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/**
 * Delete/unschedule a calendar assignment
 */
export async function deleteAssignment(id: string): Promise<any> {
  return apiRequest(`/api/calendar/assignments/${id}`, {
    method: "DELETE",
  });
}

/**
 * Mark a calendar assignment as complete
 */
export async function completeAssignment(
  id: string,
  payload?: CompleteAssignmentPayload
): Promise<any> {
  return apiRequest(`/api/calendar/assignments/${id}/complete`, {
    method: "POST",
    body: JSON.stringify(payload || {}),
  });
}

// ============================================================================
// React Query Hooks
// ============================================================================

/**
 * Hook to fetch calendar assignments for a date range
 *
 * @param start - Start date of range
 * @param end - End date of range
 * @param enabled - Whether to enable the query (default: true)
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
        return { assignments: [] };
      }
      return fetchCalendarRange(start, end);
    },
    enabled: enabled && !!start && !!end,
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook to create a calendar assignment
 */
export function useCreateAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createAssignment,
    onSuccess: () => {
      // Invalidate calendar queries to refetch
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/range"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
  });
}

/**
 * Hook to update a calendar assignment
 */
export function useUpdateAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateAssignmentPayload }) =>
      updateAssignment(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/range"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
  });
}

/**
 * Hook to delete/unschedule a calendar assignment
 */
export function useDeleteAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteAssignment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/range"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
  });
}

/**
 * Hook to mark an assignment as complete
 */
export function useCompleteAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload?: CompleteAssignmentPayload }) =>
      completeAssignment(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/range"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
  });
}
