/**
 * Unified Job Scheduling API
 *
 * Single entry point for all job scheduling operations:
 * - Schedule a job (timed or all-day) — POST /api/calendar/schedule (first-schedule)
 * - Reschedule existing visit — PATCH /api/calendar/visit/:visitId/reschedule
 * - Unschedule existing visit — POST /api/calendar/visit/:visitId/unschedule
 *
 * Used by:
 * - QuickAddJobDialog (new job creation with scheduling)
 * - ScheduleJobModal (calendar scheduling)
 * - Job edit views
 */

import { apiRequest, queryClient } from "./queryClient";
import { detectScheduleConflict } from "./scheduleOverlapCheck";
import type { JobScheduleValue } from "@/components/jobs/JobScheduleFields";
import type { ScheduleJobPayload as CalendarSchedulePayload } from "@/hooks/useSchedulingApi";

// ============================================================================
// Types
// ============================================================================

/** Pre-API conversion payload — extends the calendar API payload with extra fields. */
export interface ScheduleJobPayload extends Omit<CalendarSchedulePayload, "version"> {
  allDay: boolean;
  notes?: string;
}

export interface ScheduleJobResult {
  success: boolean;
  job?: any;
  error?: string;
  /** True if the saved schedule overlaps another item on the technician's schedule */
  hasConflict?: boolean;
}

// ============================================================================
// Schedule Conversion
// ============================================================================

/**
 * Convert JobScheduleValue to API payload format
 */
export function scheduleValueToPayload(
  jobId: string,
  value: JobScheduleValue,
  notes?: string
): ScheduleJobPayload | null {
  // If unscheduled, return null (handled separately)
  if (value.unscheduled) {
    return null;
  }

  // Timed event: compute start/end times (allDay removed from product UX)
  const time = value.time || "09:00"; // fallback to 9:00 AM if no time set
  const startDate = new Date(`${value.date}T${time}:00`);
  const endDate = new Date(
    startDate.getTime() + value.durationMinutes * 60000
  );

  return {
    jobId,
    allDay: false,
    date: value.date,
    startAt: startDate.toISOString(),
    endAt: endDate.toISOString(),
    durationMinutes: value.durationMinutes,
    // 2026-04-12 final cleanup: canonical crew array only.
    assignedTechnicianIds: value.assignedTechnicianIds ?? [],
    notes,
  };
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Apply scheduling to a job.
 *
 * 2026-04-18 Phase 4 (multi-visit stabilization): the legacy auto-pick of
 * "the" current visit is removed. Callers must pass `visitId` explicitly
 * when targeting an existing visit, or omit it to create a new visit.
 * For unschedule, callers must pass the specific `visitId` (and
 * optionally `visitVersion`) they want to send back to backlog.
 *
 * @param jobId - Parent job id.
 * @param value - The schedule value from JobScheduleFields.
 * @param options.visitId - Visit to update in place. When absent → create new.
 * @param options.visitVersion - Visit version for optimistic locking on update.
 */
export async function applyJobSchedule(
  jobId: string,
  value: JobScheduleValue,
  options?: {
    notes?: string;
    visitId?: string;
    visitVersion?: number;
  }
): Promise<ScheduleJobResult> {
  try {
    if (value.unscheduled) {
      if (!options?.visitId) {
        return {
          success: false,
          error: "Unschedule requires an explicit visitId. The caller must choose which visit to return to the backlog.",
        };
      }
      // Resolve version for the target visit via the canonical per-job
      // visits list. Targeted lookup (not singular pick) — caller has
      // already chosen the visit.
      let resolvedVersion = options.visitVersion;
      if (resolvedVersion === undefined) {
        try {
          const visits: Array<{ id: string; version: number }> = await apiRequest(`/api/jobs/${jobId}/visits?all=true`);
          const match = Array.isArray(visits) ? visits.find((v) => v.id === options!.visitId) : undefined;
          resolvedVersion = match?.version;
        } catch {
          // fall through; unscheduleVisit surfaces the error.
        }
      }
      return await unscheduleVisit(options.visitId, resolvedVersion);
    }

    const payload = scheduleValueToPayload(jobId, value, options?.notes);
    if (!payload) {
      return { success: false, error: "Invalid schedule value" };
    }

    let hasConflict = false;
    const leadTech = payload.assignedTechnicianIds?.[0];
    if (payload.startAt && payload.endAt && leadTech && value.date) {
      hasConflict = await detectScheduleConflict(
        leadTech, value.date,
        payload.startAt, payload.endAt,
        value.durationMinutes,
        options?.visitId,
      );
    }

    const { visitId } = options ?? {};
    let { visitVersion } = options ?? {};

    if (visitId) {
      // Explicit visit target — update in place via visit-centric endpoint.
      // If the caller didn't provide a version, fetch THIS specific visit's
      // version. This is a targeted lookup (not a singular "pick a visit"
      // auto-fetch) — the caller has already chosen which visit to update.
      if (visitVersion === undefined) {
        try {
          const visits: Array<{ id: string; version: number }> = await apiRequest(`/api/jobs/${jobId}/visits?all=true`);
          const match = Array.isArray(visits) ? visits.find((v) => v.id === visitId) : undefined;
          visitVersion = match?.version;
        } catch {
          // Fall through — server will reject without a version.
        }
      }
      if (visitVersion === undefined) {
        return {
          success: false,
          error: "Could not resolve visit version for the target visit.",
        };
      }
      const result = await apiRequest(
        `/api/calendar/visit/${visitId}/reschedule`,
        {
          method: "PATCH",
          body: JSON.stringify({
            allDay: payload.allDay,
            date: payload.date,
            startAt: payload.startAt,
            endAt: payload.endAt,
            assignedTechnicianIds: payload.assignedTechnicianIds ?? [],
            notes: payload.notes,
            version: visitVersion,
          }),
        }
      );
      invalidateScheduleQueries(jobId);
      return { success: true, job: result, hasConflict };
    }

    // No visitId → create a new visit via POST /api/calendar/schedule.
    const result = await apiRequest("/api/calendar/schedule", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    invalidateScheduleQueries(jobId);
    return { success: true, job: result, hasConflict };
  } catch (error: any) {
    console.error("[jobScheduling] applyJobSchedule error:", error);
    return {
      success: false,
      error: error.message || "Failed to schedule job",
    };
  }
}

/**
 * Unschedule a specific visit (return that visit to backlog).
 * 2026-04-18 Phase 4: accepts an explicit visitId + version. No
 * job-level "pick the current visit" auto-fetch — caller chooses.
 */
export async function unscheduleVisit(
  visitId: string,
  visitVersion?: number,
): Promise<ScheduleJobResult> {
  try {
    const result: any = await apiRequest(`/api/calendar/visit/${visitId}/unschedule`, {
      method: "POST",
      body: JSON.stringify({ version: visitVersion }),
    });

    if (result?.jobId) {
      invalidateScheduleQueries(result.jobId);
    } else {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
    }
    return { success: true };
  } catch (error: any) {
    console.error("[jobScheduling] unscheduleVisit error:", error);
    return {
      success: false,
      error: error.message || "Failed to unschedule visit",
    };
  }
}

/**
 * Create a job with scheduling in one operation
 *
 * @param jobData - Job creation data (locationId, summary, jobType, etc.)
 * @param scheduleValue - Optional schedule value (if not provided, job is unscheduled)
 */
export async function createJobWithSchedule(
  jobData: {
    locationId: string;
    summary: string;
    description?: string | null;
    jobType?: string;
    priority?: string;
    accessInstructions?: string | null;
    billingNotes?: string | null;
  },
  scheduleValue?: JobScheduleValue
): Promise<ScheduleJobResult> {
  try {
    // Status is always "open" for new jobs - scheduling is a derived state
    // The job becomes "scheduled" visually when scheduledStart is set
    const status = "open";
    const hasSchedule = scheduleValue && !scheduleValue.unscheduled;

    // 2026-04-12 (Option A): crew is forwarded by the server to the seed
    // visit — the job row no longer persists assignment. Send only the
    // canonical array; no `primaryTechnicianId` (the storage layer strips
    // legacy fields defensively but we avoid sending them).
    let jobPayload: any = {
      ...jobData,
      status,
      assignedTechnicianIds: scheduleValue?.assignedTechnicianIds ?? [],
    };

    // If has schedule data, compute scheduling fields and detect conflict
    let hasConflict = false;
    if (hasSchedule && scheduleValue) {
      const time = scheduleValue.time || "09:00"; // fallback to 9:00 AM
      const startDate = new Date(`${scheduleValue.date}T${time}:00`);
      const endDate = new Date(startDate.getTime() + scheduleValue.durationMinutes * 60000);

      jobPayload.scheduledStart = startDate.toISOString();
      jobPayload.scheduledEnd = endDate.toISOString();
      jobPayload.isAllDay = false;

      // Conflict detection: check but do NOT change scheduled times.
      // Lead tech for conflict check = first assigned (visit-centric model).
      const techId = scheduleValue.assignedTechnicianIds[0] ?? null;
      if (techId && scheduleValue.date) {
        hasConflict = await detectScheduleConflict(
          techId, scheduleValue.date,
          startDate.toISOString(), endDate.toISOString(),
          scheduleValue.durationMinutes,
        );
      }
    }

    // Create the job — save at user's requested time regardless of conflict
    const result = await apiRequest("/api/jobs", {
      method: "POST",
      body: JSON.stringify(jobPayload),
    });

    invalidateScheduleQueries();
    return { success: true, job: result, hasConflict };
  } catch (error: any) {
    console.error("[jobScheduling] createJobWithSchedule error:", error);
    return {
      success: false,
      error: error.message || "Failed to create job",
    };
  }
}

// ============================================================================
// Query Invalidation
// ============================================================================

function invalidateScheduleQueries(jobId?: string) {
  queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
  queryClient.invalidateQueries({ queryKey: ["/api/calendar/range"] });
  queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
  // Phase 4 Step C5: single family-wide invalidation covers feed + detail
  queryClient.invalidateQueries({ queryKey: ["jobs"] });
  // Fix A: Invalidate client/customer-company overview so new jobs appear on detail pages
  queryClient.invalidateQueries({ queryKey: ["/api/clients"], exact: false });
  queryClient.invalidateQueries({ queryKey: ["/api/customer-companies"], exact: false });
}
