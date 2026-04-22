/**
 * Job creation + conflict-detection helpers.
 *
 * 2026-04-21 Phase 1.5: this module used to own `applyJobSchedule` +
 * `unscheduleVisit` helpers (a parallel client orchestration path for
 * visit writes). Those helpers were REMOVED when every caller migrated to
 * the canonical `useDispatchPreviewMutations` hook.
 *
 * What remains here:
 * - `createJobWithSchedule` — POST /api/jobs (job creation with seed visit).
 *   Not a visit mutation; the server creates the initial visit inside the
 *   same tx as the job. Used by `QuickAddJobDialog`.
 * - `ScheduleJobResult` — return shape shared by the above.
 */

import { apiRequest, queryClient } from "./queryClient";
import { detectScheduleConflict } from "./scheduleOverlapCheck";
import type { JobScheduleValue } from "@/components/jobs/JobScheduleFields";

// ============================================================================
// Types
// ============================================================================

export interface ScheduleJobResult {
  success: boolean;
  job?: any;
  error?: string;
  /** True if the saved schedule overlaps another item on the technician's schedule */
  hasConflict?: boolean;
}

// ============================================================================
// API Functions
// ============================================================================

// ============================================================================
// 2026-04-21 Phase 1.5 canonicalization: `applyJobSchedule`,
// `unscheduleVisit`, `scheduleValueToPayload`, and `ScheduleJobPayload`
// REMOVED.
//
// Those functions were a parallel client orchestration path for visit
// schedule / reschedule / unschedule. Every office surface that used to
// call them now uses `useDispatchPreviewMutations` from
// `@/components/dispatch/useDispatchPreviewMutations` directly — the
// canonical hook owns optimistic patching, version caching, per-visit
// serialization, and invalidation.
//
// Do NOT add a new schedule/reschedule/unschedule helper here. Every new
// office visit write goes through the hook.
// ============================================================================

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
