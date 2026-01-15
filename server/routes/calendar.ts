import express, { Response } from "express";
import { z } from "zod";
import { resizeJobTime } from "../services/calendarService";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { calendarRepository } from "../storage/calendar";
import { validateSchedule, ScheduleValidationError } from "../services/calendarValidation";
import type { AuthedRequest } from "../auth/tenantIsolation";
import type { CalendarAssignmentWithDetails } from "../storage/calendar";

// ============================================================================
// Role-Based Filtering Helper
// ============================================================================

/**
 * Filter assignments based on user role
 * - Technicians see only assignments where they are assigned
 * - Office/Manager roles see all assignments
 */
function filterAssignmentsByRole(
  assignments: CalendarAssignmentWithDetails[],
  userRole: string,
  userId: string
): CalendarAssignmentWithDetails[] {
  // Office roles (owner, admin, manager, dispatcher) see all assignments
  if (MANAGER_ROLES.includes(userRole as any)) {
    return assignments;
  }

  // Technicians see only their own assignments
  return assignments.filter((a) => {
    // Check if user is the primary technician
    if (a.primaryTechnicianId === userId) return true;
    // Check if user is in the assigned technicians list
    if (a.assignedTechnicianIds?.includes(userId)) return true;
    return false;
  });
}

/**
 * Calendar API - Slice 1 & 2
 *
 * Slice 1: API Contract Lock + CRUD
 * - Range query (GET /api/calendar?start=ISO&end=ISO)
 * - Create assignment (POST /api/calendar/assignments)
 * - Update assignment (PATCH /api/calendar/assignments/:id)
 * - Delete assignment (DELETE /api/calendar/assignments/:id)
 * - Complete assignment (POST /api/calendar/assignments/:id/complete)
 *
 * Slice 2: Conflict + Availability Validation
 * - Working hours validation
 * - Overlap/conflict detection
 */
const router = express.Router();

// ============================================================================
// Validation Schemas
// ============================================================================

const rangeQuerySchema = z.object({
  start: z.string().datetime({ message: "start must be ISO 8601 datetime" }),
  end: z.string().datetime({ message: "end must be ISO 8601 datetime" }),
});

const createAssignmentSchema = z
  .object({
    jobId: z.string().uuid(),
    technicianUserId: z.string().uuid().optional(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    notes: z.string().max(2000).optional(),
  })
  .refine((data) => new Date(data.startAt) < new Date(data.endAt), {
    message: "startAt must be before endAt",
    path: ["startAt"],
  });

const updateAssignmentSchema = z
  .object({
    technicianUserId: z.string().uuid().optional().nullable(),
    startAt: z.string().datetime().optional(),
    endAt: z.string().datetime().optional(),
    notes: z.string().max(2000).optional().nullable(),
    jobId: z.string().uuid().optional(),
  })
  .refine(
    (data) => {
      if (data.startAt && data.endAt) {
        return new Date(data.startAt) < new Date(data.endAt);
      }
      return true;
    },
    {
      message: "startAt must be before endAt",
      path: ["startAt"],
    }
  );

const completeAssignmentSchema = z.object({
  completionNotes: z.string().max(2000).optional(),
});

const resizeJobSchema = z
  .object({
    job: z
      .object({
        id: z.string().uuid(),
        scheduledStart: z.string().datetime(),
        scheduledEnd: z.string().datetime(),
      })
      .strict(),
    newEndTime: z.string().datetime(),
  });

// Legacy query params for backwards compatibility
const legacyQuerySchema = z.object({
  year: z.coerce.number().int().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/calendar
 * Range query for calendar assignments
 *
 * Query params:
 * - start: ISO datetime (required for range query)
 * - end: ISO datetime (required for range query)
 * OR legacy params:
 * - year: number
 * - month: number (1-12)
 *
 * Returns assignments overlapping the date range with technician and job info
 */
router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user?.id || "";
    const userRole = req.user?.role || "technician";

    // Check for new range params first
    if (req.query.start && req.query.end) {
      const { start, end } = validateSchema(rangeQuerySchema, req.query);
      const startDate = new Date(start);
      const endDate = new Date(end);

      const allAssignments = await calendarRepository.getAssignmentsInRange(
        companyId,
        startDate,
        endDate
      );

      // Apply role-based filtering
      const assignments = filterAssignmentsByRole(allAssignments, userRole, userId);

      // Transform to expected shape for frontend
      const transformedAssignments = assignments.map((a: CalendarAssignmentWithDetails) => ({
        id: a.id,
        jobId: a.jobId,
        jobNumber: a.jobNumber,
        jobType: a.jobType,
        summary: a.summary,
        status: a.status,
        locationId: a.locationId,
        locationName: a.locationName,
        customerCompanyId: a.customerCompanyId,
        customerCompanyName: a.customerCompanyName,
        scheduledStart: a.scheduledStart?.toISOString() || null,
        scheduledEnd: a.scheduledEnd?.toISOString() || null,
        assignedTechnicianIds: a.assignedTechnicianIds,
        primaryTechnicianId: a.primaryTechnicianId,
        technicians: a.technicians,
        // Legacy fields for backwards compatibility
        year: a.scheduledStart ? a.scheduledStart.getFullYear() : null,
        month: a.scheduledStart ? a.scheduledStart.getMonth() + 1 : null,
        day: a.scheduledStart ? a.scheduledStart.getDate() : null,
        scheduledHour: a.scheduledStart ? a.scheduledStart.getHours() : null,
        scheduledStartMinutes: a.scheduledStart ? a.scheduledStart.getMinutes() : null,
        durationMinutes: a.scheduledStart && a.scheduledEnd
          ? Math.round((a.scheduledEnd.getTime() - a.scheduledStart.getTime()) / 60000)
          : 60,
      }));

      return res.json({ assignments: transformedAssignments });
    }

    // Legacy year/month query
    const legacy = legacyQuerySchema.safeParse(req.query);
    if (legacy.success && legacy.data.year && legacy.data.month) {
      const { year, month } = legacy.data;
      const startDate = new Date(year, month - 1, 1, 0, 0, 0);
      const endDate = new Date(year, month, 0, 23, 59, 59);

      const allAssignments = await calendarRepository.getAssignmentsInRange(
        companyId,
        startDate,
        endDate
      );

      // Apply role-based filtering
      const assignments = filterAssignmentsByRole(allAssignments, userRole, userId);

      const transformedAssignments = assignments.map((a: CalendarAssignmentWithDetails) => ({
        id: a.id,
        jobId: a.jobId,
        jobNumber: a.jobNumber,
        jobType: a.jobType,
        summary: a.summary,
        status: a.status,
        locationId: a.locationId,
        locationName: a.locationName,
        customerCompanyId: a.customerCompanyId,
        customerCompanyName: a.customerCompanyName,
        scheduledStart: a.scheduledStart?.toISOString() || null,
        scheduledEnd: a.scheduledEnd?.toISOString() || null,
        assignedTechnicianIds: a.assignedTechnicianIds,
        primaryTechnicianId: a.primaryTechnicianId,
        technicians: a.technicians,
        year: a.scheduledStart ? a.scheduledStart.getFullYear() : null,
        month: a.scheduledStart ? a.scheduledStart.getMonth() + 1 : null,
        day: a.scheduledStart ? a.scheduledStart.getDate() : null,
        scheduledHour: a.scheduledStart ? a.scheduledStart.getHours() : null,
        scheduledStartMinutes: a.scheduledStart ? a.scheduledStart.getMinutes() : null,
        durationMinutes: a.scheduledStart && a.scheduledEnd
          ? Math.round((a.scheduledEnd.getTime() - a.scheduledStart.getTime()) / 60000)
          : 60,
      }));

      return res.json({ assignments: transformedAssignments });
    }

    // No valid params - return empty for contract stability
    res.json({ assignments: [] });
  })
);

/**
 * GET /api/calendar/assignments
 * Alias for main endpoint (backwards compatibility)
 */
router.get(
  "/assignments",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;

    if (req.query.start && req.query.end) {
      const { start, end } = validateSchema(rangeQuerySchema, req.query);
      const startDate = new Date(start);
      const endDate = new Date(end);

      const assignments = await calendarRepository.getAssignmentsInRange(
        companyId,
        startDate,
        endDate
      );

      return res.json({ assignments });
    }

    res.json({ assignments: [] });
  })
);

/**
 * POST /api/calendar/assignments
 * Create a calendar assignment (schedule a job)
 *
 * Body: { jobId, technicianUserId?, startAt, endAt, notes? }
 *
 * Validations:
 * - startAt < endAt
 * - technician must belong to tenant
 * - job must belong to tenant
 * - (Slice 2) Working hours validation
 * - (Slice 2) Overlap/conflict detection
 */
router.post(
  "/assignments",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const data = validateSchema(createAssignmentSchema, req.body);

    // Validate job belongs to tenant
    const jobValid = await calendarRepository.validateJobBelongsToTenant(
      companyId,
      data.jobId
    );
    if (!jobValid) {
      throw createError(404, "Job not found or does not belong to this company");
    }

    // Validate technician if provided
    if (data.technicianUserId) {
      const techValid = await calendarRepository.validateTechnicianBelongsToTenant(
        companyId,
        data.technicianUserId
      );
      if (!techValid) {
        throw createError(404, "Technician not found or does not belong to this company");
      }

      // Slice 2: Validate working hours and conflicts
      try {
        await validateSchedule({
          companyId,
          technicianUserId: data.technicianUserId,
          startAt: new Date(data.startAt),
          endAt: new Date(data.endAt),
        });
      } catch (error) {
        if (error instanceof ScheduleValidationError) {
          res.status(error.statusCode).json(error.toJSON());
          return;
        }
        throw error;
      }
    }

    const result = await calendarRepository.createAssignment(companyId, {
      jobId: data.jobId,
      technicianUserId: data.technicianUserId,
      startAt: new Date(data.startAt),
      endAt: new Date(data.endAt),
      notes: data.notes,
    });

    if (!result) {
      throw createError(500, "Failed to create assignment");
    }

    res.status(201).json(result);
  })
);

/**
 * PATCH /api/calendar/assignments/:id
 * Update a calendar assignment
 *
 * Body: { technicianUserId?, startAt?, endAt?, notes?, jobId? }
 *
 * Validations:
 * - assignment must belong to tenant
 * - startAt < endAt (if both provided)
 * - technician must belong to tenant (if provided)
 * - (Slice 2) Working hours validation
 * - (Slice 2) Overlap/conflict detection (excludes current job)
 */
router.patch(
  "/assignments/:id",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const assignmentId = req.params.id;
    const data = validateSchema(updateAssignmentSchema, req.body);

    // Validate assignment belongs to tenant
    const existing = await calendarRepository.getAssignmentById(companyId, assignmentId);
    if (!existing) {
      throw createError(404, "Assignment not found");
    }

    // Validate technician if being updated
    if (data.technicianUserId) {
      const techValid = await calendarRepository.validateTechnicianBelongsToTenant(
        companyId,
        data.technicianUserId
      );
      if (!techValid) {
        throw createError(404, "Technician not found or does not belong to this company");
      }
    }

    // Determine final values for validation
    const finalStartAt = data.startAt ? new Date(data.startAt) : existing.scheduledStart;
    const finalEndAt = data.endAt ? new Date(data.endAt) : existing.scheduledEnd;
    const finalTechnicianId = data.technicianUserId !== undefined
      ? data.technicianUserId
      : existing.primaryTechnicianId;

    // If only one of startAt/endAt provided, validate against existing
    if (data.startAt && !data.endAt) {
      if (finalEndAt && new Date(data.startAt) >= finalEndAt) {
        throw createError(400, "startAt must be before existing endAt");
      }
    }
    if (data.endAt && !data.startAt) {
      if (finalStartAt && new Date(data.endAt) <= finalStartAt) {
        throw createError(400, "endAt must be after existing startAt");
      }
    }

    // Slice 2: Validate working hours and conflicts (if technician and times are set)
    if (finalTechnicianId && finalStartAt && finalEndAt) {
      try {
        await validateSchedule({
          companyId,
          technicianUserId: finalTechnicianId,
          startAt: finalStartAt,
          endAt: finalEndAt,
          excludeJobId: assignmentId, // Exclude current job from conflict check
        });
      } catch (error) {
        if (error instanceof ScheduleValidationError) {
          res.status(error.statusCode).json(error.toJSON());
          return;
        }
        throw error;
      }
    }

    const result = await calendarRepository.updateAssignment(companyId, assignmentId, {
      technicianUserId: data.technicianUserId ?? undefined,
      startAt: data.startAt ? new Date(data.startAt) : undefined,
      endAt: data.endAt ? new Date(data.endAt) : undefined,
      notes: data.notes ?? undefined,
    });

    if (!result) {
      throw createError(500, "Failed to update assignment");
    }

    res.json(result);
  })
);

/**
 * DELETE /api/calendar/assignments/:id
 * Delete/unschedule an assignment (clears scheduling fields)
 */
router.delete(
  "/assignments/:id",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const assignmentId = req.params.id;

    // Validate assignment belongs to tenant
    const existing = await calendarRepository.getAssignmentById(companyId, assignmentId);
    if (!existing) {
      throw createError(404, "Assignment not found");
    }

    const result = await calendarRepository.deleteAssignment(companyId, assignmentId);
    if (!result) {
      throw createError(500, "Failed to delete assignment");
    }

    res.json({ success: true, unscheduled: result });
  })
);

/**
 * POST /api/calendar/assignments/:id/complete
 * Mark an assignment as complete
 *
 * Body: { completionNotes? }
 */
router.post(
  "/assignments/:id/complete",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const assignmentId = req.params.id;
    const data = validateSchema(completeAssignmentSchema, req.body);

    // Validate assignment belongs to tenant
    const existing = await calendarRepository.getAssignmentById(companyId, assignmentId);
    if (!existing) {
      throw createError(404, "Assignment not found");
    }

    const result = await calendarRepository.completeAssignment(
      companyId,
      assignmentId,
      data.completionNotes
    );

    if (!result) {
      throw createError(500, "Failed to complete assignment");
    }

    res.json(result);
  })
);

// ============================================================================
// Legacy/Helper Endpoints (Backwards Compatibility)
// ============================================================================

/**
 * GET /api/calendar/unscheduled
 * Returns unscheduled jobs (stub for Slice 1)
 */
router.get(
  "/unscheduled",
  asyncHandler(async (_req: AuthedRequest, res: Response) => {
    res.json([]);
  })
);

/**
 * GET /api/calendar/overdue
 * Returns overdue assignments (stub for Slice 1)
 */
router.get(
  "/overdue",
  asyncHandler(async (_req: AuthedRequest, res: Response) => {
    res.json([]);
  })
);

/**
 * GET /api/calendar/old-unscheduled
 * Legacy endpoint (stub for Slice 1)
 */
router.get(
  "/old-unscheduled",
  asyncHandler(async (_req: AuthedRequest, res: Response) => {
    res.json([]);
  })
);

/**
 * POST /api/calendar/resize
 * Resize job block on calendar (drag-to-extend)
 */
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
