/**
 * useCalendarDnD - Calendar Drag/Drop with Optimistic Updates
 *
 * Handles:
 * - Create assignment mutations
 * - Update assignment mutations
 * - Delete assignment mutations
 * - Optimistic UI updates with snapshot rollback
 * - Error handling via calendarErrorHandler
 * - RBAC permission gating for scheduling
 *
 * API CONTRACT (MODEL A):
 * - POST /api/calendar/schedule: { jobId, startAt, endAt, allDay?, version }
 * - PATCH /api/calendar/schedule/:id: { startAt?, endAt?, allDay?, version }
 * - POST /api/calendar/unschedule/:id: { version }
 */

import { useCallback, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { canEditSchedule } from "@/lib/schedulingPermissions";
import { handleCalendarMutationError, isVersionMismatchError } from "@/components/calendar/calendarErrorHandler";
import { logVersionMismatch } from "@/lib/calendarDiagnostics";

// ============================================================================
// Types
// ============================================================================

export interface CreateAssignmentParams {
  /** Job ID to schedule */
  jobId: string;
  /** Target day (1-31) */
  day: number;
  /** Target hour (0-23) - ignored when allDay=true */
  scheduledHour?: number | null;
  /** Start minutes within hour (0-59) */
  scheduledStartMinutes?: number;
  /** Duration in minutes (default 60) */
  durationMinutes?: number;
  /** Target year */
  targetYear: number;
  /** Target month (1-12) */
  targetMonth: number;
  /** Whether this is an all-day event */
  allDay?: boolean;
  /**
   * Job version for optimistic locking.
   * IMPORTANT: Do not use fallback `?? 0` when constructing params.
   * Version 0 is only valid for newly created jobs. Sending 0 for an
   * existing job will cause VERSION_MISMATCH (409). If version is
   * undefined, the auto-retry logic will fetch the correct version.
   */
  version: number;
  /** Internal: marks this as a retry attempt to prevent infinite loops */
  _isRetry?: boolean;
}

export interface UpdateAssignmentParams {
  /** Job ID to update */
  id: string;
  /** Target day (1-31) */
  day: number;
  /** Target hour (0-23) - ignored when allDay=true */
  scheduledHour?: number | null;
  /** Start minutes within hour (0-59) */
  scheduledStartMinutes?: number | null;
  /** Target year (optional, falls back to current view year) */
  targetYear?: number;
  /** Target month (optional, falls back to current view month) */
  targetMonth?: number;
  /** Duration in minutes */
  durationMinutes?: number;
  /** Whether this is an all-day event */
  allDay?: boolean;
  /** Job version for optimistic locking */
  version: number;
  /** Internal: marks this as a retry attempt to prevent infinite loops */
  _isRetry?: boolean;
}

export interface AssignTechniciansParams {
  assignmentId: string;
  technicianIds: string[];
}

// Snapshot for rollback
interface OptimisticSnapshot {
  queryKey: unknown[];
  data: unknown;
}

// ============================================================================
// Helper Functions - Timezone & DST Safe Date Building
// ============================================================================
//
// TIMEZONE APPROACH:
// - We use JavaScript Date objects for ALL date/time calculations
// - Date objects are created in LOCAL timezone using new Date(year, month-1, day, hour, min)
// - Duration math uses Date.setMinutes() which handles DST transitions automatically
// - Only at the final API boundary do we convert to ISO string via .toISOString()
// - The 'date' field (YYYY-MM-DD) is derived from the local date for display purposes
//
// This approach ensures:
// - DST transitions don't create invalid times (e.g., 2:30 AM during spring forward)
// - Adding duration works correctly across day boundaries
// - endAt is always > startAt (validated before sending to API)
// ============================================================================

const MIN_DURATION_MINUTES = 15;
const DEFAULT_DURATION_MINUTES = 60;
const MAX_DURATION_MINUTES = 1440; // 24 hours

/**
 * Build a Date object from year/month/day/hour/minutes.
 * Uses local timezone. Returns null if invalid.
 */
function buildLocalDate(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number = 0,
  minutes: number = 0
): Date | null {
  // Validate inputs
  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23) hour = 0;
  if (minutes < 0 || minutes > 59) minutes = 0;

  const date = new Date(year, month - 1, day, hour, minutes, 0, 0);
  if (isNaN(date.getTime())) return null;
  return date;
}

/**
 * Build ISO datetime string for a specific date and time.
 * Returns proper ISO 8601 format: "2024-01-15T09:30:00.000Z"
 * Uses local Date objects for timezone/DST safety.
 */
function buildISODateTime(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number = 0,
  minutes: number = 0
): string {
  const date = buildLocalDate(year, month, day, hour, minutes);
  if (!date) {
    throw new Error(`Invalid date: ${year}-${month}-${day} ${hour}:${minutes}`);
  }
  return date.toISOString();
}

/**
 * Build ISO date string for all-day events.
 * Returns date-only format: "2024-01-15"
 */
function buildISODate(year: number, month: number, day: number): string {
  if (year < 1900 || year > 2100) throw new Error(`Invalid year: ${year}`);
  if (month < 1 || month > 12) throw new Error(`Invalid month: ${month}`);
  if (day < 1 || day > 31) throw new Error(`Invalid day: ${day}`);

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Compute start and end times for a timed event with validation.
 * Ensures endAt is always after startAt (at least MIN_DURATION_MINUTES).
 * Clamps endAt to same day (23:59:59) if it would cross midnight.
 * Returns null if inputs are invalid.
 *
 * @param year - Target year
 * @param month - Target month (1-12)
 * @param day - Target day (1-31)
 * @param hour - Start hour (0-23)
 * @param startMinutes - Start minutes (0-59)
 * @param durationMinutes - Duration in minutes (default 60)
 * @returns { startAt, endAt } ISO strings, or null if invalid
 */
function computeTimedEventRange(
  year: number,
  month: number,
  day: number,
  hour: number,
  startMinutes: number = 0,
  durationMinutes: number = DEFAULT_DURATION_MINUTES
): { startAt: string; endAt: string } | null {
  // Build start date
  const startDate = buildLocalDate(year, month, day, hour, startMinutes);
  if (!startDate) return null;

  // Validate and clamp duration
  let duration = durationMinutes;
  if (typeof duration !== 'number' || isNaN(duration) || duration < MIN_DURATION_MINUTES) {
    duration = DEFAULT_DURATION_MINUTES;
  }
  // Clamp to reasonable max for timed events (never 1440 which is all-day)
  if (duration > MAX_DURATION_MINUTES || duration === 1440) {
    duration = DEFAULT_DURATION_MINUTES; // Use 60 instead of 1440
  }

  // Compute end date using Date math (handles DST transitions)
  let endDate = new Date(startDate);
  endDate.setMinutes(endDate.getMinutes() + duration);

  // Final validation: ensure endAt > startAt
  if (endDate.getTime() <= startDate.getTime()) {
    // Shouldn't happen with valid inputs, but force minimum duration
    endDate.setTime(startDate.getTime() + MIN_DURATION_MINUTES * 60000);
  }

  // SAME-DAY CLAMP: Timed events must not span multiple days
  // If endAt crosses midnight, clamp to 23:59:59.999 of start day
  const startDay = startDate.toISOString().split('T')[0];
  const endDay = endDate.toISOString().split('T')[0];
  if (startDay !== endDay) {
    // Clamp to end of start day in UTC
    endDate = new Date(startDay + 'T23:59:59.999Z');
  }

  return {
    startAt: startDate.toISOString(),
    endAt: endDate.toISOString(),
  };
}

// ============================================================================
// Helper: Fetch fresh job version from server
// ============================================================================
//
// REFACTORING NOTE (2026-01-26):
// Added to support auto-retry on VERSION_MISMATCH (409) errors.
// When optimistic locking fails, we fetch fresh data and retry once
// rather than immediately showing an error to the user.
// See docs/REFACTORING_LOG.md for full context.
// ============================================================================

/**
 * Fetch fresh job data to get the current version.
 * Used for auto-retry on VERSION_MISMATCH (409).
 * Returns the fresh version or undefined if job not found.
 */
async function fetchFreshJobVersion(jobId: string): Promise<number | undefined> {
  try {
    const res = await fetch('/api/calendar/unscheduled', { credentials: 'include' });
    if (!res.ok) return undefined;

    const data = await res.json();
    const items = Array.isArray(data) ? data : [];
    const job = items.find((item: any) => item.id === jobId || item.jobId === jobId);

    if (process.env.NODE_ENV === 'development') {
      console.log(`[useCalendarDnD] fetchFreshJobVersion: jobId=${jobId}, found version=${job?.version}`);
    }

    return job?.version;
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('[useCalendarDnD] fetchFreshJobVersion error:', error);
    }
    return undefined;
  }
}

// ============================================================================
// Hook
// ============================================================================

export function useCalendarDnD(
  year: number,
  month: number,
  currentDate: Date,
  view: string,
  refetchCalendar: () => Promise<unknown>
) {
  const { toast } = useToast();
  const { user } = useAuth();
  const snapshotRef = useRef<OptimisticSnapshot | null>(null);

  // Track which jobs are currently being saved (for visual feedback)
  const [savingJobIds, setSavingJobIds] = useState<Set<string>>(new Set());

  // Helper to add a job to saving set
  const markJobSaving = useCallback((jobId: string) => {
    setSavingJobIds(prev => new Set(prev).add(jobId));
  }, []);

  // Helper to remove a job from saving set
  const clearJobSaving = useCallback((jobId: string) => {
    setSavingJobIds(prev => {
      const next = new Set(prev);
      next.delete(jobId);
      return next;
    });
  }, []);

  // RBAC: Check if user can edit schedules
  const canSchedule = canEditSchedule(user?.role);

  // Show view-only toast when technician attempts schedule action
  const showViewOnlyToast = useCallback(() => {
    toast({
      title: "View-only access",
      description: "You don't have permission to modify scheduling.",
      variant: "default",
    });
  }, [toast]);

  // Query key for current calendar data
  const getCalendarQueryKey = useCallback(() => {
    return ["/api/calendar", view, year, month, currentDate.getTime()];
  }, [view, year, month, currentDate]);

  // Invalidate all calendar-related queries
  const invalidateCalendarQueries = useCallback(() => {
    // Invalidate all calendar queries (any view, any date range)
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        return Array.isArray(key) && typeof key[0] === 'string' && key[0].startsWith('/api/calendar');
      },
    });
    // EXPLICITLY invalidate unscheduled - this is critical for unschedule consistency
    queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
    // Also invalidate clients (may have nextDue updates)
    queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
  }, []);

  // ========================================
  // Create Assignment Mutation
  // ========================================
  const createAssignment = useMutation({
    mutationFn: async (params: CreateAssignmentParams) => {
      const { jobId, day, scheduledHour, scheduledStartMinutes = 0, durationMinutes = 60, targetYear, targetMonth, allDay, version } = params;

      // DEV logging
      if (process.env.NODE_ENV === 'development') {
        console.log('[useCalendarDnD] createAssignment payload:', params);
      }

      // Build API payload using correct field names
      let payload: Record<string, unknown>;

      if (allDay || scheduledHour === null || scheduledHour === undefined) {
        // All-day event
        payload = {
          jobId,
          allDay: true,
          date: buildISODate(targetYear, targetMonth, day),
          version,
        };
      } else {
        // Timed event - use computeTimedEventRange for timezone safety and validation
        const timeRange = computeTimedEventRange(
          targetYear, targetMonth, day,
          scheduledHour, scheduledStartMinutes,
          durationMinutes
        );

        if (!timeRange) {
          throw new Error(`Invalid time range: ${targetYear}-${targetMonth}-${day} ${scheduledHour}:${scheduledStartMinutes}`);
        }

        payload = {
          jobId,
          startAt: timeRange.startAt,
          endAt: timeRange.endAt,
          version,
        };
      }

      if (process.env.NODE_ENV === 'development') {
        console.log('[useCalendarDnD] createAssignment API payload:', payload);
      }

      const response = await apiRequest(`/api/calendar/schedule`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (process.env.NODE_ENV === 'development') {
        console.log('[useCalendarDnD] createAssignment response:', response);
      }

      return response;
    },
    onMutate: async (params) => {
      // Mark job as saving for visual feedback
      markJobSaving(params.jobId);

      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: getCalendarQueryKey() });

      // Snapshot current data for rollback
      const queryKey = getCalendarQueryKey();
      const previousData = queryClient.getQueryData(queryKey);
      snapshotRef.current = { queryKey, data: previousData };

      // Optimistic update: add a placeholder assignment
      if (previousData && typeof previousData === 'object' && 'assignments' in previousData) {
        const optimisticAssignment = {
          id: `optimistic-${Date.now()}`,
          jobId: params.jobId,
          year: params.targetYear,
          month: params.targetMonth,
          day: params.day,
          scheduledHour: params.scheduledHour ?? null,
          scheduledStartMinutes: params.scheduledStartMinutes ?? 0,
          durationMinutes: params.durationMinutes ?? 60,
          isAllDay: params.allDay ?? (params.scheduledHour === null),
          _optimistic: true,
          _saving: true, // Mark as saving for visual feedback
        };

        queryClient.setQueryData(queryKey, {
          ...(previousData as object),
          assignments: [...((previousData as any).assignments || []), optimisticAssignment],
        });
      }

      return { previousData, queryKey };
    },
    onSuccess: async (_, params) => {
      clearJobSaving(params.jobId);
      snapshotRef.current = null;
      await refetchCalendar();
      invalidateCalendarQueries();
      toast({
        title: "Job scheduled",
        description: "The job has been added to the calendar",
      });
    },
    onError: async (error: any, params, context) => {
      clearJobSaving(params.jobId);
      // Rollback to snapshot
      if (context?.previousData && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previousData);
      }
      snapshotRef.current = null;

      // DEV logging
      if (process.env.NODE_ENV === 'development') {
        console.error('[useCalendarDnD] createAssignment error:', error, 'params:', params);
      }

      // VERSION_MISMATCH (409): Auto-retry with fresh version
      if (isVersionMismatchError(error)) {
        // Log detailed diagnostics for debugging
        logVersionMismatch(
          params.jobId,
          params.version,
          error.message || 'Version mismatch',
          'POST',
          '/api/calendar/schedule'
        );

        // Fetch fresh version and retry once (only if not already a retry)
        if (!params._isRetry) {
          if (process.env.NODE_ENV === 'development') {
            console.log('[useCalendarDnD] 409 detected, fetching fresh version for auto-retry...');
          }

          const freshVersion = await fetchFreshJobVersion(params.jobId);
          if (freshVersion !== undefined && freshVersion !== params.version) {
            if (process.env.NODE_ENV === 'development') {
              console.log(`[useCalendarDnD] Auto-retrying with fresh version: ${freshVersion} (was ${params.version})`);
            }
            // Retry with fresh version (mark as retry to prevent infinite loop)
            createAssignment.mutate({ ...params, version: freshVersion, _isRetry: true } as any);
            return; // Don't show error toast on first attempt
          }
        }

        // Refetch calendar and unscheduled to get fresh versions for next attempt
        await refetchCalendar();
        invalidateCalendarQueries();

        // Show toast explaining the conflict
        toast({
          title: "Scheduling Conflict",
          description: "Job was modified by another user. The calendar has been refreshed. Please try again.",
          variant: "destructive",
          duration: 6000,
        });
        return;
      }

      const handled = await handleCalendarMutationError(error);
      if (!handled) {
        toast({
          title: "Could not schedule job",
          description: error.message || "Failed to schedule job. Please try again.",
          variant: "destructive",
        });
      }
    },
  });

  // ========================================
  // Update Assignment Mutation
  // ========================================
  const updateAssignment = useMutation({
    mutationFn: async (params: UpdateAssignmentParams) => {
      const { id, day, scheduledHour, scheduledStartMinutes = 0, durationMinutes = 60, allDay, version } = params;
      // Use provided values or fall back to hook's year/month
      const useYear = params.targetYear ?? year;
      const useMonth = params.targetMonth ?? month;

      // DEV logging
      if (process.env.NODE_ENV === 'development') {
        console.log('[useCalendarDnD] updateAssignment payload:', params);
      }

      // Build API payload using correct field names
      let payload: Record<string, unknown>;

      if (allDay || scheduledHour === null || scheduledHour === undefined) {
        // All-day event
        payload = {
          allDay: true,
          date: buildISODate(useYear, useMonth, day),
          version,
        };
      } else {
        // Timed event - use computeTimedEventRange for timezone safety and validation
        const timeRange = computeTimedEventRange(
          useYear, useMonth, day,
          scheduledHour, scheduledStartMinutes ?? 0,
          durationMinutes
        );

        if (!timeRange) {
          throw new Error(`Invalid time range: ${useYear}-${useMonth}-${day} ${scheduledHour}:${scheduledStartMinutes}`);
        }

        payload = {
          startAt: timeRange.startAt,
          endAt: timeRange.endAt,
          allDay: false,
          version,
        };
      }

      if (process.env.NODE_ENV === 'development') {
        console.log('[useCalendarDnD] updateAssignment API payload:', payload, 'id:', id);
      }

      const response = await apiRequest(`/api/calendar/schedule/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      if (process.env.NODE_ENV === 'development') {
        console.log('[useCalendarDnD] updateAssignment response:', response);
      }

      return response;
    },
    onMutate: async (params) => {
      // Mark job as saving for visual feedback (id is the jobId for updates)
      markJobSaving(params.id);

      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: getCalendarQueryKey() });

      // Snapshot current data for rollback
      const queryKey = getCalendarQueryKey();
      const previousData = queryClient.getQueryData(queryKey);
      snapshotRef.current = { queryKey, data: previousData };

      // Use provided values or fall back to hook's year/month for optimistic update
      const useYear = params.targetYear ?? year;
      const useMonth = params.targetMonth ?? month;

      // Optimistic update: modify the assignment in place
      if (previousData && typeof previousData === 'object' && 'assignments' in previousData) {
        const updatedAssignments = ((previousData as any).assignments || []).map((a: any) => {
          if (a.id === params.id) {
            return {
              ...a,
              year: useYear,
              month: useMonth,
              day: params.day,
              scheduledHour: params.scheduledHour ?? a.scheduledHour,
              scheduledStartMinutes: params.scheduledStartMinutes ?? a.scheduledStartMinutes,
              isAllDay: params.allDay ?? (params.scheduledHour === null),
              _optimistic: true,
              _saving: true, // Mark as saving for visual feedback
            };
          }
          return a;
        });

        queryClient.setQueryData(queryKey, {
          ...(previousData as object),
          assignments: updatedAssignments,
        });
      }

      return { previousData, queryKey };
    },
    onSuccess: async (_, params) => {
      clearJobSaving(params.id);
      snapshotRef.current = null;
      await refetchCalendar();
      invalidateCalendarQueries();
      toast({
        title: "Updated",
        description: "The job has been rescheduled",
      });
    },
    onError: async (error: any, params, context) => {
      clearJobSaving(params.id);
      // Rollback to snapshot (snap-back for drag/drop)
      if (context?.previousData && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previousData);
      }
      snapshotRef.current = null;

      // DEV logging
      if (process.env.NODE_ENV === 'development') {
        console.error('[useCalendarDnD] updateAssignment error:', error, 'params:', params);
      }

      // VERSION_MISMATCH (409): Auto-retry with fresh version
      if (isVersionMismatchError(error)) {
        // Log detailed diagnostics for debugging
        logVersionMismatch(
          params.id,
          params.version,
          error.message || 'Version mismatch',
          'PATCH',
          `/api/calendar/schedule/${params.id}`
        );

        // Fetch fresh version and retry once (only if not already a retry)
        if (!params._isRetry) {
          if (process.env.NODE_ENV === 'development') {
            console.log('[useCalendarDnD] 409 detected, fetching fresh version for auto-retry...');
          }

          const freshVersion = await fetchFreshJobVersion(params.id);
          if (freshVersion !== undefined && freshVersion !== params.version) {
            if (process.env.NODE_ENV === 'development') {
              console.log(`[useCalendarDnD] Auto-retrying with fresh version: ${freshVersion} (was ${params.version})`);
            }
            // Retry with fresh version (mark as retry to prevent infinite loop)
            updateAssignment.mutate({ ...params, version: freshVersion, _isRetry: true } as any);
            return; // Don't show error toast on first attempt
          }
        }

        // Refetch calendar and unscheduled to get fresh versions for next attempt
        await refetchCalendar();
        invalidateCalendarQueries();

        // Show toast explaining the conflict
        toast({
          title: "Scheduling Conflict",
          description: "Job was modified by another user. The calendar has been refreshed. Please try again.",
          variant: "destructive",
          duration: 6000,
        });
        return;
      }

      const handled = await handleCalendarMutationError(error);
      if (!handled) {
        toast({
          title: "Could not reschedule job",
          description: error.message || "Failed to update schedule. Please try again.",
          variant: "destructive",
        });
      }
    },
  });

  // ========================================
  // Update Duration Mutation
  // ========================================
  const updateDuration = useMutation({
    mutationFn: async ({ id, durationMinutes, version }: { id: string; durationMinutes: number; version?: number }) => {
      // Duration update doesn't change schedule, but we still need version if available
      const payload: Record<string, unknown> = { durationMinutes };
      if (version !== undefined) {
        payload.version = version;
      }

      return apiRequest(`/api/calendar/schedule/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: async () => {
      await refetchCalendar();
      invalidateCalendarQueries();
    },
    onError: async (error: any, params) => {
      // DEV logging
      if (process.env.NODE_ENV === 'development') {
        console.error('[useCalendarDnD] updateDuration error:', error, 'params:', params);
      }

      // VERSION_MISMATCH (409): Log to diagnostics and refetch
      if (isVersionMismatchError(error)) {
        // Log detailed diagnostics for debugging
        logVersionMismatch(
          params.id,
          params.version,
          error.message || 'Version mismatch',
          'PATCH',
          `/api/calendar/schedule/${params.id}`
        );
        // Refetch calendar and unscheduled to get fresh versions
        await refetchCalendar();
        invalidateCalendarQueries();
        const handled = await handleCalendarMutationError(error);
        if (!handled) {
          toast({
            title: "Error",
            description: error.message || "Failed to update duration",
            variant: "destructive",
          });
        }
        return;
      }
      toast({
        title: "Error",
        description: error.message || "Failed to update duration",
        variant: "destructive",
      });
    },
  });

  // ========================================
  // Delete Assignment Mutation (Unschedule)
  // ========================================
  const deleteAssignment = useMutation({
    mutationFn: async ({ id, version, jobId, jobNumber }: { id: string; version: number; jobId?: string; jobNumber?: number }) => {
      // DEV logging
      if (process.env.NODE_ENV === 'development') {
        console.log('[useCalendarDnD] deleteAssignment (unschedule) starting:', { id, version, jobId, jobNumber });
      }
      // Use unschedule endpoint with version in body
      return apiRequest(`/api/calendar/unschedule/${id}`, {
        method: "POST",
        body: JSON.stringify({ version }),
      });
    },
    onMutate: async ({ id }) => {
      // Mark job as saving for visual feedback
      markJobSaving(id);

      // Cancel any outgoing refetches for both calendar and unscheduled
      await queryClient.cancelQueries({ queryKey: getCalendarQueryKey() });
      await queryClient.cancelQueries({ queryKey: ["/api/calendar/unscheduled"] });

      // Snapshot current data for rollback
      const queryKey = getCalendarQueryKey();
      const previousCalendarData = queryClient.getQueryData(queryKey);
      const previousUnscheduledData = queryClient.getQueryData(["/api/calendar/unscheduled"]);

      // Find the assignment being deleted (to use for optimistic unscheduled insert)
      let deletedAssignment: any = null;
      if (previousCalendarData && typeof previousCalendarData === 'object' && 'assignments' in previousCalendarData) {
        deletedAssignment = ((previousCalendarData as any).assignments || []).find((a: any) => a.id === id);
      }

      // Optimistic update: remove from calendar
      if (previousCalendarData && typeof previousCalendarData === 'object' && 'assignments' in previousCalendarData) {
        const filteredAssignments = ((previousCalendarData as any).assignments || []).filter(
          (a: any) => a.id !== id
        );

        queryClient.setQueryData(queryKey, {
          ...(previousCalendarData as object),
          assignments: filteredAssignments,
        });
      }

      // Optimistic update: add placeholder to unscheduled list
      if (deletedAssignment && Array.isArray(previousUnscheduledData)) {
        const optimisticUnscheduledItem = {
          id: deletedAssignment.jobId || deletedAssignment.id,
          jobId: deletedAssignment.jobId || deletedAssignment.id,
          jobNumber: deletedAssignment.jobNumber,
          companyName: deletedAssignment.companyName || deletedAssignment.clientName || 'Unscheduling...',
          locationName: deletedAssignment.locationName || deletedAssignment.location || '',
          month: deletedAssignment.month,
          year: deletedAssignment.year,
          status: 'existing',
          _optimistic: true,
        };
        queryClient.setQueryData(["/api/calendar/unscheduled"], [optimisticUnscheduledItem, ...previousUnscheduledData]);
      }

      return { previousCalendarData, previousUnscheduledData, queryKey, deletedAssignment };
    },
    onSuccess: async (_, params) => {
      clearJobSaving(params.id);

      // DEV logging - critical for debugging unschedule consistency
      if (process.env.NODE_ENV === 'development') {
        console.log('[useCalendarDnD] deleteAssignment SUCCESS:', {
          assignmentId: params.id,
          jobId: params.jobId,
          version: params.version,
          action: 'invalidated scheduled + unscheduled',
        });
      }

      // Invalidate queries BEFORE refetch to ensure fresh data
      invalidateCalendarQueries();
      await refetchCalendar();

      toast({
        title: "Removed",
        description: "The job has been unscheduled",
      });
    },
    onError: async (error: any, params, context) => {
      clearJobSaving(params.id);
      // Rollback calendar to snapshot
      if (context?.previousCalendarData && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previousCalendarData);
      }
      // Rollback unscheduled to snapshot
      if (context?.previousUnscheduledData) {
        queryClient.setQueryData(["/api/calendar/unscheduled"], context.previousUnscheduledData);
      }

      // DEV logging
      if (process.env.NODE_ENV === 'development') {
        console.error('[useCalendarDnD] deleteAssignment error:', error, 'params:', params);
      }

      // VERSION_MISMATCH (409): Log to diagnostics and refetch
      if (isVersionMismatchError(error)) {
        // Log detailed diagnostics for debugging
        logVersionMismatch(
          params.jobId || params.id,
          params.version,
          error.message || 'Version mismatch',
          'DELETE',
          `/api/calendar/schedule/${params.id}`
        );
        // Refetch calendar and unscheduled to get fresh versions
        await refetchCalendar();
        invalidateCalendarQueries();
        const handled = await handleCalendarMutationError(error);
        if (!handled) {
          toast({
            title: "Error",
            description: error.message || "Failed to remove assignment",
            variant: "destructive",
          });
        }
        return;
      }

      toast({
        title: "Error",
        description: error.message || "Failed to remove assignment",
        variant: "destructive",
      });
    },
  });

  // ========================================
  // Assign Technicians Mutation
  // ========================================
  const assignTechnicians = useMutation({
    mutationFn: async ({ assignmentId, technicianIds, version }: AssignTechniciansParams & { version?: number }) => {
      // Server accepts technicianUserId (singular) for primary technician
      // Use first technician as primary, or null to unassign
      const primaryTechnicianId = technicianIds.length > 0 ? technicianIds[0] : null;

      // DEV logging
      if (process.env.NODE_ENV === 'development') {
        console.log('[useCalendarDnD] assignTechnicians:', {
          assignmentId,
          technicianIds,
          primaryTechnicianId,
          version,
          endpoint: `/api/calendar/schedule/${assignmentId}`,
        });
      }

      return apiRequest(`/api/calendar/schedule/${assignmentId}`, {
        method: "PATCH",
        body: JSON.stringify({
          technicianUserId: primaryTechnicianId,
          // Include version if provided (for optimistic locking on scheduling changes)
          ...(version !== undefined && { version }),
        }),
      });
    },
    onSuccess: () => {
      invalidateCalendarQueries();
      toast({
        title: "Updated",
        description: "Technician assignment updated",
      });
    },
    onError: (error: any) => {
      // DEV logging
      if (process.env.NODE_ENV === 'development') {
        console.error('[useCalendarDnD] assignTechnicians error:', error);
      }
      toast({
        title: "Error",
        description: error.message || "Failed to assign technician",
        variant: "destructive",
      });
    },
  });

  // ========================================
  // Clear Schedule Mutations
  // ========================================
  const clearSchedule = useMutation({
    mutationFn: async (assignmentsToDelete: any[]) => {
      const unschedulePromises = assignmentsToDelete.map((assignment: any) =>
        apiRequest(`/api/calendar/unschedule/${assignment.id}`, {
          method: "POST",
          // TASK 1: No ?? 0 fallback - server must reject VERSION_NOT_INITIALIZED
          body: JSON.stringify({ version: assignment.version }),
        })
      );
      return Promise.all(unschedulePromises);
    },
    onSuccess: () => {
      invalidateCalendarQueries();
      toast({
        title: "Schedule cleared",
        description: "All jobs have been moved to unscheduled",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to clear schedule",
        variant: "destructive",
      });
    },
  });

  const clearDay = useMutation({
    mutationFn: async ({ day, dayAssignments }: { day: number; dayAssignments: any[] }) => {
      const unschedulePromises = dayAssignments.map((assignment: any) =>
        apiRequest(`/api/calendar/unschedule/${assignment.id}`, {
          method: "POST",
          // TASK 1: No ?? 0 fallback - server must reject VERSION_NOT_INITIALIZED
          body: JSON.stringify({ version: assignment.version }),
        })
      );
      return Promise.all(unschedulePromises);
    },
    onSuccess: () => {
      invalidateCalendarQueries();
      toast({
        title: "Day cleared",
        description: "All jobs for this day have been unscheduled",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to clear day",
        variant: "destructive",
      });
    },
  });

  // ========================================
  // Toggle Complete Mutation
  // ========================================
  const toggleComplete = useMutation({
    mutationFn: async ({ assignmentId, currentCompleted }: { assignmentId: string; currentCompleted: boolean }) => {
      return apiRequest(`/api/calendar/schedule/${assignmentId}`, {
        method: "PATCH",
        body: JSON.stringify({ completed: !currentCompleted }),
      });
    },
    onSuccess: (_, { currentCompleted }) => {
      invalidateCalendarQueries();
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/recently-completed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/statuses"] });
      toast({
        title: "Updated",
        description: currentCompleted ? "Marked as incomplete" : "Marked as complete",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update completion status",
        variant: "destructive",
      });
    },
  });

  // Computed saving state
  const isSavingDrag = createAssignment.isPending || updateAssignment.isPending || deleteAssignment.isPending;

  return {
    // Mutations
    createAssignment,
    updateAssignment,
    updateDuration,
    deleteAssignment,
    assignTechnicians,
    clearSchedule,
    clearDay,
    toggleComplete,

    // State
    isSavingDrag,
    savingJobIds, // Per-job saving state for visual feedback

    // Helpers
    invalidateCalendarQueries,

    // RBAC
    canSchedule,
    showViewOnlyToast,
  };
}
