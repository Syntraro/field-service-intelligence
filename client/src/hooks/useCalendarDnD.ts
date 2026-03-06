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
 * API CONTRACT:
 * Flow A (first-schedule): POST /api/calendar/schedule { jobId, startAt, endAt, allDay?, version }
 * Flow B (visit reschedule): PATCH /api/calendar/visit/:visitId/reschedule { startAt?, endAt?, allDay?, version, technicianUserId? }
 * Flow C (visit unschedule): POST /api/calendar/visit/:visitId/unschedule { expectedVersion? }
 * Flow D (visit resize): POST /api/calendar/visit/:visitId/resize { newEndTime }
 */

import { useCallback, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { canEditSchedule } from "@/lib/schedulingPermissions";
import { handleCalendarMutationError, isVersionMismatchError } from "@/components/calendar/calendarErrorHandler";
import { DEFAULT_TIMED_DURATION_MINUTES } from "@/components/calendar/calendarUtils";
import { logVersionMismatch } from "@/lib/calendarDiagnostics";
import {
  startPerfSession,
  mark as perfMark,
  endPerfSession,
  trackInvalidation,
} from "@/lib/dndPerformance";

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
  /** Technician to assign (UUID or null to unassign) - 2026-01-29 */
  technicianUserId?: string | null;
  /** Internal: marks this as a retry attempt to prevent infinite loops */
  _isRetry?: boolean;
}

export interface UpdateAssignmentParams {
  /** Phase 4: Visit ID for existing visit events, or job ID for first-schedule */
  id: string;
  /** Phase 4: Explicit job ID (for cache matching and version fetch) */
  jobId?: string;
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
  /** Technician to assign (UUID or null to unassign) - 2026-01-28 */
  technicianUserId?: string | null;
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
// Use centralized default from calendarUtils for consistency
const DEFAULT_DURATION_MINUTES = DEFAULT_TIMED_DURATION_MINUTES;
const MAX_DURATION_MINUTES = 1440; // 24 hours

/**
 * Canonicalize a raw or optimistic event so the React Query cache
 * always contains `{ startAt, endAt }` regardless of which field names
 * the server or optimistic write used.
 *
 * Maps `scheduledStart → startAt`, `scheduledEnd → endAt`.
 * Safe no-op when fields already exist.
 */
function toCanonicalEvent(raw: any): any {
  if (!raw || typeof raw !== 'object') return raw;
  return {
    ...raw,
    startAt: raw.startAt ?? raw.scheduledStart ?? null,
    endAt: raw.endAt ?? raw.scheduledEnd ?? null,
  };
}

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

  // Invalidate only calendar queries (NOT unscheduled) - for reschedule operations
  // 2026-01-30: Split from invalidateCalendarQueries to prevent unnecessary loading spinners
  const invalidateCalendarOnly = useCallback(() => {
    perfMark('invalidate-start');

    let invalidatedCount = 0;

    // Invalidate calendar queries but NOT unscheduled
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        const matches = Array.isArray(key) && typeof key[0] === 'string' &&
                        key[0].startsWith('/api/calendar') &&
                        !key[0].includes('unscheduled');
        if (matches) {
          invalidatedCount++;
          trackInvalidation(key as unknown[]);
        }
        return matches;
      },
    });

    perfMark('invalidate-complete', { invalidatedCount, includesUnscheduled: false });
  }, []);

  // Invalidate both calendar AND unscheduled queries - for schedule/unschedule operations
  // 2026-01-30: Use this when jobs move between calendar and unscheduled sidebar
  const invalidateCalendarAndUnscheduled = useCallback(() => {
    perfMark('invalidate-start');

    let invalidatedCount = 0;

    // Invalidate all calendar queries (any view, any date range)
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        const matches = Array.isArray(key) && typeof key[0] === 'string' && key[0].startsWith('/api/calendar');
        if (matches) {
          invalidatedCount++;
          trackInvalidation(key as unknown[]);
        }
        return matches;
      },
    });
    // EXPLICITLY invalidate unscheduled - this is critical for unschedule consistency
    queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
    invalidatedCount++;
    trackInvalidation(["/api/calendar/unscheduled"]);

    // Also invalidate clients (may have nextDue updates)
    queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
    invalidatedCount++;
    trackInvalidation(["/api/clients"]);

    perfMark('invalidate-complete', { invalidatedCount, includesUnscheduled: true });
  }, []);

  // Alias for backward compatibility - uses the full invalidation
  const invalidateCalendarQueries = invalidateCalendarAndUnscheduled;

  /**
   * Canonicalize all events in the current calendar query cache so every
   * entry carries `{ startAt, endAt }`.  Must be called after
   * `refetchCalendar()` resolves, because the fresh server response may
   * contain `scheduledStart`/`scheduledEnd` instead of `startAt`/`endAt`.
   */
  const canonicalizeCalendarCache = useCallback(() => {
    const queryKey = getCalendarQueryKey();
    const cached = queryClient.getQueryData(queryKey) as any;
    if (!cached || typeof cached !== 'object') return;
    const rawEvents = cached.events ?? cached.assignments;
    if (!Array.isArray(rawEvents)) return;
    queryClient.setQueryData(queryKey, {
      ...cached,
      events: rawEvents.map(toCanonicalEvent),
    });
  }, [getCalendarQueryKey]);

  /**
   * Merge server response into calendar cache without full refetch.
   * This replaces the optimistic placeholder with real server data.
   */
  const mergeServerResponseIntoCache = useCallback((
    serverResult: any,
    jobId: string,
    operation: 'schedule' | 'reschedule' | 'unschedule'
  ) => {
    if (!serverResult && operation !== 'unschedule') return;

    const queryKey = getCalendarQueryKey();
    const cached = queryClient.getQueryData(queryKey) as any;

    if (!cached || typeof cached !== 'object') return;

    const currentEvents = cached.events ?? cached.assignments ?? [];

    if (operation === 'unschedule') {
      // Remove the job from calendar (optimistic already did this, but confirm)
      const filteredEvents = currentEvents.filter((e: any) =>
        e.id !== jobId && e.jobId !== jobId
      );
      queryClient.setQueryData(queryKey, {
        ...cached,
        events: filteredEvents,
      });
    } else {
      // Schedule or reschedule: merge server response into the event
      const updatedEvents = currentEvents.map((e: any) => {
        const isMatch = e.id === jobId || e.jobId === jobId ||
                        e.id === serverResult?.id || e.jobId === serverResult?.jobId;
        if (isMatch) {
          return toCanonicalEvent({
            ...e,
            ...serverResult,
            _optimistic: false,
            _saving: false,
          });
        }
        return e;
      });

      queryClient.setQueryData(queryKey, {
        ...cached,
        events: updatedEvents,
      });
    }
  }, [getCalendarQueryKey]);

  /**
   * Narrow invalidation - only invalidate what's necessary.
   * Called after merging server response, not instead of it.
   */
  const invalidateNarrow = useCallback((includeUnscheduled: boolean = false) => {
    // Only invalidate unscheduled if this operation affects it
    if (includeUnscheduled) {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      // Phase B: Also invalidate follow-up query (scheduling a follow-up removes it from that section)
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/needs-follow-up"] });
    }
    // DO NOT invalidate /api/clients or all /api/calendar queries
    // The cache merge handles the calendar update directly
  }, []);

  // ========================================
  // Create Assignment Mutation
  // ========================================
  const createAssignment = useMutation({
    mutationFn: async (params: CreateAssignmentParams) => {
      // PERF: Start session for schedule operation
      startPerfSession('schedule', params.jobId);
      perfMark('mutation-fn-start');

      const { jobId, day, scheduledHour, scheduledStartMinutes = 0, durationMinutes = 60, targetYear, targetMonth, allDay, version, technicianUserId } = params;

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

      // Include technicianUserId if provided (for technician assignment during scheduling)
      if (technicianUserId !== undefined) {
        payload.technicianUserId = technicianUserId;
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

      perfMark('server-response-received');
      return response;
    },
    onMutate: async (params) => {
      perfMark('on-mutate-start');

      // Mark job as saving for visual feedback
      markJobSaving(params.jobId);

      // Cancel any outgoing refetches for both calendar and unscheduled
      await queryClient.cancelQueries({ queryKey: getCalendarQueryKey() });
      await queryClient.cancelQueries({ queryKey: ["/api/calendar/unscheduled"] });

      perfMark('queries-cancelled');

      // Snapshot current data for rollback
      const queryKey = getCalendarQueryKey();
      const previousCalendarData = queryClient.getQueryData(queryKey);
      const previousUnscheduledData = queryClient.getQueryData(["/api/calendar/unscheduled"]);
      snapshotRef.current = { queryKey, data: previousCalendarData };

      // Find the unscheduled item to use for calendar event metadata
      let unscheduledItem: any = null;
      if (Array.isArray(previousUnscheduledData)) {
        unscheduledItem = previousUnscheduledData.find((item: any) =>
          item.id === params.jobId || item.jobId === params.jobId
        );
      }

      // Optimistic update: add a placeholder event with canonical startAt/endAt
      // so normalizeAssignments() picks up the exact drop time (not stale cached values)
      // 2026-01-28: Also includes metadata from unscheduled item for better visual feedback
      const prev = previousCalendarData as any;
      if (prev && typeof prev === 'object' && ('events' in prev || 'assignments' in prev)) {
        const currentEvents = prev.events ?? prev.assignments ?? [];
        const isAllDay = params.allDay ?? (params.scheduledHour === null || params.scheduledHour === undefined);
        const dateStr = buildISODate(params.targetYear, params.targetMonth, params.day);
        let startAt: string | null = null;
        let endAt: string | null = null;
        if (!isAllDay && params.scheduledHour != null) {
          const range = computeTimedEventRange(
            params.targetYear, params.targetMonth, params.day,
            params.scheduledHour, params.scheduledStartMinutes ?? 0,
            params.durationMinutes ?? DEFAULT_DURATION_MINUTES
          );
          if (range) { startAt = range.startAt; endAt = range.endAt; }
        }
        // 2026-01-29: Build technician fields for optimistic update to prevent "flash to Unassigned"
        let optimisticTechFields: Record<string, any> = {};
        if (params.technicianUserId !== undefined && params.technicianUserId !== null) {
          optimisticTechFields = {
            primaryTechnicianId: params.technicianUserId,
            assignedTechnicianId: params.technicianUserId,
            assignedTechnicianIds: [params.technicianUserId],
          };
        } else {
          // Explicitly unassigned
          optimisticTechFields = {
            primaryTechnicianId: null,
            assignedTechnicianId: null,
            assignedTechnicianIds: [],
          };
        }

        const optimisticEvent = {
          id: `optimistic-${Date.now()}`,
          jobId: params.jobId,
          year: params.targetYear,
          month: params.targetMonth,
          day: params.day,
          date: dateStr,
          startAt,
          endAt,
          allDay: isAllDay,
          scheduledHour: params.scheduledHour ?? null,
          scheduledStartMinutes: params.scheduledStartMinutes ?? 0,
          durationMinutes: params.durationMinutes ?? 60,
          isAllDay,
          // Include metadata from unscheduled item for visual display
          companyName: unscheduledItem?.companyName || unscheduledItem?.customerCompanyName,
          locationName: unscheduledItem?.locationName || unscheduledItem?.location,
          jobNumber: unscheduledItem?.jobNumber,
          clientId: unscheduledItem?.clientId || unscheduledItem?.locationId,
          locationId: unscheduledItem?.locationId || unscheduledItem?.clientId,
          // 2026-01-29: Include technician fields for immediate correct placement
          ...optimisticTechFields,
          _optimistic: true,
          _saving: true,
        };

        queryClient.setQueryData(queryKey, {
          ...prev,
          events: [...currentEvents, toCanonicalEvent(optimisticEvent)],
        });
      }

      // Optimistic update: remove from unscheduled list immediately
      if (Array.isArray(previousUnscheduledData)) {
        const filteredUnscheduled = previousUnscheduledData.filter((item: any) =>
          item.id !== params.jobId && item.jobId !== params.jobId
        );
        queryClient.setQueryData(["/api/calendar/unscheduled"], filteredUnscheduled);
      }

      perfMark('optimistic-update-complete');
      return { previousCalendarData, previousUnscheduledData, queryKey };
    },
    onSuccess: async (result, params) => {
      perfMark('on-success-start');

      // DEV diagnostic: log server response for minute-precision tracing
      if (process.env.NODE_ENV === 'development') {
        console.log('[DROP-RESULT] createAssignment:', {
          jobId: params.jobId,
          serverStartAt: result?.startAt ?? result?.scheduledStart,
          serverEndAt: result?.endAt ?? result?.scheduledEnd,
          serverVersion: result?.version,
          allDay: result?.allDay,
        });
      }

      clearJobSaving(params.jobId);
      snapshotRef.current = null;

      // Merge server response into cache (replaces optimistic with real data)
      mergeServerResponseIntoCache(result, params.jobId, 'schedule');
      perfMark('cache-merged');

      // Show success toast
      toast({
        title: "Job scheduled",
        description: "The job has been added to the calendar",
      });

      // Only invalidate unscheduled list (job moved from there)
      // No full refetch needed - optimistic update + merge is sufficient
      invalidateNarrow(true);
      // Phase 5.2: job list and dashboard stale after DnD schedule
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      perfMark('invalidation-complete');

      endPerfSession(true);
    },
    onError: async (error: any, params, context) => {
      perfMark('on-error', { error: error.message });

      clearJobSaving(params.jobId);
      // Rollback calendar to snapshot
      if (context?.previousCalendarData && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previousCalendarData);
      }
      // Rollback unscheduled to snapshot (restore the item that was optimistically removed)
      if (context?.previousUnscheduledData) {
        queryClient.setQueryData(["/api/calendar/unscheduled"], context.previousUnscheduledData);
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
      endPerfSession(false);
    },
  });

  // ========================================
  // Update Assignment Mutation
  // ========================================
  const updateAssignment = useMutation({
    mutationFn: async (params: UpdateAssignmentParams) => {
      // PERF: Start session for reschedule operation
      startPerfSession('reschedule', params.id);
      perfMark('mutation-fn-start');

      const { id, day, scheduledHour, scheduledStartMinutes = 0, durationMinutes = 60, allDay, version, technicianUserId } = params;
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
        // 2026-01-30: When converting from all-day (1440 min) to timed, use default duration
        let effectiveDuration = durationMinutes;
        if (effectiveDuration === 1440 || effectiveDuration > 480) {
          // 1440 = all-day, anything > 8 hours is probably wrong for a timed event
          effectiveDuration = DEFAULT_DURATION_MINUTES;
          if (process.env.NODE_ENV === 'development') {
            console.log('[useCalendarDnD] Clamped duration from', durationMinutes, 'to', effectiveDuration, '(all-day to timed conversion)');
          }
        }

        const timeRange = computeTimedEventRange(
          useYear, useMonth, day,
          scheduledHour, scheduledStartMinutes ?? 0,
          effectiveDuration
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

      // Include technicianUserId if provided (for technician assignment during drag/drop)
      if (technicianUserId !== undefined) {
        payload.technicianUserId = technicianUserId;
      }

      if (process.env.NODE_ENV === 'development') {
        console.log('[useCalendarDnD] updateAssignment API payload:', payload, 'id:', id);
      }

      // Phase 4: Use visit-centric endpoint for existing visit events
      const response = await apiRequest(`/api/calendar/visit/${id}/reschedule`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      if (process.env.NODE_ENV === 'development') {
        console.log('[useCalendarDnD] updateAssignment response:', response);
      }

      perfMark('server-response-received');
      return response;
    },
    onMutate: async (params) => {
      perfMark('on-mutate-start');

      // Phase 4: Mark visitId as saving for visual feedback
      markJobSaving(params.id);

      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: getCalendarQueryKey() });

      perfMark('queries-cancelled');

      // Snapshot current data for rollback
      const queryKey = getCalendarQueryKey();
      const previousData = queryClient.getQueryData(queryKey);
      snapshotRef.current = { queryKey, data: previousData };

      // Use provided values or fall back to hook's year/month for optimistic update
      const useYear = params.targetYear ?? year;
      const useMonth = params.targetMonth ?? month;

      // Optimistic update: modify the event in place with canonical startAt/endAt
      // Override old startAt/endAt so normalizeAssignments() uses the new drop time
      // 2026-01-28: Also update technician assignment for instant visual feedback
      const prev = previousData as any;
      if (prev && typeof prev === 'object' && ('events' in prev || 'assignments' in prev)) {
        const currentEvents = prev.events ?? prev.assignments ?? [];
        const updatedEvents = currentEvents.map((a: any) => {
          // Phase 4: params.id is visitId — match directly
          if (a.id === params.id) {
            const isAllDay = params.allDay ?? (params.scheduledHour === null || params.scheduledHour === undefined);
            const dateStr = buildISODate(useYear, useMonth, params.day);
            let startAt: string | null = null;
            let endAt: string | null = null;
            let effectiveDur = a.durationMinutes ?? DEFAULT_DURATION_MINUTES;
            if (!isAllDay) {
              const hour = params.scheduledHour ?? a.scheduledHour ?? 9;
              const mins = params.scheduledStartMinutes ?? a.scheduledStartMinutes ?? 0;
              const rawDur = params.durationMinutes ?? a.durationMinutes ?? DEFAULT_DURATION_MINUTES;
              // 2026-01-30: When converting from all-day to timed, force default duration
              const isConvertingFromAllDay = a.isAllDay && !isAllDay;
              effectiveDur = (isConvertingFromAllDay || rawDur === 1440 || rawDur > 480)
                ? DEFAULT_DURATION_MINUTES
                : rawDur;
              const range = computeTimedEventRange(useYear, useMonth, params.day, hour, mins, effectiveDur);
              if (range) { startAt = range.startAt; endAt = range.endAt; }
            }

            // Build technician fields for optimistic update
            let technicianFields: Record<string, any> = {};
            if (params.technicianUserId !== undefined) {
              if (params.technicianUserId === null) {
                // Unassigning technician
                technicianFields = {
                  assignedTechnicianId: null,
                  assignedTechnicianIds: [],
                };
              } else {
                // Assigning to specific technician
                technicianFields = {
                  assignedTechnicianId: params.technicianUserId,
                  assignedTechnicianIds: [params.technicianUserId],
                };
              }
            }

            return toCanonicalEvent({
              ...a,
              year: useYear,
              month: useMonth,
              day: params.day,
              date: dateStr,
              startAt,
              endAt,
              allDay: isAllDay,
              // FIX (2026-03-06): Patch durationMinutes on raw event so ResizableJobCard
              // reads the correct value during optimistic render (not stale 1440 from all-day)
              durationMinutes: isAllDay ? (a.durationMinutes ?? 1440) : effectiveDur,
              scheduledHour: params.scheduledHour ?? a.scheduledHour,
              scheduledStartMinutes: params.scheduledStartMinutes ?? a.scheduledStartMinutes,
              isAllDay,
              ...technicianFields,
              _optimistic: true,
              _saving: true,
            });
          }
          return a;
        });

        queryClient.setQueryData(queryKey, {
          ...prev,
          events: updatedEvents,
        });
      }

      perfMark('optimistic-update-complete');
      return { previousData, queryKey };
    },
    onSuccess: async (result, params) => {
      perfMark('on-success-start');

      // DEV diagnostic: log server response for minute-precision tracing
      if (process.env.NODE_ENV === 'development') {
        console.log('[DROP-RESULT] updateAssignment:', {
          jobId: params.id,
          serverStartAt: result?.startAt ?? result?.scheduledStart,
          serverEndAt: result?.endAt ?? result?.scheduledEnd,
          serverVersion: result?.version,
          allDay: result?.allDay,
        });
      }

      clearJobSaving(params.id);
      snapshotRef.current = null;

      // Merge server response into cache (replaces optimistic with real data)
      mergeServerResponseIntoCache(result, params.id, 'reschedule');
      perfMark('cache-merged');

      // Show success toast
      toast({
        title: "Updated",
        description: "The job has been rescheduled",
      });

      // No invalidation needed for reschedule - job stays in calendar
      // Optimistic update + merge is sufficient
      perfMark('invalidation-complete');

      endPerfSession(true);
    },
    onError: async (error: any, params, context) => {
      perfMark('on-error', { error: error.message });

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
          `/api/calendar/visit/${params.id}/reschedule`
        );

        // Refetch calendar to get fresh versions for next attempt
        // Phase 4: visit-centric reschedule uses visit.version, auto-retry not yet supported
        await refetchCalendar();
        invalidateCalendarOnly();

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
      endPerfSession(false);
    },
  });

  // ========================================
  // Update Duration Mutation
  // ========================================
  const updateDuration = useMutation({
    mutationFn: async ({ id, durationMinutes, assignment }: { id: string; durationMinutes: number; assignment?: any; version?: number }) => {
      // Phase 4: Use visit-centric resize endpoint
      const scheduledStart = assignment?.scheduledStart || assignment?.startAt;

      if (scheduledStart) {
        const newEndTime = new Date(new Date(scheduledStart).getTime() + durationMinutes * 60_000).toISOString();
        return apiRequest(`/api/calendar/visit/${id}/resize`, {
          method: "POST",
          body: JSON.stringify({ newEndTime }),
        });
      }

      // Fallback: if no schedule data available, try legacy PATCH with version
      const payload: Record<string, unknown> = { durationMinutes };
      const version = assignment?.version;
      if (version !== undefined) payload.version = version;
      return apiRequest(`/api/calendar/schedule/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: async () => {
      await refetchCalendar();
      canonicalizeCalendarCache();
      // Duration change doesn't affect unscheduled list
      invalidateCalendarOnly();
    },
    onError: async (error: any, params) => {
      // DEV logging
      if (process.env.NODE_ENV === 'development') {
        console.error('[useCalendarDnD] updateDuration error:', error, 'params:', params);
      }

      // VERSION_MISMATCH (409): Log to diagnostics and refetch
      if (isVersionMismatchError(error)) {
        logVersionMismatch(
          params.id,
          params.assignment?.version,
          error.message || 'Version mismatch',
          'POST',
          `/api/calendar/resize`
        );
        // Refetch calendar to get fresh versions (duration change doesn't affect unscheduled)
        await refetchCalendar();
        invalidateCalendarOnly();
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
      // PERF: Start session for unschedule operation
      // Phase 4: id is visitId for existing visit events
      startPerfSession('unschedule', id);
      perfMark('mutation-fn-start');

      // DEV logging
      if (process.env.NODE_ENV === 'development') {
        console.log('[useCalendarDnD] deleteAssignment (unschedule) starting:', { id, version, jobId, jobNumber });
      }
      // Phase 4: Use visit-centric unschedule endpoint (id = visitId)
      const response = await apiRequest(`/api/calendar/visit/${id}/unschedule`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: version }),
      });
      perfMark('server-response-received');
      return response;
    },
    onMutate: async ({ id }) => {
      perfMark('on-mutate-start');

      // Mark job as saving for visual feedback
      markJobSaving(id);

      // Cancel any outgoing refetches for both calendar and unscheduled
      await queryClient.cancelQueries({ queryKey: getCalendarQueryKey() });
      await queryClient.cancelQueries({ queryKey: ["/api/calendar/unscheduled"] });

      perfMark('queries-cancelled');

      // Snapshot current data for rollback
      const queryKey = getCalendarQueryKey();
      const previousCalendarData = queryClient.getQueryData(queryKey);
      const previousUnscheduledData = queryClient.getQueryData(["/api/calendar/unscheduled"]);

      // Find the event being deleted (to use for optimistic unscheduled insert)
      // Phase 4: id is visitId — match directly
      const prevCal = previousCalendarData as any;
      let deletedEvent: any = null;
      if (prevCal && typeof prevCal === 'object' && ('events' in prevCal || 'assignments' in prevCal)) {
        const currentEvents = prevCal.events ?? prevCal.assignments ?? [];
        deletedEvent = currentEvents.find((a: any) => a.id === id);
      }

      // Optimistic update: remove from calendar
      if (prevCal && typeof prevCal === 'object' && ('events' in prevCal || 'assignments' in prevCal)) {
        const currentEvents = prevCal.events ?? prevCal.assignments ?? [];
        const filteredEvents = currentEvents.filter(
          // Phase 4: id is visitId — match directly
          (a: any) => a.id !== id
        );

        queryClient.setQueryData(queryKey, {
          ...prevCal,
          events: filteredEvents,
        });
      }

      // Optimistic update: add placeholder to unscheduled list
      if (deletedEvent && Array.isArray(previousUnscheduledData)) {
        const optimisticUnscheduledItem = {
          id: deletedEvent.jobId || deletedEvent.id,
          jobId: deletedEvent.jobId || deletedEvent.id,
          jobNumber: deletedEvent.jobNumber,
          companyName: deletedEvent.companyName || deletedEvent.clientName || 'Unscheduling...',
          locationName: deletedEvent.locationName || deletedEvent.location || '',
          month: deletedEvent.month,
          year: deletedEvent.year,
          status: 'existing',
          _optimistic: true,
        };
        queryClient.setQueryData(["/api/calendar/unscheduled"], [optimisticUnscheduledItem, ...previousUnscheduledData]);
      }

      perfMark('optimistic-update-complete');
      return { previousCalendarData, previousUnscheduledData, queryKey, deletedEvent };
    },
    onSuccess: async (result, params) => {
      perfMark('on-success-start');

      clearJobSaving(params.id);

      // DEV logging - critical for debugging unschedule consistency
      if (process.env.NODE_ENV === 'development') {
        console.log('[useCalendarDnD] deleteAssignment SUCCESS:', {
          assignmentId: params.id,
          jobId: params.jobId,
          version: params.version,
          action: 'merged into cache',
        });
      }

      // Merge: ensure job is removed from calendar cache
      mergeServerResponseIntoCache(result, params.jobId || params.id, 'unschedule');
      perfMark('cache-merged');

      // Show success toast
      toast({
        title: "Removed",
        description: "The job has been unscheduled",
      });

      // Only invalidate unscheduled list (job moved there)
      invalidateNarrow(true);
      // Phase 5.2: job list and dashboard stale after DnD unschedule
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      perfMark('invalidation-complete');

      endPerfSession(true);
    },
    onError: async (error: any, params, context) => {
      perfMark('on-error', { error: error.message });

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
      endPerfSession(false);
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
          endpoint: `/api/calendar/visit/${assignmentId}/reschedule`,
        });
      }

      // Phase 4: Use visit-centric reschedule endpoint (assignmentId = visitId)
      return apiRequest(`/api/calendar/visit/${assignmentId}/reschedule`, {
        method: "PATCH",
        body: JSON.stringify({
          technicianUserId: primaryTechnicianId,
          // Include version if provided (for optimistic locking)
          ...(version !== undefined && { version }),
        }),
      });
    },
    onSuccess: () => {
      // Technician assignment doesn't affect unscheduled list
      invalidateCalendarOnly();
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
      // Phase 4: assignment.id = visitId — use visit-centric unschedule
      const unschedulePromises = assignmentsToDelete.map((assignment: any) =>
        apiRequest(`/api/calendar/visit/${assignment.id}/unschedule`, {
          method: "POST",
          body: JSON.stringify({ expectedVersion: assignment.version }),
        })
      );
      return Promise.all(unschedulePromises);
    },
    onSuccess: () => {
      // Jobs move to unscheduled - need full invalidation
      invalidateCalendarAndUnscheduled();
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
      // Phase 4: assignment.id = visitId — use visit-centric unschedule
      const unschedulePromises = dayAssignments.map((assignment: any) =>
        apiRequest(`/api/calendar/visit/${assignment.id}/unschedule`, {
          method: "POST",
          body: JSON.stringify({ expectedVersion: assignment.version }),
        })
      );
      return Promise.all(unschedulePromises);
    },
    onSuccess: () => {
      // Jobs move to unscheduled - need full invalidation
      invalidateCalendarAndUnscheduled();
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
      // Phase 4: assignmentId = visitId — use visit-centric reschedule
      return apiRequest(`/api/calendar/visit/${assignmentId}/reschedule`, {
        method: "PATCH",
        body: JSON.stringify({ completed: !currentCompleted }),
      });
    },
    onSuccess: (_, { currentCompleted }) => {
      // Completion status change doesn't affect unscheduled list
      invalidateCalendarOnly();
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

  // Computed saving states - 2026-01-30: Split for granular loading indicators
  // Shows loading for operations that affect unscheduled panel (schedule from/unschedule to)
  const isSavingUnscheduled = createAssignment.isPending || deleteAssignment.isPending;
  // Shows loading for any drag operation (for calendar visual feedback)
  const isSavingAnyDrag = createAssignment.isPending || updateAssignment.isPending || deleteAssignment.isPending;

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

    // State - 2026-01-30: Split saving states for granular loading indicators
    isSavingDrag: isSavingAnyDrag,  // Any drag operation (calendar feedback)
    isSavingUnscheduled,             // Only schedule/unschedule (sidebar feedback)
    savingJobIds,                    // Per-job saving state for visual feedback

    // Helpers - 2026-01-30: Split invalidation for performance
    invalidateCalendarQueries,       // Alias for invalidateCalendarAndUnscheduled (backward compat)
    invalidateCalendarOnly,          // Use for reschedule/duration/assignment changes
    invalidateCalendarAndUnscheduled, // Use for schedule/unschedule operations

    // RBAC
    canSchedule,
    showViewOnlyToast,
  };
}
