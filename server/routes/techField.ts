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
import { timeEntries, jobs, clients, jobParts, items, jobEquipment, jobVisits, locationEquipment } from "@shared/schema";
import { jobNotesRepository } from "../storage/jobNotes";
import { jobRepository } from "../storage/jobs";
import { createTechTask, taskRepository } from "../storage/tasks";
import { createTaskSchema, TECH_ALLOWED_TASK_TYPES } from "../lib/taskSchemas";
import { startTaskTimer, stopTaskTimer } from "../services/taskTimerService";
import { and, eq, sql, gte, lt, asc, isNull } from "drizzle-orm";
import { timeTrackingRepository } from "../storage/timeTracking";
import { jobVisitsRepository } from "../storage/jobVisits";
// Canonical visit reads — single source of truth (server/storage/visits.ts)
import { getVisitsForUserInRange } from "../storage/visits";
import * as lifecycle from "../services/jobLifecycleOrchestrator";
import { emitDispatch } from "../lib/dispatchBus";
import { schedulingRepository } from "../storage/scheduling";
import { companyRepository } from "../storage/company";
import { normalizeScheduleTimes } from "../domain/scheduling";
import { logEventAsync } from "../lib/events";
import { recomputeAttentionForEntity } from "../lib/attentionRules";
import { getQueryCtx } from "../lib/queryCtx";

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

/**
 * Fetch the tenant timezone via the canonical companyRepository helper.
 * 2026-04-08: Replaced inline db query with companyRepository.getCompanyTimezone()
 * which adds caching (30 min) and timezone validation. Same fallback semantics
 * (America/Toronto) — see server/domain/scheduling.ts:DEFAULT_TIMEZONE.
 */
const getTenantTimezone = (companyId: string): Promise<string> =>
  companyRepository.getCompanyTimezone(companyId);

// ============================================================================
// ASSIGNMENT GUARDS — shared by all tech mutation routes
// ============================================================================

// Assignment guards moved to server/guards/visitAssignmentGuards.ts. Local
// re-aliases preserve the original tech-field naming.
import {
  assertTechnicianAssignedToVisit as assertTechAssignedToVisit,
  assertTechnicianHasVisitOnJob as assertTechAssignedToJob,
} from "../guards/visitAssignmentGuards";

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

    // Use tenant timezone for date calculation; optional ?date=YYYY-MM-DD param
    const tz = await getTenantTimezone(companyId);
    const dateParam = req.query.date as string | undefined;
    const dateStr = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayInTimezone(tz);
    const { start, end } = dayBoundsInTz(dateStr, tz);

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
        dateStr,
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

    // Include running time entry so frontend timer reads from canonical time_entries truth
    const runningEntry = await timeTrackingRepository.getRunningTimeEntry(companyId, userId);
    const activeTimeEntry = runningEntry && runningEntry.jobId === detail.visit.jobId
      ? { id: runningEntry.id, type: runningEntry.type, startAt: runningEntry.startAt }
      : null;

    res.json({ ...detail, activeTimeEntry });
  })
);

// ============================================================================
// POST /api/tech/visits/:visitId/en-route — Mark visit as en_route
// ============================================================================

const timestampSchema = z.object({
  at: z.string().datetime().optional(),
}).strict();

// 2026-04-10: Map orchestrator's ACTIVE_VISIT_CONFLICT error to a clean 409
// instead of letting it bubble as a 500. The orchestrator throws a plain
// Error with this stable prefix from assertNoOtherActiveVisitForTech.
//
// 2026-04-10 micro-patch: also maps RUNNING_TIME_ENTRY_EXISTS — the resume
// guard inside resumeVisit refuses to silently auto-stop a stale running
// entry. Both prefixes mean "the tech is in an inconsistent state, surface
// it instead of plowing through" and both deserve a clean 409.
function maybeMapActiveVisitConflict(err: unknown): never {
  if (err instanceof Error) {
    if (err.message.startsWith("RUNNING_TIME_ENTRY_EXISTS:")) {
      throw createError(
        409,
        err.message.replace(/^RUNNING_TIME_ENTRY_EXISTS:\s*/, ""),
        "RUNNING_TIME_ENTRY_EXISTS",
      );
    }
    if (err.message.startsWith("ACTIVE_VISIT_CONFLICT:")) {
      // 2026-04-14: emit a stable, canonical message so the tech app
      // surfaces the business rule directly rather than the orchestrator's
      // diagnostic prose. The typed `code` is what the client switches on.
      throw createError(
        409,
        "Complete or pause the other active visit before starting this one.",
        "ACTIVE_VISIT_CONFLICT",
      );
    }
  }
  throw err;
}

router.post(
  "/visits/:visitId/en-route",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;

    // Auth: tech must be assigned to this visit
    const visit = await jobVisitsRepository.getAssignedVisit(companyId, req.params.visitId, userId);
    if (!visit) throw createError(404, "Visit not found or not assigned to you");

    const { at } = validateSchema(timestampSchema, req.body);
    const now = at ? new Date(at) : new Date();

    // 2026-03-18 BP-3 fix: Delegate workflow mutation to canonical orchestrator.
    // Orchestrator owns validation, status write, version increment, and schedule sync.
    // 2026-04-10: pass actingUserId so the orchestrator enforces single-active-visit.
    let result;
    try {
      result = await lifecycle.setVisitEnRoute({
        type: "SET_VISIT_EN_ROUTE",
        companyId,
        visitId: visit.id,
        jobId: visit.jobId,
        at: now,
        actingUserId: userId,
      });
    } catch (err) { maybeMapActiveVisitConflict(err); }

    // Tech-field-specific side effect: start travel time entry
    let activeTimeEntry: { id: string; type: string; startAt: Date } | null = null;
    try {
      const { timeEntry } = await timeTrackingRepository.recordJobStatus(companyId, userId, visit.jobId, {
        status: "en_route",
        visitId: visit.id,
        at: now,
        notes: `Visit #${visit.visitNumber} — en route`,
        source: "mobile",
      });
      if (timeEntry) {
        activeTimeEntry = { id: timeEntry.id, type: timeEntry.type, startAt: timeEntry.startAt };
      }
    } catch {
      // Non-fatal: entry may already be running
    }

    // 2026-04-05: Emit dispatch SSE so office surfaces refresh when tech goes en route
    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: visit.id, ts: new Date().toISOString() });

    res.json({ ...result.visit, activeTimeEntry });
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

    // Auth: tech must be assigned to this visit
    const visit = await jobVisitsRepository.getAssignedVisit(companyId, req.params.visitId, userId);
    if (!visit) throw createError(404, "Visit not found or not assigned to you");

    const { at } = validateSchema(timestampSchema, req.body);
    const now = at ? new Date(at) : new Date();

    // 2026-03-18 BP-4 fix: Delegate workflow mutation to canonical orchestrator.
    // Orchestrator owns validation, status write, checkedInAt, version increment, and schedule sync.
    // 2026-04-10: pass actingUserId so the orchestrator enforces single-active-visit.
    let result;
    try {
      result = await lifecycle.startVisit({
        type: "START_VISIT",
        companyId,
        visitId: visit.id,
        jobId: visit.jobId,
        at: now,
        actingUserId: userId,
      });
    } catch (err) { maybeMapActiveVisitConflict(err); }

    // Tech-field-specific side effect: stop travel entry + start on_site entry
    let activeTimeEntry: { id: string; type: string; startAt: Date } | null = null;
    try {
      const { timeEntry } = await timeTrackingRepository.recordJobStatus(companyId, userId, visit.jobId, {
        status: "arrived",
        visitId: visit.id,
        at: now,
        notes: `Visit #${visit.visitNumber} — on site`,
        source: "mobile",
      });
      if (timeEntry) {
        activeTimeEntry = { id: timeEntry.id, type: timeEntry.type, startAt: timeEntry.startAt };
      }
    } catch {
      // Non-fatal: time entry may already be running
    }

    // 2026-04-05: Emit dispatch SSE so office surfaces refresh when tech starts visit
    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: visit.id, ts: new Date().toISOString() });

    res.json({ ...result.visit, activeTimeEntry });
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

    // Delegate to canonical lifecycle orchestrator (handles visit update,
    // visitNotes, auto job note, reconciliation, job schedule sync,
    // and stopping active time entries — 2026-04-05)
    const result = await lifecycle.completeVisit({
      type: "COMPLETE_VISIT",
      companyId,
      visitId: visit.id,
      jobId: visit.jobId,
      outcome,
      holdReason: null,
      holdNotes: outcomeNote?.trim() || null,
      completedByUserId: userId,
      outcomeNote: outcomeNote?.trim() || null,
      visitNumber: visit.visitNumber ?? null,
    });

    // 2026-04-05: Emit dispatch SSE so office surfaces refresh after tech completion
    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: visit.id, ts: new Date().toISOString() });

    // activeTimeEntry: null signals timer must stop immediately
    res.json({ visit: result.visit, outcome, activeTimeEntry: null });
  })
);

// ============================================================================
// 2026-04-09: Reversible workflow controls — cancel-route, cancel-start,
// pause, resume. Each follows the same pattern as en-route/start/complete:
// load assigned visit → call orchestrator → mirror time-entry side effect
// via timeTrackingRepository.recordJobStatus → emit dispatch SSE → return
// the merged visit + activeTimeEntry shape the tech app already consumes.
//
// Sub-1-minute time entries created by an immediate cancel/pause are
// discarded by stopAndDiscardIfTrivial inside recordJobStatus — no special
// handling needed at the route layer.
// ============================================================================

// POST /api/tech/visits/:visitId/cancel-route
router.post(
  "/visits/:visitId/cancel-route",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;

    const visit = await jobVisitsRepository.getAssignedVisit(companyId, req.params.visitId, userId);
    if (!visit) throw createError(404, "Visit not found or not assigned to you");

    const { at } = validateSchema(timestampSchema, req.body);
    const now = at ? new Date(at) : new Date();

    const result = await lifecycle.cancelVisitRoute({
      type: "CANCEL_VISIT_ROUTE",
      companyId,
      visitId: visit.id,
      jobId: visit.jobId,
      at: now,
    });

    // Stop the running travel time entry. recordJobStatus("paused") routes
    // through stopAndDiscardIfTrivial so a sub-1-minute segment is dropped.
    try {
      await timeTrackingRepository.recordJobStatus(companyId, userId, visit.jobId, {
        status: "paused",
        visitId: visit.id,
        at: now,
        notes: `Visit #${visit.visitNumber} — route cancelled`,
        source: "mobile",
      });
    } catch {
      // Non-fatal: there may be no running entry.
    }

    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: visit.id, ts: new Date().toISOString() });

    // activeTimeEntry: null signals the tech app to stop the live timer.
    res.json({ ...result.visit, activeTimeEntry: null });
  })
);

// POST /api/tech/visits/:visitId/cancel-start
router.post(
  "/visits/:visitId/cancel-start",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;

    const visit = await jobVisitsRepository.getAssignedVisit(companyId, req.params.visitId, userId);
    if (!visit) throw createError(404, "Visit not found or not assigned to you");

    const { at } = validateSchema(timestampSchema, req.body);
    const now = at ? new Date(at) : new Date();

    const result = await lifecycle.cancelVisitStart({
      type: "CANCEL_VISIT_START",
      companyId,
      visitId: visit.id,
      jobId: visit.jobId,
      at: now,
    });

    // Stop the running on_site entry; sub-1-minute segments are discarded.
    try {
      await timeTrackingRepository.recordJobStatus(companyId, userId, visit.jobId, {
        status: "paused",
        visitId: visit.id,
        at: now,
        notes: `Visit #${visit.visitNumber} — start cancelled`,
        source: "mobile",
      });
    } catch {
      // Non-fatal
    }

    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: visit.id, ts: new Date().toISOString() });

    res.json({ ...result.visit, activeTimeEntry: null });
  })
);

// POST /api/tech/visits/:visitId/pause
router.post(
  "/visits/:visitId/pause",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;

    const visit = await jobVisitsRepository.getAssignedVisit(companyId, req.params.visitId, userId);
    if (!visit) throw createError(404, "Visit not found or not assigned to you");

    const { at } = validateSchema(timestampSchema, req.body);
    const now = at ? new Date(at) : new Date();

    // 2026-04-10: Stricter pause guardrail (#4) — refuse if there is no
    // running time entry for the acting tech. A pause request without a
    // running timer indicates state divergence (visit is in_progress but
    // the on-site entry was already stopped, e.g. by a stale tab). Refusing
    // forces the user to refresh and retry from a known good state.
    const runningEntry = await timeTrackingRepository.getRunningTimeEntry(companyId, userId);
    if (!runningEntry) {
      throw createError(
        409,
        "No running time entry to pause. Refresh and try again — the visit may already be paused on another device."
      );
    }

    const result = await lifecycle.pauseVisit({
      type: "PAUSE_VISIT",
      companyId,
      visitId: visit.id,
      jobId: visit.jobId,
      at: now,
    });

    try {
      await timeTrackingRepository.recordJobStatus(companyId, userId, visit.jobId, {
        status: "paused",
        visitId: visit.id,
        at: now,
        notes: `Visit #${visit.visitNumber} — paused`,
        source: "mobile",
      });
    } catch {
      // Non-fatal
    }

    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: visit.id, ts: new Date().toISOString() });

    res.json({ ...result.visit, activeTimeEntry: null });
  })
);

// POST /api/tech/visits/:visitId/resume
router.post(
  "/visits/:visitId/resume",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;

    const visit = await jobVisitsRepository.getAssignedVisit(companyId, req.params.visitId, userId);
    if (!visit) throw createError(404, "Visit not found or not assigned to you");

    const { at } = validateSchema(timestampSchema, req.body);
    const now = at ? new Date(at) : new Date();

    let result;
    try {
      result = await lifecycle.resumeVisit({
        type: "RESUME_VISIT",
        companyId,
        visitId: visit.id,
        jobId: visit.jobId,
        at: now,
        actingUserId: userId,
      });
    } catch (err) { maybeMapActiveVisitConflict(err); }

    let activeTimeEntry: { id: string; type: string; startAt: Date } | null = null;
    try {
      const { timeEntry } = await timeTrackingRepository.recordJobStatus(companyId, userId, visit.jobId, {
        status: "resumed",
        visitId: visit.id,
        at: now,
        notes: `Visit #${visit.visitNumber} — resumed`,
        source: "mobile",
      });
      if (timeEntry) {
        activeTimeEntry = { id: timeEntry.id, type: timeEntry.type, startAt: timeEntry.startAt };
      }
    } catch {
      // Non-fatal
    }

    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: visit.id, ts: new Date().toISOString() });

    res.json({ ...result.visit, activeTimeEntry });
  })
);

// ============================================================================
// POST /api/tech/visits/:visitId/notes — Add a note to the visit's job
// ============================================================================

const addNoteSchema = z.object({
  text: z.string().min(1).max(2000),
  equipmentId: z.string().uuid().nullable().optional(),
});

router.post(
  "/visits/:visitId/notes",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;
    const visit = await jobVisitsRepository.getAssignedVisit(companyId, req.params.visitId, userId);

    if (!visit) throw createError(404, "Visit not found or not assigned to you");

    const { text, equipmentId } = validateSchema(addNoteSchema, req.body);

    // Route through canonical storage method — equipmentId validated against job in repository
    const note = await jobNotesRepository.createJobNote(companyId, visit.jobId, userId, text.trim(), equipmentId ?? null);

    // Realtime: notify office surfaces (Job Detail notes panel) about new note
    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: req.params.visitId, ts: new Date().toISOString() });

    res.status(201).json(note);
  })
);

// ============================================================================
// PUT /api/tech/visits/:visitId/notes/:noteId — Edit a note on the visit's job
// DELETE /api/tech/visits/:visitId/notes/:noteId — Delete a note
//
// 2026-04-14: thin wrappers over the canonical jobNotesRepository methods.
// Author-only enforcement + tenant isolation are already handled in the
// repository layer. We only add assignment validation so a tech cannot
// reach notes attached to jobs not assigned to them.
// ============================================================================

const updateNoteSchema = z.object({
  text: z.string().min(1).max(2000),
});

router.put(
  "/visits/:visitId/notes/:noteId",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;
    const visit = await jobVisitsRepository.getAssignedVisit(companyId, req.params.visitId, userId);
    if (!visit) throw createError(404, "Visit not found or not assigned to you");

    const { text } = validateSchema(updateNoteSchema, req.body);
    const note = await jobNotesRepository.updateJobNote(
      companyId,
      req.params.noteId,
      userId,
      text.trim(),
    );

    emitDispatch(companyId, {
      scope: "calendar",
      entityType: "visit",
      entityId: req.params.visitId,
      ts: new Date().toISOString(),
    });

    res.json(note);
  }),
);

router.delete(
  "/visits/:visitId/notes/:noteId",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;
    const visit = await jobVisitsRepository.getAssignedVisit(companyId, req.params.visitId, userId);
    if (!visit) throw createError(404, "Visit not found or not assigned to you");

    await jobNotesRepository.deleteJobNote(companyId, req.params.noteId, userId);

    emitDispatch(companyId, {
      scope: "calendar",
      entityType: "visit",
      entityId: req.params.visitId,
      ts: new Date().toISOString(),
    });

    res.json({ success: true });
  }),
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

    // Get today's status using tenant timezone for correct day boundary
    const tz = await getTenantTimezone(companyId);
    const todayStr = todayInTimezone(tz);
    const { start: tzStart, end: tzEnd } = dayBoundsInTz(todayStr, tz);
    const todayStatus = await timeTrackingRepository.getTechnicianTodayStatus(
      companyId, userId, todayStr, tzStart, tzEnd
    );

    // Enrich today's entries with minimal job context (same pattern as day endpoint)
    const jobIds = Array.from(new Set(todayStatus.todayEntries.map(e => e.jobId).filter((id): id is string => id !== null)));
    let jobMap: Record<string, { jobNumber: number; summary: string; locationName: string | null }> = {};
    if (jobIds.length > 0) {
      const { inArray } = await import("drizzle-orm");
      const jobRows = await db
        .select({ id: jobs.id, jobNumber: jobs.jobNumber, summary: jobs.summary, locationName: clients.companyName })
        .from(jobs)
        .leftJoin(clients, eq(jobs.locationId, clients.id))
        .where(inArray(jobs.id, jobIds));
      for (const j of jobRows) {
        jobMap[j.id] = { jobNumber: j.jobNumber, summary: j.summary, locationName: j.locationName };
      }
    }
    const enrichedEntries = todayStatus.todayEntries.map(e => ({
      ...e,
      jobNumber: e.jobId ? jobMap[e.jobId]?.jobNumber ?? null : null,
      jobSummary: e.jobId ? jobMap[e.jobId]?.summary ?? null : null,
      locationName: e.jobId ? jobMap[e.jobId]?.locationName ?? null : null,
    }));

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

    // Week total from work_sessions (payroll source of truth)
    const mondayStr = monday.toISOString().split("T")[0];
    const sundayStr = new Date(sunday.getTime() + 86400000).toISOString().split("T")[0];
    const weekSessions = await timeTrackingRepository.getWorkSessionsForTechnician(
      companyId, userId, mondayStr, sundayStr
    );
    const { sumSessionMinutes: sumSessions } = await import("../storage/timeTracking");
    const weekTotalMinutes = sumSessions(weekSessions);

    res.json({
      today: {
        ...todayStatus,
        todayEntries: enrichedEntries,
      },
      week: {
        totalMinutes: weekTotalMinutes,
        totalHours: +(weekTotalMinutes / 60).toFixed(1),
        weekStart,
        weekEnd,
      },
    });
  })
);

// ============================================================================
// GET /api/tech/time/day — Time entries + work session for a specific date
// ============================================================================

const dayQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});

router.get(
  "/time/day",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;

    const { date } = validateSchema(dayQuerySchema, req.query);

    // Use tenant timezone for day boundaries (not UTC midnight)
    const tz = await getTenantTimezone(companyId);
    const { start: dayStart, end: dayEnd } = dayBoundsInTz(date, tz);
    const nextDayStr = new Date(dayStart.getTime() + 86400000).toISOString().split("T")[0];

    // Work session for this date (getWorkSessionsForTechnician uses gte/lt on workDate)
    const sessions = await timeTrackingRepository.getWorkSessionsForTechnician(
      companyId, userId, date, nextDayStr
    );
    const session = sessions[0] ?? null;

    // Time entries for this date with minimal job context (left join)
    const rows = await db
      .select({
        id: timeEntries.id,
        type: timeEntries.type,
        jobId: timeEntries.jobId,
        startAt: timeEntries.startAt,
        endAt: timeEntries.endAt,
        durationMinutes: timeEntries.durationMinutes,
        billable: timeEntries.billable,
        notes: timeEntries.notes,
        lockedAt: timeEntries.lockedAt,
        lockedByInvoiceId: timeEntries.lockedByInvoiceId,
        lockReason: timeEntries.lockReason,
        // Visit/task attribution
        visitId: timeEntries.visitId,
        taskId: timeEntries.taskId,
        // Job context (nullable — entry may have no job)
        jobNumber: jobs.jobNumber,
        jobSummary: jobs.summary,
        locationName: clients.companyName,
      })
      .from(timeEntries)
      .leftJoin(jobs, eq(timeEntries.jobId, jobs.id))
      .leftJoin(clients, eq(jobs.locationId, clients.id))
      .where(
        and(
          eq(timeEntries.companyId, companyId),
          eq(timeEntries.technicianId, userId),
          gte(timeEntries.startAt, dayStart),
          lt(timeEntries.startAt, dayEnd)
        )
      )
      .orderBy(asc(timeEntries.startAt));

    // Worked hours from work_sessions (payroll source of truth); time_entries remain as breakdown
    const { sumSessionMinutes } = await import("../storage/timeTracking");
    const workedMinutes = sumSessionMinutes(sessions);

    res.json({
      date,
      session,
      entries: rows,
      summary: {
        totalMinutes: workedMinutes,
        entriesCount: rows.length,
      },
    });
  })
);

// ============================================================================
// POST /api/tech/visits/:visitId/parts — Add a part to the visit's job
// ============================================================================

const addPartSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.string().min(1).default("1"),
  equipmentId: z.string().uuid().nullable().optional(),
});

router.post(
  "/visits/:visitId/parts",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;
    const visit = await jobVisitsRepository.getAssignedVisit(companyId, req.params.visitId, userId);
    if (!visit) throw createError(404, "Visit not found or not assigned to you");

    const { productId, quantity, equipmentId } = validateSchema(addPartSchema, req.body);

    // Validate product exists and belongs to company
    // 2026-04-08: P8 — Now also fetches `cost` so we can hydrate JobPart.unitCost
    // from the catalog. Previously this select omitted `cost` and tech-added
    // parts always had unitCost = NULL → broken profit margin calculations
    // downstream in PartsBillingCard.
    const [product] = await db
      .select({ id: items.id, name: items.name, unitPrice: items.unitPrice, cost: items.cost })
      .from(items)
      .where(and(eq(items.id, productId), eq(items.companyId, companyId), isNull(items.deletedAt)))
      .limit(1);
    if (!product) throw createError(400, "Product not found");

    // Validate equipmentId belongs to this job (via job_equipment)
    if (equipmentId) {
      const [linked] = await db
        .select({ id: jobEquipment.id })
        .from(jobEquipment)
        .where(and(
          eq(jobEquipment.companyId, companyId),
          eq(jobEquipment.jobId, visit.jobId),
          eq(jobEquipment.equipmentId, equipmentId),
        ))
        .limit(1);
      if (!linked) throw createError(400, "Equipment is not linked to this job");
    }

    // Write to canonical job_parts table.
    // 2026-04-08: P8 — Hydrates `unitCost` from `product.cost` so tech-added
    // parts carry their cost basis. Previously omitted, leaving unitCost NULL.
    const values: Record<string, unknown> = {
      companyId,
      jobId: visit.jobId,
      productId,
      equipmentId: equipmentId ?? null,
      description: product.name,
      quantity,
    };
    if (product.unitPrice != null) values.unitPrice = product.unitPrice;
    if (product.cost != null) values.unitCost = product.cost;

    const [part] = await db
      .insert(jobParts)
      .values(values as any)
      .returning();

    // Realtime: notify office surfaces (Parts panel on Job Detail) about new part
    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: req.params.visitId, ts: new Date().toISOString() });

    res.status(201).json(part);
  })
);

// ============================================================================
// DELETE /api/tech/visits/:visitId/parts/:partId — Remove part from job
// ============================================================================

router.delete(
  "/visits/:visitId/parts/:partId",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;
    const { visitId, partId } = req.params;

    const visit = await jobVisitsRepository.getAssignedVisit(companyId, visitId, userId);
    if (!visit) throw createError(404, "Visit not found or not assigned to you");

    // Use canonical storage — delegates to jobRepository.deleteJobPart
    const { storage } = await import("../storage/index");
    const deleted = await storage.deleteJobPart(companyId, partId);
    if (!deleted) throw createError(404, "Part not found");

    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: visitId, ts: new Date().toISOString() });

    res.json({ success: true });
  })
);

// ============================================================================
// DELETE /api/tech/visits/:visitId/equipment/:jobEquipmentId — Remove equipment from job
// ============================================================================

router.delete(
  "/visits/:visitId/equipment/:jobEquipmentId",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;
    const { visitId, jobEquipmentId } = req.params;

    const visit = await jobVisitsRepository.getAssignedVisit(companyId, visitId, userId);
    if (!visit) throw createError(404, "Visit not found or not assigned to you");

    // Block removal on completed/cancelled visits
    const terminalStatuses = ["completed", "cancelled"];
    if (terminalStatuses.includes(visit.status)) {
      throw createError(400, "Cannot modify equipment on a completed or cancelled visit");
    }

    // Use canonical job repository to delete (includes invoice lock guard)
    const deleted = await jobRepository.deleteJobEquipment(companyId, jobEquipmentId);
    if (!deleted) throw createError(404, "Equipment link not found");

    // No visit.equipmentIds update — job_equipment is the SSoT.
    // Visit detail endpoint reads equipment via job_equipment join, not the denormalized array.

    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: visitId, ts: new Date().toISOString() });

    res.json({ success: true });
  })
);

// ============================================================================
// POST /api/tech/visits/:visitId/equipment — Add existing equipment to job
// ============================================================================

const addEquipmentSchema = z.object({
  equipmentId: z.string().uuid(),
});

router.post(
  "/visits/:visitId/equipment",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;
    const visit = await jobVisitsRepository.getAssignedVisit(companyId, req.params.visitId, userId);
    if (!visit) throw createError(404, "Visit not found or not assigned to you");

    const { equipmentId } = validateSchema(addEquipmentSchema, req.body);

    // Verify equipment exists and belongs to company
    const [equip] = await db
      .select({ id: locationEquipment.id })
      .from(locationEquipment)
      .where(and(eq(locationEquipment.id, equipmentId), eq(locationEquipment.companyId, companyId), eq(locationEquipment.isActive, true)))
      .limit(1);
    if (!equip) throw createError(404, "Equipment not found");

    // Check if already linked to this job
    const [existing] = await db
      .select({ id: jobEquipment.id })
      .from(jobEquipment)
      .where(and(eq(jobEquipment.companyId, companyId), eq(jobEquipment.jobId, visit.jobId), eq(jobEquipment.equipmentId, equipmentId)))
      .limit(1);
    if (existing) throw createError(409, "Equipment already linked to this job");

    // Use canonical repository — auto-propagates to visits with null equipmentIds
    const result = await jobRepository.createJobEquipment(companyId, visit.jobId, { equipmentId });

    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: req.params.visitId, ts: new Date().toISOString() });

    res.status(201).json(result);
  })
);

// ============================================================================
// POST /api/tech/visits/:visitId/location-equipment — Create new location equipment + attach to job
// ============================================================================

const createLocationEquipmentSchema = z.object({
  name: z.string().min(1).max(255),
  equipmentType: z.string().max(100).nullable().optional(),
  manufacturer: z.string().max(255).nullable().optional(),
  modelNumber: z.string().max(255).nullable().optional(),
  serialNumber: z.string().max(255).nullable().optional(),
});

router.post(
  "/visits/:visitId/location-equipment",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;
    const visit = await jobVisitsRepository.getAssignedVisit(companyId, req.params.visitId, userId);
    if (!visit) throw createError(404, "Visit not found or not assigned to you");

    const data = validateSchema(createLocationEquipmentSchema, req.body);

    // Get the job's locationId
    const [job] = await db
      .select({ locationId: jobs.locationId })
      .from(jobs)
      .where(and(eq(jobs.id, visit.jobId), eq(jobs.companyId, companyId)))
      .limit(1);
    if (!job?.locationId) throw createError(400, "Job has no location");

    // Create location equipment via canonical storage
    const { storage } = await import("../storage/index");
    const created = await storage.createLocationEquipment(companyId, job.locationId, data);

    // Attach to job via canonical flow
    await jobRepository.createJobEquipment(companyId, visit.jobId, { equipmentId: created.id });

    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: req.params.visitId, ts: new Date().toISOString() });

    res.status(201).json(created);
  })
);

// ============================================================================
// POST /api/tech/items — Create a new catalog item (tech-scoped)
// ----------------------------------------------------------------------------
// This is NOT a parallel item-store; it is an auth-scoped shim that funnels
// straight into the canonical `storage.createItem` (ItemRepository) below.
// The reason it exists separately from `POST /api/items` is purely the auth
// gate: technicians cannot satisfy MANAGER_ROLES on the canonical route, so
// we accept a reduced field set under `requireSchedulable`. Both routes write
// to the same `items` table via the same repository.
//
// 2026-04-08: P6 — Verified intentional. PartRepository was deleted in P4;
// there is no shadow code path. Tech-created items appear in the office
// catalog immediately because both routes use ItemRepository.
// ============================================================================

const techCreateItemSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(["product", "service"]).default("product"),
  unitPrice: z.string().or(z.number()).nullable().optional(),
});

router.post(
  "/items",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;

    const data = validateSchema(techCreateItemSchema, req.body);

    const { storage } = await import("../storage/index");
    const created = await storage.createItem(companyId, userId, {
      name: data.name,
      type: data.type,
      unitPrice: data.unitPrice != null ? String(data.unitPrice) : null,
    });

    res.status(201).json(created);
  })
);

// ============================================================================
// PATCH /api/tech/visits/:visitId — Update visit instructions (visitNotes only)
// ============================================================================

// visitNotes (visit instructions) is office-owned — tech cannot edit post-create
const techUpdateVisitSchema = z.object({
  version: z.number().int(),
});

router.patch(
  "/visits/:visitId",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;

    const visit = await assertTechAssignedToVisit(companyId, userId, req.params.visitId);
    const { version } = validateSchema(techUpdateVisitSchema, req.body);

    // No writable fields currently — route preserved for version-based operations
    const updated = await jobVisitsRepository.updateJobVisit(
      companyId, req.params.visitId, version, {}
    );

    if (!updated) throw createError(404, "Visit not found");

    emitDispatch(companyId, { scope: "calendar", entityType: "visit", entityId: req.params.visitId, ts: new Date().toISOString() });
    res.json(updated);
  })
);

// ============================================================================
// PATCH /api/tech/jobs/:jobId — Update limited job fields from field
// ============================================================================

// description + accessInstructions are office-owned — tech cannot edit post-create
const techUpdateJobSchema = z.object({
  summary: z.string().max(500).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  version: z.number().int(),
});

router.patch(
  "/jobs/:jobId",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;
    const { jobId } = req.params;

    await assertTechAssignedToJob(companyId, userId, jobId);

    const { version, ...patch } = validateSchema(techUpdateJobSchema, req.body);

    if (Object.keys(patch).length === 0) {
      throw createError(400, "No fields to update");
    }

    const { storage } = await import("../storage/index");
    const updated = await storage.updateJob(companyId, jobId, version, patch);

    if (!updated) throw createError(404, "Job not found");

    emitDispatch(companyId, { scope: "calendar", entityType: "job", entityId: jobId, ts: new Date().toISOString() });
    res.json(updated);
  })
);

// ============================================================================
// POST /api/tech/jobs — Create a job from the field
// ============================================================================

const techCreateJobSchema = z.object({
  locationId: z.string().uuid(),
  jobType: z.enum(["maintenance", "repair", "inspection", "installation", "emergency"]).nullable().optional(),
  summary: z.string().min(1).max(500),
  description: z.string().max(5000).nullable().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  // Optional technician crew override — defaults to [creating user]
  assignedTechnicianIds: z.array(z.string().uuid()).optional(),
  // Scheduling — omit for "schedule later", provide for "schedule now"
  scheduledStart: z.string().datetime().optional(),
  scheduledEnd: z.string().datetime().optional(),
  durationMinutes: z.number().int().min(15).optional(),
});

router.post(
  "/jobs",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;

    const data = validateSchema(techCreateJobSchema, req.body);

    // Default crew to creating tech if not specified
    const crew = data.assignedTechnicianIds && data.assignedTechnicianIds.length > 0
      ? data.assignedTechnicianIds
      : [userId];

    // Step 1: Always create job UNSCHEDULED — scheduling ownership belongs
    // to schedulingRepository.scheduleJob(), not storage.createJob().
    const { storage } = await import("../storage/index");
    // 2026-04-12 final cleanup: only send the canonical crew array. The
    // createJob storage layer forwards it to the seed visit.
    const job = await storage.createJob(companyId, {
      locationId: data.locationId,
      jobType: data.jobType ?? null,
      summary: data.summary,
      description: data.description ?? null,
      priority: data.priority ?? "medium",
      status: "open",
      assignedTechnicianIds: crew,
    } as any);

    let visitId: string | undefined;

    // Step 2: If Schedule Now, route through canonical scheduling path.
    // This ensures terminal checks, version locking, syncJobScheduleFromVisits,
    // visit archival, openSubStatus clearing, and audit logging all fire.
    if (data.scheduledStart) {
      const startAt = new Date(data.scheduledStart);
      const dur = data.durationMinutes ?? 60;
      const endAt = data.scheduledEnd
        ? new Date(data.scheduledEnd)
        : new Date(startAt.getTime() + dur * 60_000);

      const normalized = normalizeScheduleTimes({
        allDay: false,
        startAt,
        endAt,
      });

      const scheduleResult = await schedulingRepository.scheduleJob(companyId, {
        jobId: job.id,
        // 2026-04-12 final cleanup: canonical crew array input.
        assignedTechnicianIds: crew,
        startAt: normalized.scheduledStart!,
        endAt: normalized.scheduledEnd!,
        allDay: false,
        expectedVersion: job.version ?? 0,
      });

      visitId = scheduleResult?.visit?.id;

      logEventAsync(getQueryCtx(req), {
        eventType: "job.scheduled",
        entityType: "job",
        entityId: job.id,
        summary: `Scheduled Job #${job.jobNumber} (tech create)`,
        meta: { jobNumber: job.jobNumber, assignedTechnicianIds: crew },
      });
      recomputeAttentionForEntity(companyId, "job", job.id).catch(() => {});
    }

    // For Schedule Later, find the initial visit ID from the unscheduled placeholder
    if (!visitId) {
      const [initialVisit] = await db
        .select({ id: jobVisits.id })
        .from(jobVisits)
        .where(and(eq(jobVisits.jobId, job.id), eq(jobVisits.companyId, companyId)))
        .orderBy(asc(jobVisits.visitNumber))
        .limit(1);
      visitId = initialVisit?.id;
    }

    emitDispatch(companyId, { scope: "calendar", entityType: "job", entityId: job.id, ts: new Date().toISOString() });
    res.status(201).json({ ...job, visitId });
  })
);

// ============================================================================
// POST /api/tech/clients — Create a client + location from the field
// Uses canonical customerCompanyRepository.findOrCreateCustomerCompany +
// storage.createClient (same ownership as POST /api/clients/full-create).
// ============================================================================

const techCreateClientSchema = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  companyName: z.string().max(300).optional(),
  phone: z.string().max(50).optional(),
  email: z.string().email().max(200).optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(200).optional(),
  province: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
}).refine(
  (d) => (d.companyName?.trim() || (d.firstName?.trim() && d.lastName?.trim())),
  { message: "Company name or first + last name is required" }
);

router.post(
  "/clients",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;

    const data = validateSchema(techCreateClientSchema, req.body);

    // Derive display name: company name takes priority, else "First Last"
    const personName = [data.firstName?.trim(), data.lastName?.trim()].filter(Boolean).join(" ");
    const displayName = data.companyName?.trim() || personName;
    const nameSource = data.companyName?.trim() ? "company" : "person";
    const contactName = personName || null;

    // Subscription limit check (canonical)
    const { storage } = await import("../storage/index");
    const limitCheck = await storage.canAddLocation(companyId);
    if (!limitCheck.allowed) {
      throw createError(403, limitCheck.reason || "Subscription limit reached");
    }

    // Step 1: Find or create customer company (canonical, dedup by name)
    const { customerCompanyRepository } = await import("../storage/index");
    const customerCompany = await customerCompanyRepository.findOrCreateCustomerCompany(
      companyId,
      {
        name: displayName,
        phone: data.phone?.trim() || null,
        email: data.email?.trim() || null,
        nameSource,
      }
    );

    // Step 2: Create primary location under customer company (canonical)
    const sentinelNextDue = new Date("9999-12-31").toISOString();
    const location = await storage.createClient(companyId, userId, {
      parentCompanyId: customerCompany.id,
      companyName: displayName,
      contactName,
      email: data.email?.trim() || null,
      phone: data.phone?.trim() || null,
      address: data.address?.trim() || null,
      city: data.city?.trim() || null,
      province: data.province?.trim() || null,
      postalCode: data.postalCode?.trim() || null,
      selectedMonths: [],
      inactive: false,
      isPrimary: true,
      needsDetails: !data.address?.trim(),
      nextDue: sentinelNextDue,
    } as any);

    logEventAsync(getQueryCtx(req), {
      eventType: "client.created",
      entityType: "client",
      entityId: location.id,
      summary: `Created client "${displayName}" (tech field)`,
      meta: { customerCompanyId: customerCompany.id },
    });

    res.status(201).json({
      locationId: location.id,
      companyName: location.companyName,
      address: location.address,
      city: location.city,
      customerCompanyId: customerCompany.id,
    });
  })
);

// ============================================================================
// POST /api/tech/tasks — Create a task from the field
//
// 2026-04-10: Tech-side task creation. Thin route following the same pattern
// as POST /api/tech/jobs and POST /api/tech/clients:
//   - requireSchedulable guard (schedulable users of any role)
//   - Calls canonical taskRepository.createTask (single storage entry point)
//   - Emits SSE dispatch event (same scope as the office task route)
//
// SELF-ASSIGNMENT ENFORCEMENT:
//   Technicians can create tasks ONLY for themselves. If the payload includes
//   an assignedToUserId that does not match the authenticated user, the route
//   returns 403. This is enforced server-side — the mobile UI does not expose
//   an assignee picker, but a crafted request must also be rejected.
//
//   Managers/admins/dispatchers continue using POST /api/tasks (MANAGER_ROLES)
//   where they can assign tasks to any user. This route is NOT a replacement
//   for the office route — it is a tech-scoped entry point that enforces the
//   self-assignment constraint.
// ============================================================================

// ============================================================================
// GET /api/tech/tasks/mine — Active tasks assigned to me
// ============================================================================

router.get(
  "/tasks/mine",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;

    const tz = await companyRepository.getCompanyTimezone(companyId);
    const todayStr = todayInTimezone(tz);
    const today = new Date(todayStr + "T00:00:00");

    const tasks = await taskRepository.getActiveTechTasks(companyId, userId, today);

    // 2026-04-10 INTEGRITY: Include canonical running timer state.
    // The UI must not infer running state from task.status (which stays
    // "in_progress" even after stopping). Instead, check time_entries.
    const runningEntry = await timeTrackingRepository.getRunningTimeEntry(companyId, userId);
    const runningTaskId = runningEntry?.taskId ?? null;

    res.json({ tasks, count: tasks.length, runningTaskId });
  }),
);

// ============================================================================
// POST /api/tech/tasks/:id/close — Complete a task (self-assigned only)
// ============================================================================

router.post(
  "/tasks/:id/close",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;
    const taskId = req.params.id;

    // Verify the task is assigned to the caller (self-only completion on mobile)
    const task = await taskRepository.getTask(companyId, taskId);
    if (!task) throw createError(404, "Task not found");
    if (task.assignedToUserId !== userId) {
      throw createError(403, "You can only complete tasks assigned to you.");
    }

    // 2026-04-10: Stop any running timer before closing (canonical through time_entries)
    const running = await timeTrackingRepository.getRunningTimeEntry(companyId, userId);
    if (running && running.taskId === taskId) {
      await timeTrackingRepository.stopAndDiscardIfTrivial(companyId, userId, {
        timeEntryId: running.id,
      });
    }

    const closed = await taskRepository.closeTask(companyId, taskId, userId);
    emitDispatch(companyId, { scope: "calendar", entityType: "task", entityId: taskId, ts: new Date().toISOString() });
    res.json(closed);
  }),
);

// 2026-04-10: tech task schema is DERIVED from the canonical createTaskSchema.
// TECH_ALLOWED_TASK_TYPES narrows the type field to GENERAL + SUPPLIER_VISIT.
// Supplier visit fields are optional — techs can provide supplierNameOther as
// a freeform fallback; managers can provide supplierId/supplierLocationId.
const techCreateTaskSchema = createTaskSchema
  .pick({
    title: true,
    notes: true,
    scheduledStartAt: true,
    scheduledEndAt: true,
    allDay: true,
    assignedToUserId: true,
  })
  .extend({
    type: z.enum(TECH_ALLOWED_TASK_TYPES),
    // Supplier visit fields — optional, only relevant when type = SUPPLIER_VISIT
    supplierId: z.string().uuid().nullable().optional(),
    supplierLocationId: z.string().uuid().nullable().optional(),
    supplierNameOther: z.string().max(200).nullable().optional(),
    poNumber: z.string().max(100).nullable().optional(),
  })
  .strict();

router.post(
  "/tasks",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const user = req.user as any;
    const userId = user.id;

    // Guard: requireSchedulable is the canonical mobile-eligible gate.
    // No role restriction — matches every other tech route (create-job,
    // create-client, add-part). Any schedulable user who opens the mobile
    // app can create a task. Self-assignment applies to ALL mobile users
    // regardless of role.

    const data = validateSchema(techCreateTaskSchema, req.body);

    // ── Self-assignment enforcement (route-level belt) ──
    if (data.assignedToUserId && data.assignedToUserId !== userId) {
      throw createError(403, "Mobile task creation is always self-assigned.");
    }

    // Narrow z.preprocess() output
    const startAt = typeof data.scheduledStartAt === "string" ? data.scheduledStartAt : undefined;
    const endAt = typeof data.scheduledEndAt === "string" ? data.scheduledEndAt : undefined;

    // Storage-level createTechTask enforces self-assignment again
    const task = await createTechTask(companyId, userId, {
      title: data.title,
      type: data.type,
      notes: data.notes,
      scheduledStartAt: startAt,
      scheduledEndAt: endAt,
      allDay: data.allDay ?? false,
    });

    // If SUPPLIER_VISIT, write the extension row with whatever supplier
    // info the caller provided. Techs typically send supplierNameOther;
    // managers may send supplierId + supplierLocationId.
    if (data.type === "SUPPLIER_VISIT") {
      const hasSvData = data.supplierId || data.supplierLocationId ||
                        data.supplierNameOther || data.poNumber;
      if (hasSvData) {
        try {
          await taskRepository.updateSupplierVisit(companyId, task.id, {
            supplierId: data.supplierId ?? null,
            supplierLocationId: data.supplierLocationId ?? null,
            supplierNameOther: data.supplierNameOther ?? null,
            poNumber: data.poNumber ?? null,
          });
        } catch (svErr: any) {
          // Non-fatal: the task was created, supplier details can be added later
          console.warn("[TECH_TASKS] supplier-visit details write failed:", svErr.message);
        }
      }
    }

    emitDispatch(companyId, {
      scope: "calendar",
      entityType: "task",
      entityId: task.id,
      ts: new Date().toISOString(),
    });

    res.status(201).json(task);
  }),
);

// ============================================================================
// POST /api/tech/tasks/:id/start — Start task timer (canonical time_entries)
// ============================================================================
//
// 2026-04-10 HARDENING: Delegates to taskTimerService.startTaskTimer.
// Service enforces: strict mode (409 if active timer), atomic status+entry.
// Route is a thin controller — validation + dispatch + response only.
router.post(
  "/tasks/:id/start",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;

    const { task, timeEntry } = await startTaskTimer(companyId, req.params.id, userId);

    emitDispatch(companyId, { scope: "calendar", entityType: "task", entityId: req.params.id, ts: new Date().toISOString() });
    res.json({ task, timeEntry });
  }),
);

// ============================================================================
// POST /api/tech/tasks/:id/stop — Stop task timer (canonical time_entries)
// ============================================================================
//
// 2026-04-10 HARDENING: Delegates to taskTimerService.stopTaskTimer.
// Service enforces targeted stop: only stops entry belonging to THIS task.
// Returns 409 if running entry belongs to a different context.
router.post(
  "/tasks/:id/stop",
  requireSchedulable,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;

    const { task, timeEntry } = await stopTaskTimer(companyId, req.params.id, userId);

    emitDispatch(companyId, { scope: "calendar", entityType: "task", entityId: req.params.id, ts: new Date().toISOString() });
    res.json({ task, timeEntry });
  }),
);

export default router;
