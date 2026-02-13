/**
 * Unified Job Scheduling API
 *
 * Single entry point for all job scheduling operations:
 * - Schedule a job (timed or all-day)
 * - Unschedule a job (return to backlog)
 * - Update an existing schedule
 *
 * Used by:
 * - QuickAddJobDialog (new job creation with scheduling)
 * - ScheduleJobModal (calendar scheduling)
 * - Job edit views
 */

import { apiRequest, queryClient } from "./queryClient";
import type { JobScheduleValue } from "@/components/jobs/JobScheduleFields";
import type { ScheduleJobPayload as CalendarSchedulePayload } from "@/hooks/useCalendarApi";

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

  const isAllDay = value.isAllDay || !value.time;

  if (isAllDay) {
    // All-day event: only date needed
    return {
      jobId,
      allDay: true,
      date: value.date,
      technicianUserId: value.primaryTechnicianId || undefined,
      notes,
    };
  }

  // Timed event: compute start/end times
  const [hours, minutes] = value.time.split(":").map(Number);
  const startDate = new Date(`${value.date}T${value.time}:00`);
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
    technicianUserId: value.primaryTechnicianId || undefined,
    notes,
  };
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Apply scheduling to a job (create or update assignment)
 *
 * @param jobId - The job to schedule
 * @param value - The schedule value from JobScheduleFields
 * @param options - Additional options (notes, existingAssignmentId for updates)
 */
export async function applyJobSchedule(
  jobId: string,
  value: JobScheduleValue,
  options?: {
    notes?: string;
    existingAssignmentId?: string;
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

    // Create or update schedule (Model A: job-centric)
    if (options?.existingAssignmentId) {
      // Update existing job schedule
      const result = await apiRequest(
        `/api/calendar/schedule/${options.existingAssignmentId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            allDay: payload.allDay,
            date: payload.date,
            startAt: payload.startAt,
            endAt: payload.endAt,
            technicianUserId: payload.technicianUserId || null,
            notes: payload.notes,
          }),
        }
      );
      invalidateScheduleQueries(jobId);
      return { success: true, job: result };
    } else {
      // Schedule job (POST /api/calendar/schedule)
      const result = await apiRequest("/api/calendar/schedule", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      invalidateScheduleQueries(jobId);
      return { success: true, job: result };
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
 * Model A: Uses POST /api/calendar/unschedule/:jobId
 */
export async function unscheduleJob(
  jobId: string
): Promise<ScheduleJobResult> {
  try {
    // Model A: POST to unschedule endpoint with version in body
    await apiRequest(`/api/calendar/unschedule/${jobId}`, {
      method: "POST",
      body: JSON.stringify({ version: 0 }), // Server will fetch current version if 0
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

    // Build job payload with scheduling fields if scheduled
    let jobPayload: any = {
      ...jobData,
      status,
      primaryTechnicianId: scheduleValue?.primaryTechnicianId || null,
      assignedTechnicianIds: scheduleValue?.assignedTechnicianIds || [],
    };

    // If has schedule data, compute and include scheduling fields directly
    if (hasSchedule && scheduleValue) {
      const isAllDay = scheduleValue.isAllDay || !scheduleValue.time;

      if (isAllDay) {
        // All-day: start at 00:00:00.000Z, end at 23:59:59.000Z (same day)
        // Matches DB constraints: jobs_all_day_start_midnight_check, jobs_all_day_end_2359_check
        jobPayload.scheduledStart = `${scheduleValue.date}T00:00:00.000Z`;
        jobPayload.scheduledEnd = `${scheduleValue.date}T23:59:59.000Z`;
        jobPayload.isAllDay = true;
      } else {
        // Timed event
        const startDate = new Date(
          `${scheduleValue.date}T${scheduleValue.time}:00`
        );
        const endDate = new Date(
          startDate.getTime() + scheduleValue.durationMinutes * 60000
        );

        jobPayload.scheduledStart = startDate.toISOString();
        jobPayload.scheduledEnd = endDate.toISOString();
        jobPayload.isAllDay = false;
      }
    }

    // Create the job
    const result = await apiRequest("/api/jobs", {
      method: "POST",
      body: JSON.stringify(jobPayload),
    });

    invalidateScheduleQueries();
    return { success: true, job: result };
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
}
