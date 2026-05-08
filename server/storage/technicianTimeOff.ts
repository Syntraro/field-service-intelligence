/**
 * Technician Time Off — storage layer (2026-05-07 RALPH).
 *
 * Thin Drizzle wrapper over the `technician_time_off` table. Permission
 * enforcement and tenant validation live in the route handler — the
 * storage layer takes already-validated input.
 *
 * Operations:
 *   • listOverlapping(companyId, opts) — rows whose interval overlaps
 *     the requested window; default scope is "all techs in company".
 *     Filters out soft-deleted rows (archivedAt IS NULL).
 *   • listForTechnicianRange(companyId, technicianUserId, startISO, endISO)
 *     — same as listOverlapping but pinned to one tech.
 *   • create(companyId, input, createdByUserId)
 *   • update(companyId, id, patch)
 *   • softDelete(companyId, id) — sets archivedAt = NOW().
 *
 * Capacity reads (`server/storage/capacity.ts`) call `listOverlapping`
 * for the day's window and clip open slots around the returned rows.
 */
import { and, asc, eq, gte, isNull, lt, lte, gt, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  technicianTimeOff,
  type TechnicianTimeOffRow,
  type InsertTechnicianTimeOff,
} from "@shared/schema";

export interface ListOverlappingOptions {
  /** Restrict to a single technician. Omit for all-team. */
  technicianUserId?: string;
  /** Start of the overlap window (UTC ISO). Inclusive. */
  windowStart: Date;
  /** End of the overlap window (UTC ISO). Exclusive. */
  windowEnd: Date;
}

/**
 * Two intervals overlap iff `a.start < b.end AND a.end > b.start`.
 * The query below applies that predicate against the requested window.
 */
async function listOverlapping(
  companyId: string,
  opts: ListOverlappingOptions,
): Promise<TechnicianTimeOffRow[]> {
  const conditions = [
    eq(technicianTimeOff.companyId, companyId),
    isNull(technicianTimeOff.archivedAt),
    lt(technicianTimeOff.startsAt, opts.windowEnd),
    gt(technicianTimeOff.endsAt, opts.windowStart),
  ];
  if (opts.technicianUserId) {
    conditions.push(
      eq(technicianTimeOff.technicianUserId, opts.technicianUserId),
    );
  }
  return await db
    .select()
    .from(technicianTimeOff)
    .where(and(...conditions))
    .orderBy(asc(technicianTimeOff.startsAt));
}

/** Single-row read by id. Returns null when not found, soft-deleted,
 *  or cross-tenant. */
async function findById(
  companyId: string,
  id: string,
): Promise<TechnicianTimeOffRow | null> {
  const rows = await db
    .select()
    .from(technicianTimeOff)
    .where(
      and(
        eq(technicianTimeOff.companyId, companyId),
        eq(technicianTimeOff.id, id),
        isNull(technicianTimeOff.archivedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Insert one row. The caller is responsible for verifying the
 *  technician belongs to the same company before calling this. */
async function create(
  companyId: string,
  input: {
    technicianUserId: string;
    reason: string;
    startsAt: Date;
    endsAt: Date;
    allDay: boolean;
    note: string | null;
    createdByUserId: string;
  },
): Promise<TechnicianTimeOffRow> {
  const insert: InsertTechnicianTimeOff = {
    companyId,
    technicianUserId: input.technicianUserId,
    reason: input.reason,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    allDay: input.allDay,
    note: input.note,
    createdByUserId: input.createdByUserId,
  };
  const rows = await db
    .insert(technicianTimeOff)
    .values(insert)
    .returning();
  if (rows.length === 0) {
    throw new Error("Failed to insert technician_time_off row");
  }
  return rows[0];
}

/** Patch one row. Caller has already validated the patch against the
 *  current row (e.g., that the new range is still valid). */
async function update(
  companyId: string,
  id: string,
  patch: Partial<{
    reason: string;
    startsAt: Date;
    endsAt: Date;
    allDay: boolean;
    note: string | null;
  }>,
): Promise<TechnicianTimeOffRow | null> {
  const patchValues: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.reason !== undefined) patchValues.reason = patch.reason;
  if (patch.startsAt !== undefined) patchValues.startsAt = patch.startsAt;
  if (patch.endsAt !== undefined) patchValues.endsAt = patch.endsAt;
  if (patch.allDay !== undefined) patchValues.allDay = patch.allDay;
  if (patch.note !== undefined) patchValues.note = patch.note;
  const rows = await db
    .update(technicianTimeOff)
    .set(patchValues)
    .where(
      and(
        eq(technicianTimeOff.companyId, companyId),
        eq(technicianTimeOff.id, id),
        isNull(technicianTimeOff.archivedAt),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/** Soft-delete by setting `archived_at = NOW()`. Future reads filter
 *  these out; the row is preserved for audit. */
async function softDelete(
  companyId: string,
  id: string,
): Promise<boolean> {
  const rows = await db
    .update(technicianTimeOff)
    .set({ archivedAt: sql`NOW()` })
    .where(
      and(
        eq(technicianTimeOff.companyId, companyId),
        eq(technicianTimeOff.id, id),
        isNull(technicianTimeOff.archivedAt),
      ),
    )
    .returning({ id: technicianTimeOff.id });
  return rows.length > 0;
}

export const technicianTimeOffRepository = {
  listOverlapping,
  findById,
  create,
  update,
  softDelete,
};
