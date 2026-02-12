/**
 * Admin Timesheets Routes — Jobber-style admin timesheet management.
 *
 * Provides day/week views of technician time entries, plus edit/delete
 * capabilities. Reads the same time_entries table written by the tech field
 * app (single source of truth).
 *
 * All endpoints enforce:
 *   - MANAGER_ROLES access (owner, admin, manager, dispatcher)
 *   - Tenant isolation via req.companyId
 *
 * Mounted at /api/admin/timesheets
 */
import { Router, type Response } from "express";
import { z } from "zod";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { MANAGER_ROLES } from "../auth/roles";
import { requireRole } from "../auth/requireRole";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { db } from "../db";
import {
  timeEntries,
  users,
  jobs,
  jobVisits,
  clientLocations,
  managerUpdateTimeEntrySchema,
} from "@shared/schema";
import { and, eq, gte, lt, sql, asc, isNull } from "drizzle-orm";
import { timeTrackingRepository } from "../storage/timeTracking";

const router = Router();

// ============================================================================
// GET /users — List technicians/staff for the user switcher dropdown
// ============================================================================

router.get(
  "/users",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;

    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        status: users.status,
      })
      .from(users)
      .where(
        and(
          eq(users.companyId, companyId),
          isNull(users.deletedAt),
          eq(users.disabled, false)
        )
      )
      .orderBy(asc(users.firstName), asc(users.lastName));

    res.json(rows);
  })
);

// ============================================================================
// GET /day — Day view: time entries for a user on a date
// ============================================================================

const dayQuerySchema = z.object({
  userId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
});

router.get(
  "/day",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { userId, date } = validateSchema(dayQuerySchema, req.query);

    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const nextDay = new Date(dayStart.getTime() + 86400000);

    // Fetch time entries enriched with job + location info
    const rows = await db
      .select({
        entry: timeEntries,
        jobNumber: jobs.jobNumber,
        jobSummary: jobs.summary,
        jobType: jobs.jobType,
        locationId: jobs.locationId,
        locationName: clientLocations.companyName,
        locationAddress: clientLocations.address,
        locationCity: clientLocations.city,
      })
      .from(timeEntries)
      .leftJoin(jobs, eq(timeEntries.jobId, jobs.id))
      .leftJoin(clientLocations, eq(jobs.locationId, clientLocations.id))
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          eq(timeEntries.technicianId, userId),
          gte(timeEntries.startAt, dayStart),
          lt(timeEntries.startAt, nextDay)
        )
      )
      .orderBy(asc(timeEntries.startAt));

    // Compute totals and build grouped structure
    let totalMinutes = 0;
    let travelMinutes = 0;
    let workMinutes = 0;

    // Group entries by jobId (or "unassigned")
    const groupMap: Record<string, {
      jobId: string | null;
      jobNumber: number | null;
      jobSummary: string | null;
      jobType: string | null;
      locationName: string | null;
      locationAddress: string | null;
      locationCity: string | null;
      entries: any[];
      travelMinutes: number;
      workMinutes: number;
      totalMinutes: number;
    }> = {};

    for (const r of rows) {
      const dur = r.entry.durationMinutes ?? 0;
      totalMinutes += dur;
      const isTravel = r.entry.type.startsWith("travel");
      const isWork = r.entry.type === "on_site";
      if (isTravel) travelMinutes += dur;
      else if (isWork) workMinutes += dur;

      const key = r.entry.jobId ?? "__unassigned__";
      if (!groupMap[key]) {
        groupMap[key] = {
          jobId: r.entry.jobId,
          jobNumber: r.jobNumber,
          jobSummary: r.jobSummary,
          jobType: r.jobType,
          locationName: r.locationName,
          locationAddress: r.locationAddress,
          locationCity: r.locationCity,
          entries: [],
          travelMinutes: 0,
          workMinutes: 0,
          totalMinutes: 0,
        };
      }
      const g = groupMap[key];
      g.entries.push({
        ...r.entry,
        jobNumber: r.jobNumber,
        jobSummary: r.jobSummary,
        jobType: r.jobType,
        locationId: r.locationId,
      });
      g.totalMinutes += dur;
      if (isTravel) g.travelMinutes += dur;
      else if (isWork) g.workMinutes += dur;
    }

    res.json({
      date,
      userId,
      groups: Object.values(groupMap),
      totals: {
        totalMinutes,
        travelMinutes,
        workMinutes,
        otherMinutes: totalMinutes - travelMinutes - workMinutes,
      },
    });
  })
);

// ============================================================================
// GET /week — Week view: aggregated totals per job per day
// ============================================================================

const weekQuerySchema = z.object({
  userId: z.string().uuid(),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD (Monday)"),
});

router.get(
  "/week",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { userId, weekStart } = validateSchema(weekQuerySchema, req.query);

    const monday = new Date(`${weekStart}T00:00:00.000Z`);
    const nextMonday = new Date(monday.getTime() + 7 * 86400000);

    // Fetch all entries for this week with job info
    const rows = await db
      .select({
        entry: timeEntries,
        jobNumber: jobs.jobNumber,
        jobSummary: jobs.summary,
      })
      .from(timeEntries)
      .leftJoin(jobs, eq(timeEntries.jobId, jobs.id))
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          eq(timeEntries.technicianId, userId),
          gte(timeEntries.startAt, monday),
          lt(timeEntries.startAt, nextMonday)
        )
      )
      .orderBy(asc(timeEntries.startAt));

    // Build per-job per-day grid
    // Key: jobId or "unassigned", value: { label, days: { [dayIndex]: minutes } }
    const grid: Record<
      string,
      {
        jobId: string | null;
        label: string;
        days: Record<number, number>; // 0=Mon..6=Sun
        weekTotal: number;
      }
    > = {};
    const dayTotals: Record<number, number> = {};
    let weekGrandTotal = 0;

    for (const r of rows) {
      const dur = r.entry.durationMinutes ?? 0;
      const dayIndex = Math.floor(
        (r.entry.startAt.getTime() - monday.getTime()) / 86400000
      );
      const clampedDay = Math.max(0, Math.min(6, dayIndex));
      const key = r.entry.jobId ?? "unassigned";
      const label = r.entry.jobId
        ? `#${r.jobNumber ?? "?"} ${r.jobSummary ?? "Unknown Job"}`
        : "Unassigned";

      if (!grid[key]) {
        grid[key] = { jobId: r.entry.jobId, label, days: {}, weekTotal: 0 };
      }
      grid[key].days[clampedDay] = (grid[key].days[clampedDay] ?? 0) + dur;
      grid[key].weekTotal += dur;
      dayTotals[clampedDay] = (dayTotals[clampedDay] ?? 0) + dur;
      weekGrandTotal += dur;
    }

    // Generate date labels for Mon-Sun
    const dayLabels = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday.getTime() + i * 86400000);
      return d.toISOString().split("T")[0];
    });

    res.json({
      weekStart,
      userId,
      dayLabels,
      rows: Object.values(grid),
      dayTotals,
      weekGrandTotal,
      entryCount: rows.length,
    });
  })
);

// ============================================================================
// GET /visits-for-reassign — Visits available for reassignment dropdown
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
    const companyId = req.companyId!;
    const { userId, date, search } = validateSchema(reassignQuerySchema, req.query);

    // Bounded window: same day (primary) + ±7 days (secondary)
    const centerDate = date ? new Date(`${date}T12:00:00.000Z`) : new Date();
    const windowStart = new Date(centerDate.getTime() - 7 * 86400000);
    const windowEnd = new Date(centerDate.getTime() + 8 * 86400000);

    const conditions = [
      eq(jobVisits.companyId, companyId),
      eq(jobVisits.isActive, true),
      gte(jobVisits.scheduledStart, windowStart),
      lt(jobVisits.scheduledStart, windowEnd),
      // Admin can reassign to any visit in tenant within the date window
      // (no user-assignment filter — admin override)
    ];

    // Optional search filter (job number or client name)
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push(
        sql`(${jobs.summary} ILIKE ${term} OR CAST(${jobs.jobNumber} AS TEXT) LIKE ${term} OR ${clientLocations.companyName} ILIKE ${term})`
      );
    }

    const rows = await db
      .select({
        visitId: jobVisits.id,
        visitNumber: jobVisits.visitNumber,
        scheduledStart: jobVisits.scheduledStart,
        status: jobVisits.status,
        jobId: jobVisits.jobId,
        jobNumber: jobs.jobNumber,
        jobSummary: jobs.summary,
        locationName: clientLocations.companyName,
      })
      .from(jobVisits)
      .innerJoin(jobs, eq(jobVisits.jobId, jobs.id))
      .leftJoin(clientLocations, eq(jobs.locationId, clientLocations.id))
      .where(and(...conditions))
      .orderBy(asc(jobVisits.scheduledStart))
      .limit(50); // Hard cap to prevent giant lists

    // Tag same-day vs secondary for UI grouping
    const dayStartMs = new Date(`${date ?? centerDate.toISOString().split("T")[0]}T00:00:00.000Z`).getTime();
    const dayEndMs = dayStartMs + 86400000;

    res.json(
      rows.map((r) => {
        const schedMs = r.scheduledStart ? new Date(r.scheduledStart).getTime() : 0;
        return {
          visitId: r.visitId,
          visitNumber: r.visitNumber,
          scheduledStart: r.scheduledStart,
          status: r.status,
          jobId: r.jobId,
          jobNumber: r.jobNumber,
          jobSummary: r.jobSummary,
          locationName: r.locationName,
          label: `#${r.jobNumber} ${r.jobSummary}${r.locationName ? ` (${r.locationName})` : ""}`,
          sameDay: schedMs >= dayStartMs && schedMs < dayEndMs,
        };
      })
    );
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
    const companyId = req.companyId!;
    const adminUserId = req.user!.id;
    const entryId = req.params.id;

    await timeTrackingRepository.deleteTimeEntry(companyId, entryId, {
      userId: adminUserId,
    });

    res.status(204).end();
  })
);

// ============================================================================
// POST /entries — Admin creates a manual time entry
// ============================================================================

const createEntrySchema = z.object({
  technicianId: z.string().uuid(),
  jobId: z.string().uuid(),
  type: z.enum(["travel_to_job", "on_site"]),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  notes: z.string().max(2000).nullable().optional(),
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

    // Validate job belongs to tenant and is not soft-deleted
    const [job] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(
        eq(jobs.id, data.jobId),
        eq(jobs.companyId, companyId),
        isNull(jobs.deletedAt),
        eq(jobs.isActive, true),
      ))
      .limit(1);
    if (!job) throw createError(404, "Job not found or has been deleted");

    // Validate technician belongs to tenant
    const [tech] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, data.technicianId), eq(users.companyId, companyId)))
      .limit(1);
    if (!tech) throw createError(404, "Technician not found in your company");

    const startAt = new Date(data.startAt);
    const endAt = new Date(data.endAt);
    const durationMinutes = Math.round((endAt.getTime() - startAt.getTime()) / 60000);

    // Check overlaps
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

    const entry = await timeTrackingRepository.createFinishedTimeEntry(
      companyId,
      data.technicianId,
      {
        type: data.type,
        jobId: data.jobId,
        startAt,
        endAt,
        notes: data.notes ?? null,
        billable: true,
      }
    );

    console.log(JSON.stringify({
      event: "time_entry_admin_create",
      companyId,
      adminUserId,
      technicianId: data.technicianId,
      entryId: entry.id,
      jobId: data.jobId,
      type: data.type,
      durationMinutes,
      timestamp: new Date().toISOString(),
    }));

    res.status(201).json(entry);
  })
);

export default router;
