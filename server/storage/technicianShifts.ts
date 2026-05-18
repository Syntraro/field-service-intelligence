/**
 * Technician Shifts — storage layer (2026-05-18 Phase 1).
 *
 * Thin Drizzle wrapper over the `technician_shifts` table.
 * CRUD-only: NO recurrence logic, NO overlap logic, NO availability logic.
 * All business logic lives in availabilityEngine.ts.
 *
 * Row semantics (enforced by DB constraints):
 *   One-off:   recurrence_rule IS NULL AND recurrence_parent_id IS NULL
 *   Base:      recurrence_rule IS NOT NULL AND recurrence_parent_id IS NULL
 *   Exception: recurrence_parent_id IS NOT NULL (edit/cancel of one occurrence)
 *
 * Operations:
 *   listBaseShiftsInWindow   — base rows in time window (for engine expansion)
 *   listExceptionsForBases   — exception rows for given base IDs
 *   findById                 — single row
 *   create                   — INSERT base or one-off shift
 *   update                   — PATCH base row
 *   hardDelete               — DELETE base row (CASCADE removes exceptions)
 *   createException          — INSERT exception row
 *   updateException          — PATCH exception row
 *   deleteException          — hard-delete exception row (correction pointer only)
 */
import { and, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import {
  technicianShifts,
  type TechnicianShift,
  type InsertTechnicianShift,
} from "@shared/schema";

// ─── Type helpers ────────────────────────────────────────────────────────────

type ShiftType = "normal" | "on_call" | "unavailable";
type ShiftSubtype = "vacation" | "sick" | "personal" | "training" | "holiday" | "scheduled_off" | "other";

export interface CreateShiftInput {
  technicianUserId: string;
  templateId?: string | null;
  shiftType: ShiftType;
  shiftSubtype?: ShiftSubtype | null;
  label?: string | null;
  color?: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay?: boolean;
  timeOfDayStart?: string | null;
  timeOfDayEnd?: string | null;
  recurrenceRule?: string | null;
  recurrenceEndDate?: string | null;
  note?: string | null;
}

export interface UpdateShiftPatch {
  shiftType?: ShiftType;
  shiftSubtype?: ShiftSubtype | null;
  label?: string | null;
  color?: string | null;
  startsAt?: Date;
  endsAt?: Date;
  allDay?: boolean;
  timeOfDayStart?: string | null;
  timeOfDayEnd?: string | null;
  recurrenceRule?: string | null;
  recurrenceEndDate?: string | null;
  note?: string | null;
}

export interface CreateExceptionInput {
  recurrenceParentId: string;
  technicianUserId: string;
  occurrenceDate: string;    // YYYY-MM-DD
  isCancelled?: boolean;
  shiftType: ShiftType;
  shiftSubtype?: ShiftSubtype | null;
  label?: string | null;
  color?: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay?: boolean;
  timeOfDayStart?: string | null;
  timeOfDayEnd?: string | null;
  note?: string | null;
}

export interface UpdateExceptionPatch {
  isCancelled?: boolean;
  shiftType?: ShiftType;
  shiftSubtype?: ShiftSubtype | null;
  label?: string | null;
  color?: string | null;
  startsAt?: Date;
  endsAt?: Date;
  allDay?: boolean;
  timeOfDayStart?: string | null;
  timeOfDayEnd?: string | null;
  note?: string | null;
}

// ─── Repository methods ──────────────────────────────────────────────────────

/**
 * Fetch all base rows (no parent) whose [starts_at, ends_at) overlaps the window.
 * Returns both one-off (no recurrence_rule) and recurring base rows.
 * technicianUserIds = null fetches all technicians in the company.
 */
async function listBaseShiftsInWindow(
  companyId: string,
  technicianUserIds: string[] | null,
  windowStart: Date,
  windowEnd: Date,
): Promise<TechnicianShift[]> {
  const conditions = [
    eq(technicianShifts.companyId, companyId),
    isNull(technicianShifts.recurrenceParentId),
    lt(technicianShifts.startsAt, windowEnd),
    gt(technicianShifts.endsAt, windowStart),
  ];
  if (technicianUserIds !== null && technicianUserIds.length > 0) {
    conditions.push(inArray(technicianShifts.technicianUserId, technicianUserIds));
  }
  return await db
    .select()
    .from(technicianShifts)
    .where(and(...conditions));
}

/**
 * Fetch exception rows for a set of base shift IDs within a date range.
 * Uses idx_tech_shifts_exceptions.
 */
async function listExceptionsForBases(
  companyId: string,
  baseShiftIds: string[],
  windowStartDate: string,
  windowEndDate: string,
): Promise<TechnicianShift[]> {
  if (baseShiftIds.length === 0) return [];
  return await db
    .select()
    .from(technicianShifts)
    .where(
      and(
        eq(technicianShifts.companyId, companyId),
        inArray(technicianShifts.recurrenceParentId, baseShiftIds),
        // occurrence_date between windowStartDate and windowEndDate
        sql`${technicianShifts.occurrenceDate} >= ${windowStartDate}`,
        sql`${technicianShifts.occurrenceDate} <= ${windowEndDate}`,
      ),
    );
}

/** Single-row read. Returns null when not found or cross-tenant. */
async function findById(
  companyId: string,
  id: string,
): Promise<TechnicianShift | null> {
  const rows = await db
    .select()
    .from(technicianShifts)
    .where(
      and(
        eq(technicianShifts.companyId, companyId),
        eq(technicianShifts.id, id),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Insert a base or one-off shift row. */
async function create(
  companyId: string,
  input: CreateShiftInput,
  createdByUserId: string,
): Promise<TechnicianShift> {
  const insert: InsertTechnicianShift = {
    companyId,
    technicianUserId: input.technicianUserId,
    templateId: input.templateId ?? null,
    shiftType: input.shiftType,
    shiftSubtype: input.shiftSubtype ?? null,
    label: input.label ?? null,
    color: input.color ?? null,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    allDay: input.allDay ?? false,
    timeOfDayStart: input.timeOfDayStart ?? null,
    timeOfDayEnd: input.timeOfDayEnd ?? null,
    recurrenceRule: input.recurrenceRule ?? null,
    recurrenceEndDate: input.recurrenceEndDate ?? null,
    note: input.note ?? null,
    createdByUserId,
  };
  const rows = await db
    .insert(technicianShifts)
    .values(insert)
    .returning();
  if (rows.length === 0) {
    throw new Error("Failed to insert technician_shifts row");
  }
  return rows[0];
}

/** Patch a base shift row (not exceptions). */
async function update(
  companyId: string,
  id: string,
  patch: UpdateShiftPatch,
): Promise<TechnicianShift | null> {
  const patchValues: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.shiftType !== undefined) patchValues.shiftType = patch.shiftType;
  if (patch.shiftSubtype !== undefined) patchValues.shiftSubtype = patch.shiftSubtype;
  if (patch.label !== undefined) patchValues.label = patch.label;
  if (patch.color !== undefined) patchValues.color = patch.color;
  if (patch.startsAt !== undefined) patchValues.startsAt = patch.startsAt;
  if (patch.endsAt !== undefined) patchValues.endsAt = patch.endsAt;
  if (patch.allDay !== undefined) patchValues.allDay = patch.allDay;
  if (patch.timeOfDayStart !== undefined) patchValues.timeOfDayStart = patch.timeOfDayStart;
  if (patch.timeOfDayEnd !== undefined) patchValues.timeOfDayEnd = patch.timeOfDayEnd;
  if (patch.recurrenceRule !== undefined) patchValues.recurrenceRule = patch.recurrenceRule;
  if (patch.recurrenceEndDate !== undefined) patchValues.recurrenceEndDate = patch.recurrenceEndDate;
  if (patch.note !== undefined) patchValues.note = patch.note;

  const rows = await db
    .update(technicianShifts)
    .set(patchValues)
    .where(
      and(
        eq(technicianShifts.companyId, companyId),
        eq(technicianShifts.id, id),
        isNull(technicianShifts.recurrenceParentId),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/**
 * Hard-delete a base shift row. Exception rows are removed automatically
 * by the ON DELETE CASCADE FK on recurrence_parent_id.
 */
async function hardDelete(companyId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(technicianShifts)
    .where(
      and(
        eq(technicianShifts.companyId, companyId),
        eq(technicianShifts.id, id),
      ),
    )
    .returning({ id: technicianShifts.id });
  return rows.length > 0;
}

/** Insert an exception row for a specific recurring occurrence. */
async function createException(
  companyId: string,
  input: CreateExceptionInput,
  createdByUserId: string,
): Promise<TechnicianShift> {
  const insert: InsertTechnicianShift = {
    companyId,
    technicianUserId: input.technicianUserId,
    recurrenceParentId: input.recurrenceParentId,
    occurrenceDate: input.occurrenceDate,
    isCancelled: input.isCancelled ?? false,
    shiftType: input.shiftType,
    shiftSubtype: input.shiftSubtype ?? null,
    label: input.label ?? null,
    color: input.color ?? null,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    allDay: input.allDay ?? false,
    timeOfDayStart: input.timeOfDayStart ?? null,
    timeOfDayEnd: input.timeOfDayEnd ?? null,
    note: input.note ?? null,
    createdByUserId,
  };
  const rows = await db
    .insert(technicianShifts)
    .values(insert)
    .returning();
  if (rows.length === 0) {
    throw new Error("Failed to insert technician_shifts exception row");
  }
  return rows[0];
}

/** Patch an exception row. */
async function updateException(
  companyId: string,
  exceptionId: string,
  patch: UpdateExceptionPatch,
): Promise<TechnicianShift | null> {
  const patchValues: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.isCancelled !== undefined) patchValues.isCancelled = patch.isCancelled;
  if (patch.shiftType !== undefined) patchValues.shiftType = patch.shiftType;
  if (patch.shiftSubtype !== undefined) patchValues.shiftSubtype = patch.shiftSubtype;
  if (patch.label !== undefined) patchValues.label = patch.label;
  if (patch.color !== undefined) patchValues.color = patch.color;
  if (patch.startsAt !== undefined) patchValues.startsAt = patch.startsAt;
  if (patch.endsAt !== undefined) patchValues.endsAt = patch.endsAt;
  if (patch.allDay !== undefined) patchValues.allDay = patch.allDay;
  if (patch.timeOfDayStart !== undefined) patchValues.timeOfDayStart = patch.timeOfDayStart;
  if (patch.timeOfDayEnd !== undefined) patchValues.timeOfDayEnd = patch.timeOfDayEnd;
  if (patch.note !== undefined) patchValues.note = patch.note;

  const rows = await db
    .update(technicianShifts)
    .set(patchValues)
    .where(
      and(
        eq(technicianShifts.companyId, companyId),
        eq(technicianShifts.id, exceptionId),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/**
 * Hard-delete an exception row. Exceptions are correction pointers, not
 * data records — removing one restores the base occurrence.
 */
async function deleteException(
  companyId: string,
  exceptionId: string,
): Promise<boolean> {
  const rows = await db
    .delete(technicianShifts)
    .where(
      and(
        eq(technicianShifts.companyId, companyId),
        eq(technicianShifts.id, exceptionId),
      ),
    )
    .returning({ id: technicianShifts.id });
  return rows.length > 0;
}

export const technicianShiftsRepository = {
  listBaseShiftsInWindow,
  listExceptionsForBases,
  findById,
  create,
  update,
  hardDelete,
  createException,
  updateException,
  deleteException,
};
