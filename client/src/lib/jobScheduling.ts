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
 * Fetch the current eligible visit ID for a job.
 * Returns null if job has no active, non-terminal visit.
 */
async function getCurrentVisitForJob(jobId: string): Promise<{ id: string; version: number } | null> {
  try {
    const visits: any[] = await apiRequest(`/api/jobs/${jobId}/visits`);
    const eligible = visits.find((v: any) =>
      v.isActive && !['completed', 'cancelled'].includes(v.status)
    );
    return eligible ? { id: eligible.id, version: eligible.version } : null;
  } catch {
    return null;
  }
}

/**
 * Apply scheduling to a job (create or update assignment)
 *
 * @param jobId - The job to schedule
 * @param value - The schedule value from JobScheduleFields
 * @param options - Additional options (notes, visitId for updates)
 */
export async function applyJobSchedule(
  jobId: string,
  value: JobScheduleValue,
  options?: {
    notes?: string;
    /** Visit ID for updating existing schedule. */
    visitId?: string;
    /** Visit version for optimistic locking on updates. */
    visitVersion?: number;
    /** Set true when editing an existing scheduled job without a known visitId.
     *  Triggers auto-fetch of the current eligible visit and version. */
    isUpdate?: boolean;
  }
): Promise<ScheduleJobResult> {
  try {
    if (value.unscheduled) {
      // Unschedule: clear schedule and return job to backlog
      return await unscheduleJob(jobId);
    }

    const payload = scheduleValueToPayload(jobId, value, options?.notes);
    if (!payload) {
      return { success: false, error: "Invalid schedule value" };
    }

    // Conflict detection: check for overlap but do NOT change scheduled times.
    // Lead tech for conflict check = first in canonical crew (2026-04-12).
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

    // Determine if this is an update (has visitId) or first-schedule.
    // If no visitId but isUpdate is true, fetch the current visit automatically (2026-03-06).
    let visitId = options?.visitId;
    let visitVersion = options?.visitVersion;
    if (!visitId && options?.isUpdate) {
      const currentVisit = await getCurrentVisitForJob(jobId);
      visitId = currentVisit?.id;
      visitVersion = currentVisit?.version;
    }

    if (visitId) {
      // Update existing visit via visit-centric reschedule (2026-03-06)
      // Fetch version if not provided — server requires version for optimistic locking
      if (visitVersion === undefined) {
        const fresh = await getCurrentVisitForJob(jobId);
        visitVersion = fresh?.version;
      }
      // 2026-04-12 final cleanup: canonical crew input on reschedule.
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
    } else {
      // First-schedule: POST /api/calendar/schedule (creates visit)
      const result = await apiRequest("/api/calendar/schedule", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      invalidateScheduleQueries(jobId);
      return { success: true, job: result, hasConflict };
    }
  } catch (error: any) {
    console.error("[jobScheduling] applyJobSchedule error:", error);
    return {
      success: false,
      error: error.message || "Failed to schedule job",
    };
  }
}

/**
 * Unschedule a job (return to backlog)
 * Visit-centric: fetches current visit, then unschedules via visit endpoint (2026-03-06)
 */
export async function unscheduleJob(
  jobId: string
): Promise<ScheduleJobResult> {
  try {
    const visit = await getCurrentVisitForJob(jobId);
    if (!visit) {
      return { success: false, error: "No active visit to unschedule" };
    }

    await apiRequest(`/api/calendar/visit/${visit.id}/unschedule`, {
      method: "POST",
      body: JSON.stringify({ version: visit.version }),
    });

    invalidateScheduleQueries(jobId);
    return { success: true };
  } catch (error: any) {
    console.error("[jobScheduling] unscheduleJob error:", error);
    return {
      success: false,
      error: error.message || "Failed to unschedule job",
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
