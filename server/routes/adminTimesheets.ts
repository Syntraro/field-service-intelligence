/**
 * Daily Timesheet Routes — backend for the Daily Timesheet page.
 *
 * Internal API path: /api/admin/timesheets (kept for routing stability).
 * User-facing product concept: "Daily Timesheet" (not "Admin Timesheets").
 *
 * Provides day view + entry CRUD. All queries delegate to timeTrackingRepository.
 * All entries must belong to a job (jobId required, 2026-04-03).
 */
import { Router, type Response } from "express";
import { z } from "zod";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { MANAGER_ROLES } from "../auth/roles";
import { requireRole } from "../auth/requireRole";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { managerUpdateTimeEntrySchema } from "@shared/schema";
import { timeTrackingRepository } from "../storage/timeTracking";

const router = Router();

// ============================================================================
// GET /users — List active staff for user switcher
// ============================================================================

router.get(
  "/users",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const rows = await timeTrackingRepository.getTimesheetUsers(req.companyId!);
    res.json(rows);
  })
);

// ============================================================================
// GET /day — Chronological time entries for a user on a date
// ============================================================================

const dayQuerySchema = z.object({
  userId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
});

router.get(
  "/day",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId, date } = validateSchema(dayQuerySchema, req.query);
    const result = await timeTrackingRepository.getTimesheetDay(req.companyId!, userId, date);
    res.json(result);
  })
);

// ============================================================================
// GET /week — All time entries for a technician across a full week (Mon–Sun)
// Used by the payroll week grid to build job rows (2026-04-04)
// ============================================================================

const weekQuerySchema = z.object({
  userId: z.string().uuid(),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
});

router.get(
  "/week",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { userId, weekStart } = validateSchema(weekQuerySchema, req.query);
    const result = await timeTrackingRepository.getTimesheetWeek(req.companyId!, userId, weekStart);
    res.json(result);
  })
);

// ============================================================================
// GET /visits-for-reassign — Visits available for reassignment (active jobs only)
// ============================================================================

const reassignQuerySchema = z.object({
  userId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  search: z.string().max(100).optional(),
});

router.get(
  "/visits-for-reassign",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const params = validateSchema(reassignQuerySchema, req.query);
    const result = await timeTrackingRepository.getVisitsForReassign(req.companyId!, params);
    res.json(result);
  })
);

// ============================================================================
// PATCH /entries/:id — Edit a time entry (admin)
// ============================================================================

router.patch(
  "/entries/:id",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const adminUserId = req.user!.id;
    const entryId = req.params.id;

    const validated = validateSchema(managerUpdateTimeEntrySchema, req.body);

    const patch: Record<string, any> = {};
    if (validated.billable !== undefined) patch.billable = validated.billable;
    if (validated.notes !== undefined) patch.notes = validated.notes;
    if (validated.type !== undefined) patch.type = validated.type;
    if (validated.startAt !== undefined) patch.startAt = new Date(validated.startAt);
    if (validated.endAt !== undefined)
      patch.endAt = validated.endAt ? new Date(validated.endAt) : null;
    if (validated.jobId !== undefined) patch.jobId = validated.jobId;

    const updated = await timeTrackingRepository.updateTimeEntryManager(
      companyId,
      entryId,
      patch,
      {
        userId: adminUserId,
        overrideInvoiceLock: validated.overrideInvoiceLock,
        overrideReason: validated.overrideReason,
      }
    );

    res.json(updated);
  })
);

// ============================================================================
// DELETE /entries/:id — Delete a time entry (admin)
// ============================================================================

router.delete(
  "/entries/:id",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    await timeTrackingRepository.deleteTimeEntry(req.companyId!, req.params.id, {
      userId: req.user!.id,
    });
    res.status(204).end();
  })
);

// ============================================================================
// POST /entries — Admin creates a manual time entry
// ============================================================================

const createEntrySchema = z.object({
  technicianId: z.string().uuid(),
  jobId: z.string().uuid().nullable().optional(),
  type: z.enum(["travel_to_job", "on_site", "travel_between_jobs", "admin", "break", "task_work", "other"]),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  notes: z.string().max(2000).nullable().optional(),
  billable: z.boolean().optional(),
}).refine(
  (d) => new Date(d.endAt) > new Date(d.startAt),
  { message: "End time must be after start time" }
);

router.post(
  "/entries",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const adminUserId = req.user!.id;
    const data = validateSchema(createEntrySchema, req.body);

    const startAt = new Date(data.startAt);
    const endAt = new Date(data.endAt);
    const durationMinutes = Math.round((endAt.getTime() - startAt.getTime()) / 60000);

    // Check overlaps via canonical method
    const overlaps = await timeTrackingRepository.checkTimeEntryOverlap(
      companyId,
      data.technicianId,
      startAt,
      endAt
    );
    if (overlaps.length > 0) {
      throw createError(
        409,
        `Time entry overlaps with ${overlaps.length} existing entry(s). Adjust the times or edit the conflicting entries first.`
      );
    }

    // Create via canonical repository (handles rate snapshots, approval lock, validation)
    const entry = await timeTrackingRepository.createFinishedTimeEntry(
      companyId,
      data.technicianId,
      {
        type: data.type as any,
        jobId: data.jobId ?? null,
        startAt,
        endAt,
        notes: data.notes ?? null,
        billable: data.billable,
      }
    );

    console.log(JSON.stringify({
      event: "time_entry_admin_create",
      companyId,
      adminUserId,
      technicianId: data.technicianId,
      entryId: entry.id,
      jobId: data.jobId ?? null,
      type: data.type,
      durationMinutes,
      timestamp: new Date().toISOString(),
    }));

    res.status(201).json(entry);
  })
);

// ============================================================================
// POST /reduce — Reduce hours for a technician+job+day by trimming/deleting entries
// Used by the payroll week grid when a manager reduces cell hours.
// Deletes entries from most recent first; trims the last partially-consumed entry.
// ============================================================================

const reduceSchema = z.object({
  technicianId: z.string().uuid(),
  jobId: z.string().uuid().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  reduceMinutes: z.number().int().positive("Must be a positive reduction amount"),
});

router.post(
  "/reduce",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const adminUserId = req.user!.id;
    const data = validateSchema(reduceSchema, req.body);

    const result = await timeTrackingRepository.reduceTimeForDay(
      companyId,
      data.technicianId,
      data.jobId,
      data.date,
      data.reduceMinutes,
      { userId: adminUserId }
    );

    console.log(JSON.stringify({
      event: "time_entry_admin_reduce",
      companyId,
      adminUserId,
      technicianId: data.technicianId,
      jobId: data.jobId,
      date: data.date,
      reduceMinutes: data.reduceMinutes,
      deletedCount: result.deletedCount,
      trimmedCount: result.trimmedCount,
      timestamp: new Date().toISOString(),
    }));

    res.json(result);
  })
);

export default router;
