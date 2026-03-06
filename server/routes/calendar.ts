import express, { Response } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { requireRole } from "../auth/requireRole";
import { jobVisitsRepository } from "../storage/jobVisits";
import { db } from "../db";
import { requireFeature } from "../auth/requireFeature";
import { MANAGER_ROLES } from "../auth/roles";
import { notificationService } from "../services/notificationService";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { calendarRepository, DEFAULT_CALENDAR_START_HOUR, DEFAULT_CALENDAR_END_HOUR } from "../storage/calendar";
import { jobRepository } from "../storage/jobs"; // Needed for notification client name lookup
import { companyRepository } from "../storage/company";
import { teamRepository } from "../storage/team";
// 2026-01-30: Removed validateSchedule import - conflict checking removed for performance
// Overbooking is now allowed; dispatchers can see conflicts visually on calendar
import { assertCanEditSchedule } from "../guards/schedulingPermissions";
import { filterSchedulableTechnicians, checkJobTechnicianVisibility, normalizeScheduleTimes } from "../domain/scheduling";
import { IS_DEV } from "../utils/devFlags";
import type { AuthedRequest } from "../auth/tenantIsolation";
import type { CalendarJobWithDetails } from "../storage/calendar";
// Phase 1 Architecture: Event Log + Attention Queue
import { logEventAsync } from "../lib/events";
import { recomputeAttentionForEntity } from "../lib/attentionRules";
import { getQueryCtx } from "../lib/queryCtx";
import type { CalendarEventDto, CalendarRangeResponseDto } from "@shared/types/calendar";

// ============================================================================
// Phase 2 Dispatch Refactor: Visit-Centric Calendar Architecture
// ============================================================================
//
// INVARIANTS:
// - Calendar shows scheduled VISITS (one event per eligible visit)
// - id = visitId (primary calendar event identity)
// - Multiple visits for the same job = multiple calendar events
// - Unscheduled sidebar still shows BACKLOG jobs (needs first visit)
// - Write mutations still use jobId (Phase 4 will transition to visitId)
//
// ENDPOINTS:
// - GET  /api/calendar?start=ISO&end=ISO     - Get visit events in range
// - POST /api/calendar/schedule              - Schedule a job (creates visit)
// - PATCH /api/calendar/schedule/:jobId      - Reschedule a job
// - POST /api/calendar/unschedule/:jobId     - Unschedule a job
// - GET  /api/calendar/unscheduled           - Get backlog jobs
// - GET  /api/calendar/state-snapshot        - Diagnostic counts
// - POST /api/calendar/resize                - Resize visit on calendar
//
// ============================================================================

// ============================================================================
// Role-Based Filtering Helper
// ============================================================================

/**
 * Filter jobs based on user role.
 * Technicians see only their assigned jobs; office roles see all.
 */
function filterJobsByRole(
  jobs: CalendarJobWithDetails[],
  userRole: string,
  userId: string
): CalendarJobWithDetails[] {
  if (MANAGER_ROLES.includes(userRole as any)) {
    return jobs;
  }
  return jobs.filter((job) => {
    if (job.primaryTechnicianId === userId) return true;
    if (Array.isArray(job.assignedTechnicianIds) && job.assignedTechnicianIds.includes(userId)) return true;
    return false;
  });
}

/**
 * Transform job to CalendarEventDto
 */
function transformToDto(job: CalendarJobWithDetails): CalendarEventDto {
  const isAllDay = job.isAllDay ?? false;

  let dateStr: string;
  if (job.scheduledStart) {
    const d = job.scheduledStart;
    dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } else {
    const today = new Date();
    dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  }

  // Canonical durationMinutes computation:
  // 1. All-day events: 1440 (24 hours)
  // 2. Timed with scheduledEnd: compute from timestamps
  // 3. Job has durationMinutes: use it
  // 4. Default: 60 minutes
  let durationMinutes: number;
  if (isAllDay) {
    durationMinutes = 1440;
  } else if (job.scheduledStart && job.scheduledEnd) {
    durationMinutes = Math.round((job.scheduledEnd.getTime() - job.scheduledStart.getTime()) / 60000);
  } else if (job.durationMinutes != null) {
    durationMinutes = job.durationMinutes;
  } else {
    durationMinutes = 60;
  }

  const startAt = job.scheduledStart?.toISOString() || null;
  const endAt = job.scheduledEnd?.toISOString() || null;

  return {
    // Phase 2: id = visitId (visit-centric identity)
    id: job.id,
    jobId: job.jobId,
    jobNumber: job.jobNumber,
    jobType: job.jobType,
    summary: job.summary,
    status: job.status,
    locationId: job.locationId,
    locationName: job.locationName,
    customerCompanyId: job.customerCompanyId,
    customerCompanyName: job.customerCompanyName,
    startAt,
    endAt,
    allDay: isAllDay,
    date: dateStr,
    durationMinutes,
    version: job.version,
    assignedTechnicianIds: job.assignedTechnicianIds,
    primaryTechnicianId: job.primaryTechnicianId,
    technicians: job.technicians,
    // Phase 2: Visit fields
    visitId: job.visitId,
    visitNumber: job.visitNumber,
    visitStatus: job.visitStatus,
    visitOutcome: job.visitOutcome,
    visitNotes: job.visitNotes ?? null,
    outcomeNote: job.outcomeNote ?? null,
    description: job.description ?? null,
    accessInstructions: job.accessInstructions ?? null,
    contactName: job.contactName ?? null,
    contactPhone: job.contactPhone ?? null,
    locationNotes: job.locationNotes ?? null,
  };
}

/**
 * Build CalendarRangeResponseDto
 * Uses company timezone from settings instead of server timezone.
 */
async function buildRangeResponse(
  companyId: string,
  jobs: CalendarJobWithDetails[],
  outsideVisibleHoursCount: number,
  hiddenTechnicianDiagnostics?: { jobId: string; hiddenTechIds: string[] }[]
): Promise<CalendarRangeResponseDto> {
  const hiddenTechMap = new Map<string, string[]>();
  if (hiddenTechnicianDiagnostics) {
    for (const diag of hiddenTechnicianDiagnostics) {
      hiddenTechMap.set(diag.jobId, diag.hiddenTechIds);
    }
  }

  const events = jobs.map(job => {
    const dto = transformToDto(job);
    const hiddenTechIds = hiddenTechMap.get(job.id);
    if (hiddenTechIds?.length) {
      dto.hasHiddenTechnician = true;
      dto.hiddenTechnicianIds = hiddenTechIds;
    }
    return dto;
  });

  // Use company timezone from settings (not server timezone)
  const timezone = await companyRepository.getCompanyTimezone(companyId);
  // Include confirmation flag so UI can show a setup banner
  const settings = await companyRepository.getCompanySettings(companyId);
  const timezoneConfirmed = Boolean(
    (settings as Record<string, unknown> | null)?.timezoneConfirmedAt
  );

  return {
    events,
    outsideVisibleHoursCount,
    timezone,
    timezoneConfirmed,
  };
}

const router = express.Router();
router.use(requireFeature("calendarEnabled"));

// ============================================================================
// Validation Schemas
// ============================================================================

const rangeQuerySchema = z.object({
  start: z.string().datetime({ message: "start must be ISO 8601 datetime" }),
  end: z.string().datetime({ message: "end must be ISO 8601 datetime" }),
});

const scheduleJobSchema = z.object({
  jobId: z.string().uuid(),
  // 2026-01-29: Accept null for unassigned drops
  // Use .nullable().optional() order for correct Zod type narrowing
  technicianUserId: z.string().uuid().nullable().optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  allDay: z.boolean().optional(),
  date: z.string().optional(),
  durationMinutes: z.number().int().min(15).optional(),
  notes: z.string().max(2000).optional(),
  version: z.number().int(),
  // Visit Reschedule Architecture: conflict resolution mode from client
  conflictMode: z.enum(['replace', 'complete_and_new']).optional(),
  conflictVisitId: z.string().uuid().optional(),
}).refine((data) => {
  if (data.allDay) return true;
  if (data.startAt && data.endAt) {
    return new Date(data.startAt) < new Date(data.endAt);
  }
  return !!data.startAt || !!data.date;
}, {
  message: "startAt must be before endAt, or provide date for all-day event",
  path: ["startAt"],
});

const rescheduleJobSchema = z.object({
  // 2026-01-29: Use .nullable().optional() order for correct Zod type narrowing
  technicianUserId: z.string().uuid().nullable().optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  allDay: z.boolean().optional(),
  date: z.string().optional(),
  notes: z.string().max(2000).nullable().optional(),
  version: z.number().int(),
  // Visit Reschedule Architecture: explicit mode for conflict resolution
  mode: z.enum(['replace', 'complete_and_new']).optional(),
}).refine((data) => {
  if (data.allDay) return true;
  if (data.startAt && data.endAt) {
    return new Date(data.startAt) < new Date(data.endAt);
  }
  return true;
}, {
  message: "startAt must be before endAt",
  path: ["startAt"],
});

const unscheduleJobSchema = z.object({
  version: z.number().int(),
});

// ============================================================================
// Bug 15 Fix: Schema Sanity Check at Module Load
// ============================================================================
// ASSERTION: Verify schemas accept null for technicianUserId
// If this fails, it indicates a Zod version issue or incorrect schema definition
// ============================================================================
if (IS_DEV) {
  const testPayloadWithNull = {
    jobId: '00000000-0000-0000-0000-000000000000',
    technicianUserId: null, // This MUST be accepted
    date: '2026-01-30',
    allDay: true,
    version: 1,
  };
  const scheduleResult = scheduleJobSchema.safeParse(testPayloadWithNull);
  if (!scheduleResult.success) {
    console.error('[CRITICAL] scheduleJobSchema does NOT accept null technicianUserId!', {
      issues: scheduleResult.error.issues,
      testPayload: testPayloadWithNull,
    });
  } else {
    console.log('[SCHEMA-CHECK] scheduleJobSchema accepts null technicianUserId ✓');
  }

  const rescheduleResult = rescheduleJobSchema.safeParse({
    technicianUserId: null,
    date: '2026-01-30',
    allDay: true,
    version: 1,
  });
  if (!rescheduleResult.success) {
    console.error('[CRITICAL] rescheduleJobSchema does NOT accept null technicianUserId!', {
      issues: rescheduleResult.error.issues,
    });
  } else {
    console.log('[SCHEMA-CHECK] rescheduleJobSchema accepts null technicianUserId ✓');
  }
}

const resizeJobSchema = z.object({
  job: z.object({
    id: z.string().uuid(),
    scheduledStart: z.string().datetime(),
    scheduledEnd: z.string().datetime(),
  }).strict(),
  newEndTime: z.string().datetime(),
});

const legacyQuerySchema = z.object({
  year: z.coerce.number().int().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

// ============================================================================
// GET /api/calendar - Range Query
// ============================================================================

router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user?.id || "";
    const userRole = req.user?.role || "technician";

    const settings = await companyRepository.getCompanySettings(companyId) as { calendarStartHour?: number } | null;
    const calendarStartHour = settings?.calendarStartHour ?? DEFAULT_CALENDAR_START_HOUR;
    const calendarEndHour = DEFAULT_CALENDAR_END_HOUR;

    if (req.query.start && req.query.end) {
      const { start, end } = validateSchema(rangeQuerySchema, req.query);
      const startDate = new Date(start);
      const endDate = new Date(end);

      const { jobs: allJobs, outsideVisibleHoursCount } =
        await calendarRepository.getScheduledJobsInRangeWithMetadata(
          companyId, startDate, endDate, calendarStartHour, calendarEndHour
        );

      const jobs = filterJobsByRole(allJobs, userRole, userId);

      let hiddenTechDiagnostics: { jobId: string; hiddenTechIds: string[] }[] = [];
      if (IS_DEV) {
        const allTeamMembers = await teamRepository.getTeamMembers(companyId);
        const { schedulable } = filterSchedulableTechnicians(allTeamMembers, "calendar:GET");
        const schedulableTechIds = new Set(schedulable.map(t => t.id));

        for (const job of jobs) {
          const visibility = checkJobTechnicianVisibility(job, schedulableTechIds);
          if (visibility.hasHiddenTechnician) {
            hiddenTechDiagnostics.push({
              jobId: job.id,
              hiddenTechIds: visibility.hiddenTechnicianIds,
            });
          }
        }
      }

      return res.json(await buildRangeResponse(companyId, jobs, outsideVisibleHoursCount, hiddenTechDiagnostics));
    }

    // Legacy year/month query
    const legacy = legacyQuerySchema.safeParse(req.query);
    if (legacy.success && legacy.data.year && legacy.data.month) {
      const { year, month } = legacy.data;
      const startDate = new Date(year, month - 1, 1, 0, 0, 0);
      const endDate = new Date(year, month, 0, 23, 59, 59);

      const { jobs: allJobs, outsideVisibleHoursCount } =
        await calendarRepository.getScheduledJobsInRangeWithMetadata(
          companyId, startDate, endDate, calendarStartHour, calendarEndHour
        );

      const jobs = filterJobsByRole(allJobs, userRole, userId);
      return res.json(await buildRangeResponse(companyId, jobs, outsideVisibleHoursCount));
    }

    res.json(await buildRangeResponse(companyId, [], 0));
  })
);

// ============================================================================
// POST /api/calendar/schedule - Schedule a Job
// ============================================================================

router.post(
  "/schedule",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    assertCanEditSchedule(req.user);

    const data = validateSchema(scheduleJobSchema, req.body);
    const isAllDay = data.allDay === true;

    // Normalize schedule times through canonical helper (enforces DB invariants)
    const normalized = normalizeScheduleTimes({
      allDay: isAllDay,
      date: data.date,
      startAt: data.startAt,
      endAt: data.endAt,
      durationMinutes: data.durationMinutes,
    });

    if (isAllDay && !normalized.scheduledStart) {
      throw createError(400, "All-day events require a date");
    }
    if (!isAllDay && !normalized.scheduledStart) {
      throw createError(400, "Start time is required for timed events");
    }

    const startAt = normalized.scheduledStart!;
    const endAt = normalized.scheduledEnd!;

    // OPTIMIZED 2026-01-30: Removed all pre-validation queries
    // - validateTechnicianBelongsToTenant: FK constraint handles this
    // - validateSchedule (conflict check): Removed - overbooking allowed
    // - Job ownership: UPDATE WHERE clause handles this
    // Result: Single database query instead of 3-4

    let result;
    try {
      result = await calendarRepository.scheduleJob(companyId, {
        jobId: data.jobId,
        technicianUserId: data.technicianUserId,
        startAt,
        endAt,
        notes: data.notes,
        allDay: isAllDay,
        expectedVersion: data.version,
        conflictMode: data.conflictMode,
        conflictVisitId: data.conflictVisitId,
      });
    } catch (error: any) {
      // Visit Reschedule Architecture: actioned visit conflict — frontend should show 2-button dialog
      if (error.code === 'VISIT_CONFLICT') {
        return res.status(409).json({
          error: error.message,
          code: 'VISIT_CONFLICT',
          conflictVisitId: error.conflictVisitId,
        });
      }
      // Handle version mismatch
      if (error.message?.includes('modified by another user')) {
        return res.status(409).json({ error: error.message, code: 'VERSION_MISMATCH' });
      }
      // Handle invalid technician (FK violation)
      if (error.code === '23503' && error.constraint?.includes('technician')) {
        throw createError(404, "Technician not found or does not belong to this company");
      }
      // Handle job not found (0 rows updated)
      if (error.message?.includes('not found')) {
        throw createError(404, "Job not found or access denied");
      }
      throw error;
    }

    if (!result) {
      throw createError(404, "Job not found or access denied");
    }

    // Async notification - fire and forget, doesn't block response
    if (data.technicianUserId) {
      (async () => {
        try {
          const jobDetails = await jobRepository.getJob(companyId, data.jobId);
          if (jobDetails) {
            const clientName = jobDetails.location?.companyName || jobDetails.location?.location || "Client";
            await notificationService.emitJobScheduled({
              companyId,
              jobId: data.jobId,
              jobNumber: String(jobDetails.jobNumber),
              clientName,
              scheduledDate: isAllDay ? (data.date || new Date().toISOString()) : startAt.toISOString(),
              technicianUserId: data.technicianUserId!,
              isReschedule: false,
            });
          }
        } catch (err) {
          console.error("Failed to emit job scheduled notification:", err);
        }
      })();
    }

    // Phase 1: Log event + recompute attention
    logEventAsync(getQueryCtx(req), {
      eventType: "job.scheduled",
      entityType: "job",
      entityId: data.jobId,
      summary: `Scheduled Job #${result.jobNumber}`,
      meta: { jobNumber: result.jobNumber, technicianUserId: data.technicianUserId },
    });
    recomputeAttentionForEntity(companyId, "job", data.jobId).catch(() => {});

    res.status(201).json({
      id: result.id,
      jobId: result.id,
      scheduledStart: result.scheduledStart?.toISOString() || null,
      scheduledEnd: result.scheduledEnd?.toISOString() || null,
      isAllDay: result.isAllDay ?? false,
      version: result.version,
      status: result.status,
      primaryTechnicianId: result.primaryTechnicianId,
      // Include visit info for client-side highlighting after follow-up creation
      visit: result.visit ? {
        id: result.visit.id,
        scheduledStart: result.visit.scheduledStart?.toISOString?.() || result.visit.scheduledStart,
        scheduledEnd: result.visit.scheduledEnd?.toISOString?.() || result.visit.scheduledEnd,
        isAllDay: result.visit.isAllDay,
        status: result.visit.status,
      } : undefined,
    });
  })
);

// ============================================================================
// PATCH /api/calendar/schedule/:jobId - Reschedule a Job
// ============================================================================

router.patch(
  "/schedule/:jobId",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const jobId = req.params.jobId;
    assertCanEditSchedule(req.user);

    const data = validateSchema(rescheduleJobSchema, req.body);

    // 2026-01-30: OPTIMIZED - Removed getJobById() call
    // Job ownership is now checked in rescheduleJob's WHERE clause
    // If job doesn't exist or doesn't belong to tenant, UPDATE returns 0 rows

    // Determine if all-day based on request (can't use existing job since we removed the fetch)
    const isAllDay = data.allDay === true;
    let computedStartAt: Date | undefined;
    let computedEndAt: Date | undefined;

    if (isAllDay) {
      // Normalize all-day times through canonical helper (enforces DB invariants)
      const normalized = normalizeScheduleTimes({
        allDay: true,
        date: data.date,
        startAt: data.startAt,
      });
      computedStartAt = normalized.scheduledStart ?? undefined;
      computedEndAt = normalized.scheduledEnd ?? undefined;
    } else if (data.startAt) {
      computedStartAt = new Date(data.startAt);
      computedEndAt = data.endAt ? new Date(data.endAt) : undefined;
    }

    // 2026-01-30: DEV logging for technician unassign debugging
    if (IS_DEV) {
      console.log('[ROUTE-DEBUG] PATCH /api/calendar/schedule/:jobId received:', {
        jobId,
        technicianUserId: data.technicianUserId,
        allDay: data.allDay,
        startAt: data.startAt,
      });
    }

    // 2026-01-30: FIX - Preserve null for explicit unassignment
    // - undefined = technicianUserId not in request (don't change)
    // - null = explicit unassign request (clear technician)
    // - string = assign to technician
    const technicianUserIdForRepo = data.technicianUserId === undefined ? undefined : (data.technicianUserId ?? null);

    let result;
    try {
      result = await calendarRepository.rescheduleJob(companyId, jobId, {
        technicianUserId: technicianUserIdForRepo,
        startAt: computedStartAt,
        endAt: computedEndAt,
        notes: data.notes ?? undefined,
        allDay: data.allDay,
        expectedVersion: data.version,
        mode: data.mode,
      });
    } catch (error: any) {
      if (error.message?.includes('modified by another user')) {
        return res.status(409).json({ error: error.message, code: 'VERSION_MISMATCH' });
      }
      throw error;
    }

    // 2026-01-30: Handle null result (job not found or tenant mismatch)
    if (!result) {
      throw createError(404, "Job not found or access denied");
    }

    // Phase 1: Log reschedule/assign event
    const eventType = data.technicianUserId !== undefined
      ? (data.technicianUserId ? "job.assigned" : "job.unassigned")
      : "job.rescheduled";
    logEventAsync(getQueryCtx(req), {
      eventType,
      entityType: "job",
      entityId: jobId,
      summary: `${eventType === "job.assigned" ? "Assigned" : eventType === "job.unassigned" ? "Unassigned" : "Rescheduled"} Job #${result.jobNumber}`,
      meta: { jobNumber: result.jobNumber, technicianUserId: data.technicianUserId },
    });
    recomputeAttentionForEntity(companyId, "job", jobId).catch(() => {});

    // Version is NOT NULL DEFAULT 1 in DB - never null after write
    res.json({
      id: result.id,
      jobId: result.id,
      scheduledStart: result.scheduledStart?.toISOString() || null,
      scheduledEnd: result.scheduledEnd?.toISOString() || null,
      isAllDay: result.isAllDay ?? false,
      version: result.version,
      status: result.status,
      primaryTechnicianId: result.primaryTechnicianId,
    });
  })
);

// ============================================================================
// POST /api/calendar/unschedule/:jobId - Unschedule a Job
// ============================================================================

router.post(
  "/unschedule/:jobId",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const jobId = req.params.jobId;
    assertCanEditSchedule(req.user);

    const data = validateSchema(unscheduleJobSchema, req.body);

    // 2026-01-30: OPTIMIZED - Removed getJobById() call
    // Job ownership is now checked in unscheduleJob's WHERE clause
    // If job doesn't exist or doesn't belong to tenant, UPDATE returns 0 rows

    let result;
    try {
      result = await calendarRepository.unscheduleJob(companyId, jobId, data.version);
    } catch (error: any) {
      if (error.message?.includes('modified by another user')) {
        return res.status(409).json({ error: error.message, code: 'VERSION_MISMATCH' });
      }
      throw error;
    }

    // 2026-01-30: Handle null result (job not found or tenant mismatch)
    if (!result) {
      throw createError(404, "Job not found or access denied");
    }

    // Phase 1: Log event + recompute attention
    logEventAsync(getQueryCtx(req), {
      eventType: "job.unscheduled",
      entityType: "job",
      entityId: jobId,
      summary: `Unscheduled Job #${result.jobNumber}`,
      meta: { jobNumber: result.jobNumber },
    });
    recomputeAttentionForEntity(companyId, "job", jobId).catch(() => {});

    // Version is NOT NULL DEFAULT 1 in DB - never null after write
    res.json({
      success: true,
      id: result.id,
      jobId: result.id,
      scheduledStart: null,
      scheduledEnd: null,
      isAllDay: false,
      version: result.version,
      status: result.status,
    });
  })
);

// ============================================================================
// GET /api/calendar/unscheduled - Backlog Jobs
// ============================================================================

router.get(
  "/unscheduled",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user?.id || "";
    const userRole = req.user?.role || "technician";

    const allUnscheduled = await calendarRepository.getUnscheduledJobs(companyId);
    const unscheduled = filterJobsByRole(allUnscheduled, userRole, userId);

    const transformedJobs = unscheduled.map((job) => ({
      id: job.id,
      jobId: job.jobId,
      jobNumber: job.jobNumber,
      jobType: job.jobType,
      summary: job.summary,
      status: job.status,
      locationId: job.locationId,
      locationName: job.locationName,
      customerCompanyId: job.customerCompanyId,
      customerCompanyName: job.customerCompanyName,
      scheduledStart: null,
      scheduledEnd: null,
      assignedTechnicianIds: job.assignedTechnicianIds,
      primaryTechnicianId: job.primaryTechnicianId,
      technicians: job.technicians,
      version: job.version,
    }));

    res.json(transformedJobs);
  })
);

// ============================================================================
// GET /api/calendar/needs-follow-up - Jobs needing follow-up visit
// ============================================================================
// Phase B: Returns jobs where the most recent visit has is_follow_up_needed=true
// (outcome was "needs_parts" or "needs_followup") and no pending visit exists.
// Used by the unscheduled sidebar "Needs Follow-Up" section.
// ============================================================================

router.get(
  "/needs-follow-up",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user?.id || "";
    const userRole = req.user?.role || "technician";

    const allFollowUps = await calendarRepository.getJobsNeedingFollowUp(companyId);
    // filterJobsByRole expects CalendarJobWithDetails — cast through since follow-up items extend it
    const followUps = filterJobsByRole(allFollowUps as any[], userRole, userId);

    const transformedJobs = followUps.map((job: any) => ({
      id: job.id,
      jobId: job.jobId,
      jobNumber: job.jobNumber,
      jobType: job.jobType,
      summary: job.summary,
      status: job.status,
      locationId: job.locationId,
      locationName: job.locationName,
      customerCompanyId: job.customerCompanyId,
      customerCompanyName: job.customerCompanyName,
      scheduledStart: null,
      scheduledEnd: null,
      assignedTechnicianIds: job.assignedTechnicianIds,
      primaryTechnicianId: job.primaryTechnicianId,
      technicians: job.technicians,
      version: job.version,
      // Follow-up context for UI display
      lastOutcome: job.lastOutcome,
      lastOutcomeNote: job.lastOutcomeNote,
      lastVisitCompletedAt: job.lastVisitCompletedAt,
      lastVisitNumber: job.lastVisitNumber,
      // Client flag: this is a follow-up item (not first-visit)
      _followUp: true,
    }));

    res.json(transformedJobs);
  })
);

// ============================================================================
// GET /api/calendar/state-snapshot - Diagnostic Endpoint
// ============================================================================

router.get(
  "/state-snapshot",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const snapshot = await calendarRepository.getStateSnapshot(companyId);

    const openEqualsScheduledPlusBacklog =
      snapshot.jobs.open === (snapshot.scheduled.open + snapshot.backlog.total);

    // Compute total violation count
    const totalViolations = Object.values(snapshot.violations).reduce(
      (sum, v) => sum + v.count,
      0
    );

    // All violations should be zero for healthy state
    const noViolations = totalViolations === 0;

    res.json({
      jobs: snapshot.jobs,
      scheduled: snapshot.scheduled,
      backlog: snapshot.backlog,
      violations: snapshot.violations,
      _invariants: {
        open_equals_scheduled_plus_backlog: openEqualsScheduledPlusBacklog,
        no_violations: noViolations,
        total_violation_count: totalViolations,
      },
      _timestamp: new Date().toISOString(),
    });
  })
);

// ============================================================================
// POST /api/calendar/resize - Resize Job on Calendar
// ============================================================================
// PHASE 4: Now writes to job_visits instead of jobs directly.
// Updates the current eligible visit's scheduled_end.
// ============================================================================

router.post(
  "/resize",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    assertCanEditSchedule(req.user);

    const validation = resizeJobSchema.safeParse(req.body);
    if (!validation.success) {
      throw createError(400, "Validation failed");
    }

    const { job, newEndTime } = validation.data;
    const newEnd = new Date(newEndTime);

    if (IS_DEV) {
      console.log('[RESIZE-DEBUG] resize (PHASE 4 - job_visits) called:', {
        jobId: job.id,
        currentEnd: job.scheduledEnd,
        newEnd: newEndTime,
      });
    }

    // Find current eligible visit for this job
    const currentVisit = await jobVisitsRepository.getCurrentEligibleVisit(companyId, job.id);
    if (!currentVisit) {
      throw createError(404, "No eligible visit found for this job");
    }

    // For all-day events, preserve the end-of-day time
    let finalEnd = newEnd;
    if (currentVisit.isAllDay) {
      // Keep all-day events at 23:59:59
      finalEnd = new Date(newEnd);
      finalEnd.setHours(23, 59, 59, 0);
    }

    // Update only scheduled_end on the visit
    await jobVisitsRepository.updateJobVisit(
      companyId,
      currentVisit.id,
      currentVisit.version,
      { scheduledEnd: finalEnd }
    );

    // Re-fetch job to return updated data
    const updatedJob = await calendarRepository.getJobById(companyId, job.id);

    if (IS_DEV) {
      console.log(
        `[Calendar] resize (PHASE 4): job=${job.id} visitId=${currentVisit.id} newEnd=${finalEnd.toISOString()}`
      );
    }

    // Return response matching existing API contract
    res.json({
      id: updatedJob?.id,
      jobId: updatedJob?.id,
      scheduledStart: updatedJob?.scheduledStart?.toISOString() || null,
      scheduledEnd: updatedJob?.scheduledEnd?.toISOString() || null,
      isAllDay: updatedJob?.isAllDay ?? false,
      version: updatedJob?.version,
      status: updatedJob?.status,
    });
  })
);

// ============================================================================
// Phase 4: Visit-Centric Write Endpoints
// ============================================================================
// These endpoints operate on visitId directly. Used by client for existing
// scheduled visit mutations. First-schedule flow still uses POST /schedule (jobId).
// ============================================================================

const visitIdParamSchema = z.object({
  visitId: z.string().uuid(),
});

// PATCH /api/calendar/visit/:visitId/reschedule - Reschedule existing visit
router.patch(
  "/visit/:visitId/reschedule",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { visitId } = validateSchema(visitIdParamSchema, req.params);
    assertCanEditSchedule(req.user);

    const data = validateSchema(rescheduleJobSchema, req.body);
    const isAllDay = data.allDay === true;
    let computedStartAt: Date | undefined;
    let computedEndAt: Date | undefined;

    if (isAllDay) {
      const normalized = normalizeScheduleTimes({ allDay: true, date: data.date, startAt: data.startAt });
      computedStartAt = normalized.scheduledStart ?? undefined;
      computedEndAt = normalized.scheduledEnd ?? undefined;
    } else if (data.startAt) {
      computedStartAt = new Date(data.startAt);
      computedEndAt = data.endAt ? new Date(data.endAt) : undefined;
    }

    const technicianUserIdForRepo = data.technicianUserId === undefined ? undefined : (data.technicianUserId ?? null);

    let result;
    try {
      result = await calendarRepository.rescheduleVisit(companyId, visitId, {
        technicianUserId: technicianUserIdForRepo,
        startAt: computedStartAt,
        endAt: computedEndAt,
        notes: data.notes ?? undefined,
        allDay: data.allDay,
        expectedVersion: data.version,
        mode: data.mode,
      });
    } catch (error: any) {
      if (error.message?.includes('modified by another user') || error.message?.includes('Expected version')) {
        return res.status(409).json({ error: error.message, code: 'VERSION_MISMATCH' });
      }
      if (error.message?.includes('not found')) {
        throw createError(404, "Visit not found or access denied");
      }
      throw error;
    }

    if (!result) {
      throw createError(404, "Visit not found or access denied");
    }

    // Log event
    const eventType = data.technicianUserId !== undefined
      ? (data.technicianUserId ? "job.assigned" : "job.unassigned")
      : "job.rescheduled";
    logEventAsync(getQueryCtx(req), {
      eventType,
      entityType: "job",
      entityId: result.id!,
      summary: `${eventType === "job.assigned" ? "Assigned" : eventType === "job.unassigned" ? "Unassigned" : "Rescheduled"} Job #${result.jobNumber} (visit ${visitId})`,
      meta: { visitId, jobNumber: result.jobNumber, technicianUserId: data.technicianUserId },
    });
    recomputeAttentionForEntity(companyId, "job", result.id!).catch(() => {});

    res.json({
      id: result.id,
      jobId: result.id,
      visitId,
      scheduledStart: result.scheduledStart?.toISOString() || null,
      scheduledEnd: result.scheduledEnd?.toISOString() || null,
      isAllDay: result.isAllDay ?? false,
      version: result.version,
      status: result.status,
      primaryTechnicianId: result.primaryTechnicianId,
    });
  })
);

// POST /api/calendar/visit/:visitId/unschedule - Unschedule existing visit
router.post(
  "/visit/:visitId/unschedule",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { visitId } = validateSchema(visitIdParamSchema, req.params);
    assertCanEditSchedule(req.user);

    const data = validateSchema(unscheduleJobSchema, req.body);

    let result;
    try {
      result = await calendarRepository.unscheduleVisit(companyId, visitId, data.version);
    } catch (error: any) {
      if (error.message?.includes('modified by another user') || error.message?.includes('Expected version')) {
        return res.status(409).json({ error: error.message, code: 'VERSION_MISMATCH' });
      }
      if (error.message?.includes('not found')) {
        throw createError(404, "Visit not found or access denied");
      }
      throw error;
    }

    if (!result) {
      throw createError(404, "Visit not found or access denied");
    }

    logEventAsync(getQueryCtx(req), {
      eventType: "job.unscheduled",
      entityType: "job",
      entityId: result.id!,
      summary: `Unscheduled visit ${visitId} from Job #${result.jobNumber}`,
      meta: { visitId, jobNumber: result.jobNumber },
    });
    recomputeAttentionForEntity(companyId, "job", result.id!).catch(() => {});

    res.json({
      success: true,
      id: result.id,
      jobId: result.id,
      visitId,
      scheduledStart: null,
      scheduledEnd: null,
      isAllDay: false,
      version: result.version,
      status: result.status,
    });
  })
);

// POST /api/calendar/visit/:visitId/resize - Resize existing visit
router.post(
  "/visit/:visitId/resize",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { visitId } = validateSchema(visitIdParamSchema, req.params);
    assertCanEditSchedule(req.user);

    const newEndTime = req.body?.newEndTime;
    if (!newEndTime) {
      throw createError(400, "newEndTime is required");
    }

    let result;
    try {
      result = await calendarRepository.resizeVisit(companyId, visitId, new Date(newEndTime));
    } catch (error: any) {
      if (error.message?.includes('not found')) {
        throw createError(404, "Visit not found or access denied");
      }
      throw error;
    }

    if (!result) {
      throw createError(404, "Visit not found or access denied");
    }

    res.json({
      id: result.id,
      jobId: result.id,
      visitId,
      scheduledStart: result.scheduledStart?.toISOString() || null,
      scheduledEnd: result.scheduledEnd?.toISOString() || null,
      isAllDay: result.isAllDay ?? false,
      version: result.version,
      status: result.status,
    });
  })
);

// ============================================================================
// GET /api/calendar/day-summary — Per-technician day stats (Phase 5B)
// ============================================================================

/** Haversine distance in meters. */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface DaySummaryVisitRow {
  visitId: string;
  scheduledStart: Date;
  scheduledEnd: Date | null;
  estimatedDurationMinutes: number | null;
  status: string;
  technicianId: string | null;
  technicianIds: string[] | null;
  locationLat: string | null;
  locationLng: string | null;
}

router.get(
  "/day-summary",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const dateStr = req.query.date ? String(req.query.date) : new Date().toISOString().split("T")[0];

    // 1) Fetch all active visits for the date
    const { rows: visitRows } = await db.execute(sql`
      SELECT
        jv.id AS "visitId",
        jv.scheduled_start AS "scheduledStart",
        jv.scheduled_end AS "scheduledEnd",
        jv.estimated_duration_minutes AS "estimatedDurationMinutes",
        jv.status,
        jv.assigned_technician_id AS "technicianId",
        jv.assigned_technician_ids AS "technicianIds",
        cl.lat AS "locationLat",
        cl.lng AS "locationLng"
      FROM job_visits jv
      JOIN jobs j ON j.id = jv.job_id AND j.company_id = ${companyId}
      LEFT JOIN client_locations cl ON cl.id = j.location_id
      WHERE jv.company_id = ${companyId}
        AND jv.is_active = true
        AND jv.archived_at IS NULL
        AND jv.scheduled_start IS NOT NULL
        AND jv.scheduled_start >= ${dateStr}::date
        AND jv.scheduled_start < ${dateStr}::date + INTERVAL '1 day'
        AND jv.status NOT IN ('cancelled')
      ORDER BY jv.scheduled_start ASC
    `);
    const visits = visitRows as unknown as DaySummaryVisitRow[];

    // 2) Fetch live positions
    const { rows: liveRows } = await db.execute(sql`
      SELECT
        lp.technician_id AS "technicianId",
        lp.last_seen_at AS "lastSeenAt",
        lp.speed
      FROM technician_live_positions lp
      WHERE lp.company_id = ${companyId}
    `);
    const liveMap = new Map<string, { lastSeenAt: Date; speed: string | null }>();
    for (const r of liveRows as any[]) {
      liveMap.set(r.technicianId, { lastSeenAt: r.lastSeenAt, speed: r.speed });
    }

    // 3) Fetch open attention items for operational rule types
    const { rows: attRows } = await db.execute(sql`
      SELECT rule_type AS "ruleType", entity_type AS "entityType", entity_id AS "entityId",
             meta
      FROM attention_items
      WHERE tenant_id = ${companyId}
        AND status = 'open'
        AND rule_type IN ('visit.late', 'visit.overdue', 'visit.running_long', 'tech.offline', 'tech.idle')
    `);

    // Build riskCounts per technician
    // For visit-level rules, map visitId → technicianId via visits
    const visitTechMap = new Map<string, string>();
    for (const v of visits) {
      const tid = v.technicianId || (v.technicianIds?.[0] ?? null);
      if (tid) visitTechMap.set(v.visitId, tid);
    }

    const techRisks = new Map<string, Record<string, number>>();
    for (const att of attRows as any[]) {
      let techId: string | null = null;
      if (att.entityType === "technician") {
        techId = att.entityId;
      } else if (att.entityType === "visit") {
        techId = visitTechMap.get(att.entityId) ||
          (att.meta?.technicianId as string) || null;
      }
      if (!techId) continue;
      if (!techRisks.has(techId)) techRisks.set(techId, {});
      const counts = techRisks.get(techId)!;
      const key = att.ruleType.replace("visit.", "").replace("tech.", "");
      counts[key] = (counts[key] || 0) + 1;
    }

    // 4) Fetch technician names
    const { rows: techRows } = await db.execute(sql`
      SELECT id, full_name AS "fullName"
      FROM users
      WHERE company_id = ${companyId}
        AND role IN ('owner', 'admin', 'manager', 'dispatcher', 'technician')
        AND is_active = true
    `);
    const techNames = new Map<string, string>();
    for (const t of techRows as any[]) {
      techNames.set(t.id, t.fullName);
    }

    // 5) Group visits by technician and compute stats
    const techVisitsMap = new Map<string, DaySummaryVisitRow[]>();
    for (const v of visits) {
      const tids = v.technicianIds?.length ? v.technicianIds : v.technicianId ? [v.technicianId] : [];
      for (const tid of tids) {
        if (!techVisitsMap.has(tid)) techVisitsMap.set(tid, []);
        techVisitsMap.get(tid)!.push(v);
      }
    }

    const now = new Date();
    const summaries = [];

    for (const [techId, techVisits] of Array.from(techVisitsMap.entries())) {
      // scheduledMinutes: sum of each visit's duration
      let scheduledMinutes = 0;
      for (const v of techVisits) {
        if (v.scheduledEnd && v.scheduledStart) {
          scheduledMinutes += Math.round((new Date(v.scheduledEnd).getTime() - new Date(v.scheduledStart).getTime()) / 60_000);
        } else {
          scheduledMinutes += v.estimatedDurationMinutes ?? 60;
        }
      }

      // driveMinutesEstimated: haversine-based 30km/h between consecutive visits
      let driveMinutes = 0;
      const sorted = [...techVisits].sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime());
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        if (prev.locationLat && prev.locationLng && curr.locationLat && curr.locationLng) {
          const distM = haversineM(
            parseFloat(prev.locationLat), parseFloat(prev.locationLng),
            parseFloat(curr.locationLat), parseFloat(curr.locationLng),
          );
          driveMinutes += Math.max(5, Math.round((distM / 1000) * 2)); // 2 min/km
        }
      }

      // Risk
      const riskCounts = techRisks.get(techId) || {};
      const hasHigh = (riskCounts.running_long || 0) > 0 || (riskCounts.overdue || 0) > 0;
      const hasWarn = (riskCounts.late || 0) > 0 || (riskCounts.offline || 0) > 0;
      const risk = hasHigh ? "high" : hasWarn ? "warn" : "ok";

      // Presence
      const live = liveMap.get(techId);
      const online = live ? (now.getTime() - new Date(live.lastSeenAt).getTime()) < 5 * 60_000 : false;

      // Next visit
      const nextVisit = sorted.find((v) => new Date(v.scheduledStart).getTime() > now.getTime());

      summaries.push({
        technicianId: techId,
        name: techNames.get(techId) || techId,
        scheduledMinutes,
        driveMinutesEstimated: driveMinutes,
        visitCount: techVisits.length,
        risk,
        riskCounts,
        online,
        lastSeenAt: live?.lastSeenAt ? new Date(live.lastSeenAt).toISOString() : undefined,
        nextVisit: nextVisit ? {
          visitId: nextVisit.visitId,
          plannedStart: new Date(nextVisit.scheduledStart).toISOString(),
        } : undefined,
      });
    }

    res.json(summaries);
  })
);

export default router;
