/**
 * Technician Schedule Overrides — storage layer (2026-05-17 Phase 2).
 *
 * Thin Drizzle wrapper over `technician_schedule_overrides`.
 * Permission enforcement and tenant validation live in the route
 * handler; this layer takes already-validated input.
 *
 * Operations:
 *   • listOverridesForRange         — overrides whose date falls in [start, end].
 *   • upsertOverride                — create or update the active override for a
 *                                     specific (company, tech, date). A second
 *                                     upsert on the same date updates the existing
 *                                     row in place; no duplicate rows are created.
 *   • archiveOverride               — soft-delete via archived_at = NOW().
 *   • findOverrideForDate           — single-row lookup for one date.
 *   • findById                      — single-row lookup by id.
 */
import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "../db";
import {
  technicianScheduleOverrides,
  type TechnicianScheduleOverrideRow,
  type InsertTechnicianScheduleOverride,
} from "@shared/schema";

// ─── listOverridesForRange ───────────────────────────────────────────────────

/** Return all active overrides for one technician in [startDate, endDate]
 *  (both inclusive, YYYY-MM-DD strings). Sorted by override_date ASC. */
async function listOverridesForRange(
  companyId: string,
  technicianUserId: string,
  startDate: string,
  endDate: string,
): Promise<TechnicianScheduleOverrideRow[]> {
  return await db
    .select()
    .from(technicianScheduleOverrides)
    .where(
      and(
        eq(technicianScheduleOverrides.companyId, companyId),
        eq(technicianScheduleOverrides.technicianUserId, technicianUserId),
        isNull(technicianScheduleOverrides.archivedAt),
        gte(technicianScheduleOverrides.overrideDate, startDate),
        lte(technicianScheduleOverrides.overrideDate, endDate),
      ),
    )
    .orderBy(asc(technicianScheduleOverrides.overrideDate));
}

// ─── findOverrideForDate ─────────────────────────────────────────────────────

/** Single-row lookup for one calendar date. Returns null when no active
 *  override exists for the given (company, tech, date) combination. */
async function findOverrideForDate(
  companyId: string,
  technicianUserId: string,
  overrideDate: string,
): Promise<TechnicianScheduleOverrideRow | null> {
  const rows = await db
    .select()
    .from(technicianScheduleOverrides)
    .where(
      and(
        eq(technicianScheduleOverrides.companyId, companyId),
        eq(technicianScheduleOverrides.technicianUserId, technicianUserId),
        eq(technicianScheduleOverrides.overrideDate, overrideDate),
        isNull(technicianScheduleOverrides.archivedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Single-row lookup by id. Returns null when not found, soft-deleted,
 *  or cross-tenant. */
async function findById(
  companyId: string,
  id: string,
): Promise<TechnicianScheduleOverrideRow | null> {
  const rows = await db
    .select()
    .from(technicianScheduleOverrides)
    .where(
      and(
        eq(technicianScheduleOverrides.companyId, companyId),
        eq(technicianScheduleOverrides.id, id),
        isNull(technicianScheduleOverrides.archivedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

// ─── upsertOverride ──────────────────────────────────────────────────────────

/** Create or update the active override for (company, tech, date).
 *
 *  - If an active row already exists for the same date, its `is_working`
 *    and `note` are updated in place (no duplicate rows).
 *  - If no active row exists, a new row is inserted.
 *
 *  The partial unique index on the table guarantees at most one active
 *  row per (company_id, technician_user_id, override_date) at the DB
 *  level, providing a second safety net beyond this application-layer
 *  find-then-update/insert pattern. */
async function upsertOverride(
  companyId: string,
  input: {
    technicianUserId: string;
    overrideDate: string;
    isWorking: boolean;
    note: string | null | undefined;
    createdByUserId: string;
  },
): Promise<TechnicianScheduleOverrideRow> {
  return await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(technicianScheduleOverrides)
      .where(
        and(
          eq(technicianScheduleOverrides.companyId, companyId),
          eq(technicianScheduleOverrides.technicianUserId, input.technicianUserId),
          eq(technicianScheduleOverrides.overrideDate, input.overrideDate),
          isNull(technicianScheduleOverrides.archivedAt),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const rows = await tx
        .update(technicianScheduleOverrides)
        .set({
          isWorking: input.isWorking,
          note: input.note ?? null,
        })
        .where(eq(technicianScheduleOverrides.id, existing[0].id))
        .returning();
      return rows[0];
    }

    const insert: InsertTechnicianScheduleOverride = {
      companyId,
      technicianUserId: input.technicianUserId,
      overrideDate: input.overrideDate,
      isWorking: input.isWorking,
      note: input.note ?? null,
      createdByUserId: input.createdByUserId,
    };
    const rows = await tx
      .insert(technicianScheduleOverrides)
      .values(insert)
      .returning();
    if (rows.length === 0) {
      throw new Error("Failed to insert technician_schedule_overrides row");
    }
    return rows[0];
  });
}

// ─── archiveOverride ─────────────────────────────────────────────────────────

/** Soft-delete: sets `archived_at = NOW()`. The row is preserved for
 *  audit history; future reads filter `archived_at IS NULL`. Returns
 *  true when a row was found and archived, false when not found. */
async function archiveOverride(companyId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(technicianScheduleOverrides)
    .set({ archivedAt: sql`NOW()` })
    .where(
      and(
        eq(technicianScheduleOverrides.companyId, companyId),
        eq(technicianScheduleOverrides.id, id),
        isNull(technicianScheduleOverrides.archivedAt),
      ),
    )
    .returning({ id: technicianScheduleOverrides.id });
  return rows.length > 0;
}


export const technicianScheduleOverrideRepository = {
  listOverridesForRange,
  findOverrideForDate,
  findById,
  upsertOverride,
  archiveOverride,
};
