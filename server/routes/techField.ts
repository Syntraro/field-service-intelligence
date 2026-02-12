/**
 * Tech Field Routes — Mobile-first API for technician field app.
 *
 * All endpoints enforce:
 *   - Schedulable user access (isSchedulable=true on user record, any role)
 *   - Tenant isolation via req.companyId
 *   - Assignment validation: tech can only see/act on visits assigned to them
 *
 * Visit queries use canonical methods from jobVisitsRepository
 * (server/storage/jobVisits.ts) — single source of truth for visit reads.
 *
 * Mounted at /api/tech
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { db } from "../db";
import { jobVisits, jobNotes, companySettings } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { timeTrackingRepository } from "../storage/timeTracking";
import { jobVisitsRepository } from "../storage/jobVisits";
// Canonical visit reads — single source of truth (server/storage/visits.ts)
import { getVisitsForUserInRange } from "../storage/visits";

const router = Router();

/**
 * requireSchedulable — Auth middleware for /api/tech routes.
 * Grants access if the user's isSchedulable flag is true (i.e. "Show on calendar").
 * Works for any role (owner, admin, tech, etc.) as long as they are schedulable.
 */
function requireSchedulable(req: Request, res: Response, next: NextFunction) {
  const user = req.user as any;
  if (!user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  // isSchedulable defaults to true in the schema, so only block if explicitly false
  if (user.isSchedulable === false) {
    return res.status(403).json({ error: "User is not schedulable (Show on calendar is disabled)" });
  }
  next();
}

// ============================================================================
// HELPERS
// ============================================================================

/** Get today's date string (YYYY-MM-DD) in the given IANA timezone. */
function todayInTimezone(tz: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz }); // en-CA → YYYY-MM-DD
}

/**
 * Get start and end of a calendar day as UTC Date objects,
 * anchored in the given IANA timezone (e.g. "America/Toronto").
 */
function dayBoundsInTz(dateStr: string, tz: string) {
  // Compute the UTC offset for the timezone on this date
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const localStr = probe.toLocaleString("en-US", { timeZone: tz });
  const localTime = new Date(localStr);
  const offsetMs = probe.getTime() - localTime.getTime();

  const start = new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + offsetMs);
  const end = new Date(start.getTime() + 86400000 - 1); // 23:59:59.999 in tz
  return { start, end, dateStr };
}

/** Fetch the tenant timezone from company_settings, defaulting to America/Toronto. */
async function getTenantTimezone(companyId: string): Promise<string> {
  const [row] = await db
    .select({ timezone: companySettings.timezone })
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);
  return row?.timezone || "America/Toronto";
}

// ============================================================================
// GET /api/tech/visits/today — Today's visits assigned to me
// ============================================================================

router.get(
  "/visits/today",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;
    const user = req.user as any;

    // Use tenant timezone for "today" calculation
    const tz = await getTenantTimezone(companyId);
    const todayStr = todayInTimezone(tz);
    const { start, end } = dayBoundsInTz(todayStr, tz);

    // Canonical visit query from shared module — joins job + location, filters by assignment
    const visits = await getVisitsForUserInRange(companyId, userId, start, end);

    // DEV debug log — helps verify auth + date + assignment correctness
    if (process.env.NODE_ENV !== "production") {
      console.log(JSON.stringify({
        _debug: "tech_visits_today",
        userId,
        email: user.email,
        role: user.role,
        isSchedulable: user.isSchedulable,
        companyId,
        timezone: tz,
        todayStr,
        dayBoundsUTC: { start: start.toISOString(), end: end.toISOString() },
        visitsReturned: visits.length,
      }));
    }

    res.json({ visits, count: visits.length });
  })
);

// ============================================================================
// GET /api/tech/visits/:visitId — Single visit detail (with job + location)
// ============================================================================

router.get(
  "/visits/:visitId",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;

    // Canonical detail query — visit + job + location + notes, with assignment check
    const detail = await jobVisitsRepository.getVisitDetailForUser(
      companyId, userId, req.params.visitId
    );

    if (!detail) {
      throw createError(404, "Visit not found or not assigned to you");
    }

    res.json(detail);
  })
);

// ============================================================================
// POST /api/tech/visits/:visitId/en-route — Mark visit as en_route
// ============================================================================

const timestampSchema = z.object({
  at: z.string().datetime().optional(),
}).strict();

router.post(
  "/visits/:visitId/en-route",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;
    const visit = await jobVisitsRepository.getAssignedVisit(companyId, req.params.visitId, userId);

    if (!visit) throw createError(404, "Visit not found or not assigned to you");
    if (visit.status === "completed" || visit.status === "cancelled") {
      throw createError(400, "Cannot update a completed or cancelled visit");
    }

    const { at } = validateSchema(timestampSchema, req.body);
    const now = at ? new Date(at) : new Date();

    const [updated] = await db
      .update(jobVisits)
      .set({
        status: "en_route",
        updatedAt: now,
        version: visit.version + 1,
      })
      .where(and(eq(jobVisits.id, visit.id), eq(jobVisits.companyId, companyId)))
      .returning();

    // Sync parent job schedule fields from visit state
    await jobVisitsRepository.syncJobToVisits(companyId, visit.jobId);

    // Start a travel_to_job time entry via the canonical state machine
    try {
      await timeTrackingRepository.recordJobStatus(companyId, userId, visit.jobId, {
        status: "en_route",
        at: now,
        notes: `Visit #${visit.visitNumber} — en route`,
        source: "mobile",
      });
    } catch {
      // Non-fatal: entry may already be running
    }

    res.json(updated);
  })
);

// ============================================================================
// POST /api/tech/visits/:visitId/start — Start visit (on-site + billable time)
// ============================================================================

router.post(
  "/visits/:visitId/start",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;
    const visit = await jobVisitsRepository.getAssignedVisit(companyId, req.params.visitId, userId);

    if (!visit) throw createError(404, "Visit not found or not assigned to you");
    if (visit.status === "completed" || visit.status === "cancelled") {
      throw createError(400, "Cannot start a completed or cancelled visit");
    }

    const { at } = validateSchema(timestampSchema, req.body);
    const now = at ? new Date(at) : new Date();

    const [updated] = await db
      .update(jobVisits)
      .set({
        status: "in_progress",
        checkedInAt: visit.checkedInAt ?? now,
        updatedAt: now,
        version: visit.version + 1,
      })
      .where(and(eq(jobVisits.id, visit.id), eq(jobVisits.companyId, companyId)))
      .returning();

    // Sync parent job schedule fields from visit state
    await jobVisitsRepository.syncJobToVisits(companyId, visit.jobId);

    // Stop travel entry (if running) + start on_site entry via canonical state machine
    try {
      await timeTrackingRepository.recordJobStatus(companyId, userId, visit.jobId, {
        status: "arrived",
        at: now,
        notes: `Visit #${visit.visitNumber} — on site`,
        source: "mobile",
      });
    } catch {
      // Non-fatal: time entry may already be running
    }

    res.json(updated);
  })
);

// ============================================================================
// POST /api/tech/visits/:visitId/complete — Complete visit with outcome
// ============================================================================

const completeVisitSchema = z.object({
  outcome: z.enum(["completed", "needs_parts", "needs_followup"]),
  outcomeNote: z.string().max(2000).optional(),
  at: z.string().datetime().optional(),
}).strict().refine(
  (data) => {
    // outcomeNote required for needs_parts and needs_followup
    if (data.outcome !== "completed" && !data.outcomeNote?.trim()) return false;
    return true;
  },
  { message: "A note is required when outcome is 'needs_parts' or 'needs_followup'" }
);

router.post(
  "/visits/:visitId/complete",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;
    const visit = await jobVisitsRepository.getAssignedVisit(companyId, req.params.visitId, userId);

    if (!visit) throw createError(404, "Visit not found or not assigned to you");
    if (visit.status === "completed") {
      throw createError(400, "Visit is already completed");
    }

    const { outcome, outcomeNote, at } = validateSchema(completeVisitSchema, req.body);
    const now = at ? new Date(at) : new Date();

    // Compute actual duration if checked in
    let actualDurationMinutes: number | null = null;
    if (visit.checkedInAt) {
      const durationMs = now.getTime() - new Date(visit.checkedInAt).getTime();
      actualDurationMinutes = Math.round(durationMs / 60000);
    }

    const [updated] = await db
      .update(jobVisits)
      .set({
        status: "completed",
        checkedOutAt: now,
        actualDurationMinutes,
        visitNotes: [
          visit.visitNotes,
          `[OUTCOME: ${outcome}]${outcomeNote ? ` ${outcomeNote}` : ""}`,
          `[COMPLETED_BY: ${userId}]`,
        ]
          .filter(Boolean)
          .join("\n"),
        updatedAt: now,
        version: visit.version + 1,
      })
      .where(and(eq(jobVisits.id, visit.id), eq(jobVisits.companyId, companyId)))
      .returning();

    // Sync parent job schedule fields from visit state
    await jobVisitsRepository.syncJobToVisits(companyId, visit.jobId);

    // Stop on_site time entry via canonical state machine
    try {
      await timeTrackingRepository.recordJobStatus(companyId, userId, visit.jobId, {
        status: "completed",
        at: now,
        notes: `Visit #${visit.visitNumber} — completed (${outcome})`,
        source: "mobile",
      });
    } catch {
      // Non-fatal
    }

    // Auto-create a note on the job documenting the outcome
    if (outcomeNote?.trim()) {
      const outcomeLabels: Record<string, string> = {
        completed: "Completed",
        needs_parts: "Needs parts",
        needs_followup: "Needs follow-up",
      };
      await db.insert(jobNotes).values({
        id: sql`gen_random_uuid()`,
        companyId,
        jobId: visit.jobId,
        userId,
        noteText: `Visit #${visit.visitNumber} — ${outcomeLabels[outcome]}: ${outcomeNote.trim()}`,
        createdAt: now,
        updatedAt: now,
      });
    }

    res.json({ visit: updated, outcome });
  })
);

// ============================================================================
// POST /api/tech/visits/:visitId/notes — Add a note to the visit's job
// ============================================================================

const addNoteSchema = z.object({
  text: z.string().min(1).max(2000),
}).strict();

router.post(
  "/visits/:visitId/notes",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;
    const visit = await jobVisitsRepository.getAssignedVisit(companyId, req.params.visitId, userId);

    if (!visit) throw createError(404, "Visit not found or not assigned to you");

    const { text } = validateSchema(addNoteSchema, req.body);
    const now = new Date();

    const [note] = await db
      .insert(jobNotes)
      .values({
        id: sql`gen_random_uuid()`,
        companyId,
        jobId: visit.jobId,
        userId,
        noteText: text.trim(),
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    res.status(201).json(note);
  })
);

// ============================================================================
// GET /api/tech/time/summary — Today + this week time summary
// ============================================================================

router.get(
  "/time/summary",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;

    // Get today's status (includes clock in/out + entries)
    const todayStatus = await timeTrackingRepository.getTechnicianTodayStatus(
      companyId,
      userId
    );

    // Get this week's entries (Monday-Sunday)
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon...
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() + mondayOffset);
    monday.setUTCHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    sunday.setUTCHours(23, 59, 59, 999);

    const weekStart = monday.toISOString().split("T")[0];
    const weekEnd = sunday.toISOString().split("T")[0];

    // Query week's total from time entries
    const weekResult = await db.execute(sql`
      SELECT COALESCE(SUM(duration_minutes), 0) AS total_minutes
      FROM time_entries
      WHERE company_id = ${companyId}
        AND technician_id = ${userId}
        AND start_at >= ${monday}
        AND start_at <= ${sunday}
        AND duration_minutes IS NOT NULL
    `);

    const weekTotalMinutes = Number(weekResult.rows[0]?.total_minutes) || 0;

    res.json({
      today: todayStatus,
      week: {
        totalMinutes: weekTotalMinutes,
        totalHours: +(weekTotalMinutes / 60).toFixed(1),
        weekStart,
        weekEnd,
      },
    });
  })
);

export default router;
