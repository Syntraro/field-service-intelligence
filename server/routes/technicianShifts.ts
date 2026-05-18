/**
 * Technician Shift Management Routes — Phase 1 (2026-05-18).
 *
 * Mounted at `/api/shift-management`. All endpoints require:
 *   requireAuth + requireRole(MANAGER_ROLES) + requireFeature('technician_shift_management')
 *
 * Endpoints
 * ---------
 * Templates:
 *   GET    /                   List all active templates
 *   POST   /                   Create template
 *   PATCH  /:id                Update template
 *   DELETE /:id                Hard-delete template (nullifies template_id on shifts)
 *
 * Shifts:
 *   GET    /shifts             List resolved shifts in window
 *   POST   /shifts             Create shift (one-off or recurring)
 *   PATCH  /shifts/:id         Update base shift
 *   DELETE /shifts/:id         Hard-delete base shift (CASCADE removes exceptions)
 *
 * Exceptions:
 *   POST   /shifts/:id/exceptions              Create exception (edit/cancel occurrence)
 *   PATCH  /shifts/:id/exceptions/:exceptionId Update exception
 *   DELETE /shifts/:id/exceptions/:exceptionId Remove exception (restore base occurrence)
 *
 * Availability:
 *   GET    /availability                       Resolved shifts for window + optional techs
 *   GET    /availability/:technicianUserId     Single tech's day availability
 *   GET    /on-call                            On-call coverage in window
 *   POST   /validate-assignment               Validate a proposed assignment
 *
 * Tenant isolation: every storage call filters by req.companyId.
 */
import { Router, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { requireAuth } from "../auth/requireAuth";
import { requireRole } from "../auth/requireRole";
import { requireFeature } from "../auth/requireFeature";
import { MANAGER_ROLES } from "../auth/roles";
import { db } from "../db";
import { users } from "@shared/schema";
import {
  insertShiftTemplateSchema,
  updateShiftTemplateSchema,
  insertShiftSchema,
  updateShiftSchema,
  insertShiftExceptionSchema,
  updateShiftExceptionSchema,
  availabilityQuerySchema,
  validateAssignmentSchema,
} from "@shared/schema";
import { technicianShiftTemplatesRepository } from "../storage/technicianShiftTemplates";
import { technicianShiftsRepository } from "../storage/technicianShifts";
import { availabilityEngine } from "../services/availabilityEngine";
import { companyRepository } from "../storage/company";

const router = Router();

// ── Mount-level gates ────────────────────────────────────────────────────────
router.use(requireAuth);
router.use(requireRole(MANAGER_ROLES));
router.use(requireFeature("technician_shift_management"));

// ── Shared helpers ───────────────────────────────────────────────────────────

const idParamSchema = z.object({ id: z.string().uuid() }).strict();

const technicianExceptionParamSchema = z
  .object({ id: z.string().uuid(), exceptionId: z.string().uuid() })
  .strict();

/** Verify the technician belongs to the requesting tenant. Throws 404 if not. */
async function assertTechnicianInCompany(
  companyId: string,
  technicianUserId: string,
): Promise<void> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, technicianUserId), eq(users.companyId, companyId)))
    .limit(1);
  if (rows.length === 0) {
    throw createError(404, "Technician not found in this company");
  }
}

// =============================================================================
// TEMPLATES
// =============================================================================

// ── GET / — list templates ───────────────────────────────────────────────────

router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const templates = await technicianShiftTemplatesRepository.list(companyId);
    res.json({ templates });
  }),
);

// ── POST / — create template ─────────────────────────────────────────────────

router.post(
  "/",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const body = validateSchema(insertShiftTemplateSchema, req.body);
    const companyId = req.companyId!;
    const template = await technicianShiftTemplatesRepository.create(
      companyId,
      {
        name: body.name,
        shiftType: body.shiftType,
        shiftSubtype: body.shiftSubtype ?? null,
        label: body.label ?? null,
        color: body.color ?? null,
        timeOfDayStart: body.timeOfDayStart ?? null,
        timeOfDayEnd: body.timeOfDayEnd ?? null,
        recurrenceRule: body.recurrenceRule ?? null,
        isActive: body.isActive,
      },
      req.user!.id,
    );
    res.status(201).json({ template });
  }),
);

// ── PATCH /:id — update template ─────────────────────────────────────────────

router.patch(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = validateSchema(idParamSchema, req.params);
    const body = validateSchema(updateShiftTemplateSchema, req.body);
    const companyId = req.companyId!;
    const existing = await technicianShiftTemplatesRepository.findById(companyId, id);
    if (!existing) throw createError(404, "Shift template not found");
    const updated = await technicianShiftTemplatesRepository.update(companyId, id, {
      name: body.name,
      shiftType: body.shiftType,
      shiftSubtype: body.shiftSubtype,
      label: body.label,
      color: body.color,
      timeOfDayStart: body.timeOfDayStart,
      timeOfDayEnd: body.timeOfDayEnd,
      recurrenceRule: body.recurrenceRule,
      isActive: body.isActive,
    });
    if (!updated) throw createError(404, "Shift template not found");
    res.json({ template: updated });
  }),
);

// ── DELETE /:id — hard-delete template ───────────────────────────────────────

router.delete(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = validateSchema(idParamSchema, req.params);
    const companyId = req.companyId!;
    const ok = await technicianShiftTemplatesRepository.hardDelete(companyId, id);
    if (!ok) throw createError(404, "Shift template not found");
    res.status(204).end();
  }),
);

// =============================================================================
// SHIFTS
// =============================================================================

const shiftsListQuerySchema = z
  .object({
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
    technicianUserId: z.string().uuid().optional(),
  })
  .strict();

// ── GET /shifts — list resolved shifts ───────────────────────────────────────

router.get(
  "/shifts",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const query = validateSchema(shiftsListQuerySchema, req.query);
    const companyId = req.companyId!;
    if (new Date(query.end) <= new Date(query.start)) {
      throw createError(400, "end must be strictly after start");
    }
    const timezone = await companyRepository.getCompanyTimezone(companyId);
    const techIds = query.technicianUserId ? [query.technicianUserId] : null;
    const shifts = await availabilityEngine.resolveTechnicianShifts(
      companyId,
      techIds,
      new Date(query.start),
      new Date(query.end),
      timezone,
    );
    res.json({ shifts, timezone });
  }),
);

// ── POST /shifts — create shift ───────────────────────────────────────────────

router.post(
  "/shifts",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const body = validateSchema(insertShiftSchema, req.body);
    const companyId = req.companyId!;
    await assertTechnicianInCompany(companyId, body.technicianUserId);
    const shift = await technicianShiftsRepository.create(
      companyId,
      {
        technicianUserId: body.technicianUserId,
        templateId: body.templateId ?? null,
        shiftType: body.shiftType,
        shiftSubtype: body.shiftSubtype ?? null,
        label: body.label ?? null,
        color: body.color ?? null,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        allDay: body.allDay ?? false,
        timeOfDayStart: body.timeOfDayStart ?? null,
        timeOfDayEnd: body.timeOfDayEnd ?? null,
        recurrenceRule: body.recurrenceRule ?? null,
        recurrenceEndDate: body.recurrenceEndDate ?? null,
        note: body.note ?? null,
      },
      req.user!.id,
    );
    res.status(201).json({ shift });
  }),
);

// ── PATCH /shifts/:id — update base shift ─────────────────────────────────────

router.patch(
  "/shifts/:id",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = validateSchema(idParamSchema, req.params);
    const body = validateSchema(updateShiftSchema, req.body);
    const companyId = req.companyId!;
    const existing = await technicianShiftsRepository.findById(companyId, id);
    if (!existing) throw createError(404, "Shift not found");
    // Validate the new date range if provided (single-sided update support).
    const nextStart = body.startsAt ? new Date(body.startsAt) : existing.startsAt;
    const nextEnd = body.endsAt ? new Date(body.endsAt) : existing.endsAt;
    if (nextEnd <= nextStart) {
      throw createError(400, "endsAt must be strictly after startsAt");
    }
    const updated = await technicianShiftsRepository.update(companyId, id, {
      shiftType: body.shiftType,
      shiftSubtype: body.shiftSubtype ?? undefined,
      label: body.label,
      color: body.color,
      startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
      endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
      allDay: body.allDay,
      timeOfDayStart: body.timeOfDayStart,
      timeOfDayEnd: body.timeOfDayEnd,
      recurrenceRule: body.recurrenceRule,
      recurrenceEndDate: body.recurrenceEndDate ?? undefined,
      note: body.note,
    });
    if (!updated) throw createError(404, "Shift not found");
    res.json({ shift: updated });
  }),
);

// ── DELETE /shifts/:id — hard-delete base shift ───────────────────────────────

router.delete(
  "/shifts/:id",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = validateSchema(idParamSchema, req.params);
    const companyId = req.companyId!;
    const ok = await technicianShiftsRepository.hardDelete(companyId, id);
    if (!ok) throw createError(404, "Shift not found");
    res.status(204).end();
  }),
);

// =============================================================================
// EXCEPTIONS
// =============================================================================

// ── POST /shifts/:id/exceptions — create exception ───────────────────────────

router.post(
  "/shifts/:id/exceptions",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = validateSchema(idParamSchema, req.params);
    const body = validateSchema(insertShiftExceptionSchema, req.body);
    const companyId = req.companyId!;
    const base = await technicianShiftsRepository.findById(companyId, id);
    if (!base) throw createError(404, "Shift not found");
    if (!base.recurrenceRule) {
      throw createError(400, "Only recurring shifts can have exceptions");
    }
    // For a cancellation exception, we still need valid times — use base shift's.
    const startsAt = body.startsAt ? new Date(body.startsAt) : base.startsAt;
    const endsAt = body.endsAt ? new Date(body.endsAt) : base.endsAt;
    if (endsAt <= startsAt) {
      throw createError(400, "endsAt must be strictly after startsAt");
    }
    const exception = await technicianShiftsRepository.createException(
      companyId,
      {
        recurrenceParentId: id,
        technicianUserId: base.technicianUserId,
        occurrenceDate: body.occurrenceDate,
        isCancelled: body.isCancelled ?? false,
        shiftType: (body.shiftType ?? base.shiftType) as "normal" | "on_call" | "unavailable",
        shiftSubtype: (body.shiftSubtype ?? base.shiftSubtype) as any,
        label: body.label ?? base.label,
        color: body.color ?? base.color,
        startsAt,
        endsAt,
        allDay: body.allDay ?? base.allDay,
        timeOfDayStart: body.timeOfDayStart !== undefined ? body.timeOfDayStart : base.timeOfDayStart,
        timeOfDayEnd: body.timeOfDayEnd !== undefined ? body.timeOfDayEnd : base.timeOfDayEnd,
        note: body.note ?? base.note,
      },
      req.user!.id,
    );
    res.status(201).json({ exception });
  }),
);

// ── PATCH /shifts/:id/exceptions/:exceptionId — update exception ──────────────

router.patch(
  "/shifts/:id/exceptions/:exceptionId",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id, exceptionId } = validateSchema(technicianExceptionParamSchema, req.params);
    const body = validateSchema(updateShiftExceptionSchema, req.body);
    const companyId = req.companyId!;
    const base = await technicianShiftsRepository.findById(companyId, id);
    if (!base) throw createError(404, "Base shift not found");
    const existing = await technicianShiftsRepository.findById(companyId, exceptionId);
    if (!existing || existing.recurrenceParentId !== id) {
      throw createError(404, "Exception not found");
    }
    if (body.startsAt || body.endsAt) {
      const nextStart = body.startsAt ? new Date(body.startsAt) : existing.startsAt;
      const nextEnd = body.endsAt ? new Date(body.endsAt) : existing.endsAt;
      if (nextEnd <= nextStart) {
        throw createError(400, "endsAt must be strictly after startsAt");
      }
    }
    const updated = await technicianShiftsRepository.updateException(
      companyId,
      exceptionId,
      {
        isCancelled: body.isCancelled,
        shiftType: body.shiftType,
        shiftSubtype: body.shiftSubtype ?? undefined,
        label: body.label,
        color: body.color,
        startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
        endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
        allDay: body.allDay,
        timeOfDayStart: body.timeOfDayStart,
        timeOfDayEnd: body.timeOfDayEnd,
        note: body.note,
      },
    );
    if (!updated) throw createError(404, "Exception not found");
    res.json({ exception: updated });
  }),
);

// ── DELETE /shifts/:id/exceptions/:exceptionId — remove exception ─────────────

router.delete(
  "/shifts/:id/exceptions/:exceptionId",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id, exceptionId } = validateSchema(technicianExceptionParamSchema, req.params);
    const companyId = req.companyId!;
    const base = await technicianShiftsRepository.findById(companyId, id);
    if (!base) throw createError(404, "Base shift not found");
    const ok = await technicianShiftsRepository.deleteException(companyId, exceptionId);
    if (!ok) throw createError(404, "Exception not found");
    res.status(204).end();
  }),
);

// =============================================================================
// AVAILABILITY
// =============================================================================

// ── GET /availability — resolved shifts for window + optional techs ───────────

router.get(
  "/availability",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const query = validateSchema(availabilityQuerySchema, req.query);
    const companyId = req.companyId!;
    if (new Date(query.end) <= new Date(query.start)) {
      throw createError(400, "end must be strictly after start");
    }
    const timezone = await companyRepository.getCompanyTimezone(companyId);
    // technicianUserIds: optional comma-separated UUID list
    let techIds: string[] | null = null;
    if (query.technicianUserIds) {
      techIds = query.technicianUserIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    const shifts = await availabilityEngine.resolveTechnicianShifts(
      companyId,
      techIds,
      new Date(query.start),
      new Date(query.end),
      timezone,
    );
    res.json({ shifts, timezone });
  }),
);

// ── GET /availability/:technicianUserId?date=YYYY-MM-DD ───────────────────────

const techAvailParamSchema = z.object({ technicianUserId: z.string().uuid() }).strict();
const techAvailQuerySchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  })
  .strict();

router.get(
  "/availability/:technicianUserId",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { technicianUserId } = validateSchema(techAvailParamSchema, req.params);
    const { date } = validateSchema(techAvailQuerySchema, req.query);
    const companyId = req.companyId!;
    const timezone = await companyRepository.getCompanyTimezone(companyId);
    const availability = await availabilityEngine.resolveTechnicianAvailability(
      companyId,
      technicianUserId,
      date,
      timezone,
    );
    res.json({ availability, timezone });
  }),
);

// ── GET /on-call?start=ISO&end=ISO ────────────────────────────────────────────

const onCallQuerySchema = z
  .object({
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
  })
  .strict();

router.get(
  "/on-call",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const query = validateSchema(onCallQuerySchema, req.query);
    const companyId = req.companyId!;
    if (new Date(query.end) <= new Date(query.start)) {
      throw createError(400, "end must be strictly after start");
    }
    const timezone = await companyRepository.getCompanyTimezone(companyId);
    const coverage = await availabilityEngine.resolveOnCallCoverage(
      companyId,
      new Date(query.start),
      new Date(query.end),
      timezone,
    );
    res.json({ coverage, timezone });
  }),
);

// ── POST /validate-assignment ─────────────────────────────────────────────────

router.post(
  "/validate-assignment",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const body = validateSchema(validateAssignmentSchema, req.body);
    const companyId = req.companyId!;
    await assertTechnicianInCompany(companyId, body.technicianUserId);
    const timezone = await companyRepository.getCompanyTimezone(companyId);
    const validation = await availabilityEngine.validateAssignmentAgainstAvailability(
      companyId,
      body.technicianUserId,
      new Date(body.proposedStart),
      new Date(body.proposedEnd),
      timezone,
      { excludeShiftId: body.excludeShiftId },
    );
    res.json({ validation });
  }),
);

export default router;
