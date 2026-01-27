import express, { Response } from "express";
import { z } from "zod";
import { resizeJobTime } from "../services/calendarService";
import { requireRole } from "../auth/requireRole";
import { requireFeature } from "../auth/requireFeature";
import { MANAGER_ROLES } from "../auth/roles";
import { notificationService } from "../services/notificationService";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { calendarRepository, DEFAULT_CALENDAR_START_HOUR, DEFAULT_CALENDAR_END_HOUR } from "../storage/calendar";
import { jobRepository } from "../storage/jobs";
import { companyRepository } from "../storage/company";
import { teamRepository } from "../storage/team";
import { validateSchedule, ScheduleValidationError } from "../services/calendarValidation";
import { assertCanEditSchedule } from "../guards/schedulingPermissions";
import { filterSchedulableTechnicians, checkJobTechnicianVisibility } from "../domain/scheduling";
import type { AuthedRequest } from "../auth/tenantIsolation";
import type { CalendarAssignmentWithDetails } from "../storage/calendar";
import type { CalendarEventDto, CalendarRangeResponseDto } from "@shared/types/calendar";

// ============================================================================
// MODEL A: Job-Based Calendar Architecture
// ============================================================================
//
// INVARIANTS:
// - Calendar shows scheduled JOBS (jobs with scheduledStart IS NOT NULL)
// - Unscheduled sidebar shows BACKLOG jobs (open jobs with scheduledStart IS NULL)
// - Events on the calendar ARE jobs, keyed by jobId only
// - No separate "assignment" entity exists
//
// ENDPOINTS:
// - GET  /api/calendar?start=ISO&end=ISO     - Get scheduled jobs in range
// - POST /api/calendar/schedule              - Schedule a job
// - PATCH /api/calendar/schedule/:jobId      - Reschedule a job
// - POST /api/calendar/unschedule/:jobId     - Unschedule a job
// - GET  /api/calendar/unscheduled           - Get backlog jobs
// - GET  /api/calendar/state-snapshot        - Diagnostic counts
// - POST /api/calendar/resize                - Resize job on calendar
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
  jobs: CalendarAssignmentWithDetails[],
  userRole: string,
  userId: string
): CalendarAssignmentWithDetails[] {
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
function transformToDto(job: CalendarAssignmentWithDetails): CalendarEventDto {
  const isAllDay = job.isAllDay ?? false;

  let dateStr: string;
  if (job.scheduledStart) {
    const d = job.scheduledStart;
    dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } else {
    const today = new Date();
    dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  }

  const durationMinutes = isAllDay
    ? 1440
    : (job.scheduledStart && job.scheduledEnd
      ? Math.round((job.scheduledEnd.getTime() - job.scheduledStart.getTime()) / 60000)
      : 60);

  const startAt = job.scheduledStart?.toISOString() || null;
  const endAt = job.scheduledEnd?.toISOString() || null;

  return {
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
    // Version from DB - NOT NULL DEFAULT 1 after migration, no fallback needed
    version: job.version,
    assignedTechnicianIds: job.assignedTechnicianIds,
    primaryTechnicianId: job.primaryTechnicianId,
    technicians: job.technicians,
  };
}

/**
 * Get server timezone (IANA format)
 */
function getServerTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

/**
 * Build CalendarRangeResponseDto
 */
function buildRangeResponse(
  jobs: CalendarAssignmentWithDetails[],
  outsideVisibleHoursCount: number,
  hiddenTechnicianDiagnostics?: { jobId: string; hiddenTechIds: string[] }[]
): CalendarRangeResponseDto {
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

  return {
    events,
    outsideVisibleHoursCount,
    timezone: getServerTimezone(),
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
  technicianUserId: z.string().uuid().optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  allDay: z.boolean().optional(),
  date: z.string().optional(),
  durationMinutes: z.number().int().min(15).optional(),
  notes: z.string().max(2000).optional(),
  version: z.number().int(),
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
  technicianUserId: z.string().uuid().optional().nullable(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  allDay: z.boolean().optional(),
  date: z.string().optional(),
  notes: z.string().max(2000).optional().nullable(),
  version: z.number().int(),
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

      const { assignments: allJobs, outsideVisibleHoursCount } =
        await calendarRepository.getAssignmentsInRangeWithMetadata(
          companyId, startDate, endDate, calendarStartHour, calendarEndHour
        );

      const jobs = filterJobsByRole(allJobs, userRole, userId);

      let hiddenTechDiagnostics: { jobId: string; hiddenTechIds: string[] }[] = [];
      if (process.env.NODE_ENV === 'development') {
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

      return res.json(buildRangeResponse(jobs, outsideVisibleHoursCount, hiddenTechDiagnostics));
    }

    // Legacy year/month query
    const legacy = legacyQuerySchema.safeParse(req.query);
    if (legacy.success && legacy.data.year && legacy.data.month) {
      const { year, month } = legacy.data;
      const startDate = new Date(year, month - 1, 1, 0, 0, 0);
      const endDate = new Date(year, month, 0, 23, 59, 59);

      const { assignments: allJobs, outsideVisibleHoursCount } =
        await calendarRepository.getAssignmentsInRangeWithMetadata(
          companyId, startDate, endDate, calendarStartHour, calendarEndHour
        );

      const jobs = filterJobsByRole(allJobs, userRole, userId);
      return res.json(buildRangeResponse(jobs, outsideVisibleHoursCount));
    }

    res.json(buildRangeResponse([], 0));
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

    const jobValid = await calendarRepository.validateJobBelongsToTenant(companyId, data.jobId);
    if (!jobValid) {
      throw createError(404, "Job not found or does not belong to this company");
    }

    let startAt: Date;
    let endAt: Date;
    const isAllDay = data.allDay === true;

    if (isAllDay) {
      const dateStr = data.date || (data.startAt ? data.startAt.split('T')[0] : null);
      if (!dateStr) {
        throw createError(400, "All-day events require a date");
      }
      startAt = new Date(dateStr + 'T00:00:00');
      endAt = new Date(dateStr + 'T23:59:59.999');
    } else {
      if (!data.startAt) {
        throw createError(400, "Start time is required for timed events");
      }
      startAt = new Date(data.startAt);
      if (data.endAt) {
        endAt = new Date(data.endAt);
      } else if (data.durationMinutes) {
        endAt = new Date(startAt.getTime() + data.durationMinutes * 60000);
      } else {
        endAt = new Date(startAt.getTime() + 60 * 60000);
      }

      // Clamp to same day
      const startDay = startAt.toISOString().split('T')[0];
      const endDay = endAt.toISOString().split('T')[0];
      if (startDay !== endDay) {
        endAt = new Date(startDay + 'T23:59:59.999Z');
      }
    }

    // Validate technician
    let useBypassFunction = false;
    if (data.technicianUserId) {
      const techValid = await calendarRepository.validateTechnicianBelongsToTenant(companyId, data.technicianUserId);
      if (!techValid) {
        throw createError(404, "Technician not found or does not belong to this company");
      }

      if (!isAllDay) {
        try {
          await validateSchedule({ companyId, technicianUserId: data.technicianUserId, startAt, endAt });
        } catch (error: any) {
          const errorCode = error?.code || error?.details?.code;
          if (errorCode === 'OUTSIDE_WORKING_HOURS') {
            useBypassFunction = true;
          } else if (error instanceof ScheduleValidationError) {
            return res.status(error.statusCode).json(error.toJSON());
          } else {
            throw error;
          }
        }
      }
    }

    let result;
    try {
      if (useBypassFunction) {
        result = await calendarRepository.createAssignmentBypassWorkingHours(companyId, {
          jobId: data.jobId,
          technicianUserId: data.technicianUserId,
          startAt, endAt,
          notes: data.notes,
          allDay: isAllDay,
          expectedVersion: data.version,
        });
      } else {
        result = await calendarRepository.createAssignment(companyId, {
          jobId: data.jobId,
          technicianUserId: data.technicianUserId,
          startAt, endAt,
          notes: data.notes,
          allDay: isAllDay,
          expectedVersion: data.version,
        });
      }
    } catch (error: any) {
      if (error.message?.includes('modified by another user')) {
        return res.status(409).json({ error: error.message, code: 'VERSION_MISMATCH' });
      }
      throw error;
    }

    if (!result) {
      throw createError(500, "Failed to schedule job");
    }

    // Notification
    if (data.technicianUserId) {
      const jobDetails = await jobRepository.getJob(companyId, data.jobId);
      if (jobDetails) {
        const clientName = jobDetails.location?.companyName || jobDetails.location?.location || "Client";
        notificationService.emitJobScheduled({
          companyId,
          jobId: data.jobId,
          jobNumber: String(jobDetails.jobNumber),
          clientName,
          scheduledDate: isAllDay ? (data.date || new Date().toISOString()) : startAt.toISOString(),
          technicianUserId: data.technicianUserId,
          isReschedule: false,
        }).catch((err) => console.error("Failed to emit job scheduled notification:", err));
      }
    }

    // Version is NOT NULL DEFAULT 1 in DB - never null after write
    res.status(201).json({
      id: result.id,
      jobId: result.id,
      scheduledStart: result.scheduledStart?.toISOString() || null,
      scheduledEnd: result.scheduledEnd?.toISOString() || null,
      isAllDay: result.isAllDay ?? false,
      version: result.version,
      status: result.status,
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

    const existing = await calendarRepository.getAssignmentById(companyId, jobId);
    if (!existing) {
      throw createError(404, "Job not found");
    }

    // Validate technician if provided
    if (data.technicianUserId) {
      const techValid = await calendarRepository.validateTechnicianBelongsToTenant(companyId, data.technicianUserId);
      if (!techValid) {
        throw createError(404, "Technician not found or does not belong to this company");
      }
    }

    const isAllDay = data.allDay !== undefined ? data.allDay : existing.isAllDay;
    let computedStartAt: Date | undefined;
    let computedEndAt: Date | undefined;

    if (data.allDay === true) {
      const dateStr = data.date || (data.startAt ? data.startAt.split('T')[0] : null);
      if (dateStr) {
        computedStartAt = new Date(dateStr + 'T00:00:00');
        computedEndAt = new Date(dateStr + 'T23:59:59.999');
      }
    } else {
      computedStartAt = data.startAt ? new Date(data.startAt) : undefined;
      computedEndAt = data.endAt ? new Date(data.endAt) : undefined;
    }

    let result;
    try {
      result = await calendarRepository.updateAssignment(companyId, jobId, {
        technicianUserId: data.technicianUserId ?? undefined,
        startAt: computedStartAt,
        endAt: computedEndAt,
        notes: data.notes ?? undefined,
        allDay: data.allDay,
        expectedVersion: data.version,
      });
    } catch (error: any) {
      if (error.message?.includes('modified by another user')) {
        return res.status(409).json({ error: error.message, code: 'VERSION_MISMATCH' });
      }
      throw error;
    }

    if (!result) {
      throw createError(500, "Failed to reschedule job");
    }

    // Version is NOT NULL DEFAULT 1 in DB - never null after write
    res.json({
      id: result.id,
      jobId: result.id,
      scheduledStart: result.scheduledStart?.toISOString() || null,
      scheduledEnd: result.scheduledEnd?.toISOString() || null,
      isAllDay: result.isAllDay ?? false,
      version: result.version,
      status: result.status,
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

    const existing = await calendarRepository.getAssignmentById(companyId, jobId);
    if (!existing) {
      throw createError(404, "Job not found");
    }

    let result;
    try {
      result = await calendarRepository.deleteAssignment(companyId, jobId, data.version);
    } catch (error: any) {
      if (error.message?.includes('modified by another user')) {
        return res.status(409).json({ error: error.message, code: 'VERSION_MISMATCH' });
      }
      throw error;
    }

    if (!result) {
      throw createError(500, "Failed to unschedule job");
    }

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

router.post(
  "/resize",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const validation = resizeJobSchema.safeParse(req.body);
    if (!validation.success) {
      throw createError(400, "Validation failed");
    }

    const { job, newEndTime } = validation.data;
    const updated = await resizeJobTime(job, newEndTime);
    res.json(updated);
  })
);

export default router;
