/**
 * Technician Schedule Overrides — storage layer (2026-05-17 Phase 2-3).
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
 *
 * Also exports:
 *   • computeEffectiveDayState      — single-day precedence utility (used in tests).
 *   • computeEffectiveScheduleRange — batched range version for the Phase 3 API.
 *                                     Pre-fetches all time-off and overrides in 2
 *                                     queries, then applies precedence per-day in
 *                                     memory — no N+1 DB calls.
 */
import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "../db";
import {
  technicianScheduleOverrides,
  workingHours,
  type TechnicianScheduleOverrideRow,
  type InsertTechnicianScheduleOverride,
  type TechnicianTimeOffRow,
} from "@shared/schema";
import { technicianTimeOffRepository } from "./technicianTimeOff";
import {
  addCalendarDay,
  datesInRange,
  buildDayBoundsMap,
  getRangeUTCBounds,
} from "../lib/dayBoundaries";

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

// ─── computeEffectiveDayState ────────────────────────────────────────────────

export interface EffectiveDayState {
  /** The calendar date this state describes, YYYY-MM-DD. */
  date: string;
  /** Whether the technician is effectively working on this date. */
  isWorking: boolean;
  /**
   * Which layer determined the outcome:
   *   "time_off"        — a non-archived technician_time_off row overlaps this day.
   *   "date_override"   — a technician_schedule_overrides row exists for this date.
   *   "weekly_default"  — the technician's own working_hours row for this DOW.
   *   "company_default" — fallback when useCustomSchedule=false and no custom hours.
   */
  source: "time_off" | "date_override" | "weekly_default" | "company_default";
  /** Set when source = "time_off". The blocking time-off entry. */
  timeOffEntry?: TechnicianTimeOffRow;
  /** Set when source = "date_override". The matching override row. */
  override?: TechnicianScheduleOverrideRow;
}

/**
 * Compute the effective working state for a single calendar date.
 *
 * INTERNAL ONLY — not exposed as a public route in Phase 2. The Phase 3
 * calendar grid endpoint will call this per-day for a date range.
 *
 * Caller is responsible for converting `date` (YYYY-MM-DD) to the UTC
 * day boundaries `dayStartUTC` / `dayEndUTC` using the company's IANA
 * timezone — consistent with how `capacity.ts` computes its own bounds.
 *
 * Precedence (highest → lowest):
 *   1. Any non-archived time-off row overlapping [dayStartUTC, dayEndUTC]
 *      → isWorking = false, source = "time_off".
 *   2. Active date override row for `date`
 *      → isWorking = override.isWorking, source = "date_override".
 *   3. Technician's working_hours row for the day-of-week
 *      → isWorking = row.isWorking, source = "weekly_default".
 *   4. Company default (caller-supplied) or "not working" if absent
 *      → source = "company_default".
 */
export async function computeEffectiveDayState(
  companyId: string,
  technicianUserId: string,
  date: string,
  dayStartUTC: Date,
  dayEndUTC: Date,
  opts: {
    weeklyHours: { dayOfWeek: number; isWorking: boolean }[];
    useCustomSchedule?: boolean;
    companyDefaultHours?: { dayOfWeek: number; isOpen: boolean }[];
  },
): Promise<EffectiveDayState> {
  // Layer 1 — time off
  const timeOffEntries = await technicianTimeOffRepository.listOverlapping(companyId, {
    technicianUserId,
    windowStart: dayStartUTC,
    windowEnd: dayEndUTC,
  });
  if (timeOffEntries.length > 0) {
    return {
      date,
      isWorking: false,
      source: "time_off",
      timeOffEntry: timeOffEntries[0],
    };
  }

  // Layer 2 — date override
  const override = await findOverrideForDate(companyId, technicianUserId, date);
  if (override) {
    return {
      date,
      isWorking: override.isWorking,
      source: "date_override",
      override,
    };
  }

  // Layer 3 — weekly default (custom schedule)
  const dow = new Date(date + "T00:00:00Z").getUTCDay(); // 0=Sun, 6=Sat
  if (opts.useCustomSchedule !== false) {
    const hoursRow = opts.weeklyHours.find((h) => h.dayOfWeek === dow);
    if (hoursRow !== undefined) {
      return {
        date,
        isWorking: hoursRow.isWorking,
        source: "weekly_default",
      };
    }
  }

  // Layer 4 — company default fallback
  const companyRow = opts.companyDefaultHours?.find((h) => h.dayOfWeek === dow);
  return {
    date,
    isWorking: companyRow?.isOpen ?? false,
    source: "company_default",
  };
}

// ─── computeEffectiveScheduleRange ──────────────────────────────────────────

/**
 * Compute effective working state for every calendar date in [startYmd, endYmd].
 *
 * Batch version of computeEffectiveDayState — pre-fetches all time-off and
 * overrides for the full range in exactly 2 DB queries, then applies the
 * 4-layer precedence in memory. Avoids the N+1 pattern of calling
 * computeEffectiveDayState once per day.
 *
 * Caller must supply pre-fetched weeklyHours and companyDefaultHours so this
 * function does not make additional DB calls for schedule data.
 */
export async function computeEffectiveScheduleRange(
  companyId: string,
  technicianUserId: string,
  startYmd: string,
  endYmd: string,
  timezone: string,
  opts: {
    weeklyHours: { dayOfWeek: number; isWorking: boolean }[];
    useCustomSchedule?: boolean;
    companyDefaultHours?: { dayOfWeek: number; isOpen: boolean }[];
  },
): Promise<EffectiveDayState[]> {
  const { rangeStart, rangeEnd } = getRangeUTCBounds(startYmd, endYmd, timezone);

  // 2 queries for the entire range
  const [allTimeOff, allOverrides] = await Promise.all([
    technicianTimeOffRepository.listOverlapping(companyId, {
      technicianUserId,
      windowStart: rangeStart,
      windowEnd: rangeEnd,
    }),
    listOverridesForRange(companyId, technicianUserId, startYmd, endYmd),
  ]);

  const overrideByDate = new Map<string, TechnicianScheduleOverrideRow>();
  for (const o of allOverrides) {
    overrideByDate.set(o.overrideDate, o);
  }

  const dayBounds = buildDayBoundsMap(startYmd, endYmd, timezone);
  const results: EffectiveDayState[] = [];

  for (const date of datesInRange(startYmd, endYmd)) {
    const { start: dayStartUTC, end: dayEndUTC } = dayBounds.get(date)!;

    // Layer 1: time off (in-memory overlap: a.start < b.end AND a.end > b.start)
    const timeOffEntry = allTimeOff.find(
      (t) => t.startsAt < dayEndUTC && t.endsAt > dayStartUTC,
    );
    if (timeOffEntry) {
      results.push({ date, isWorking: false, source: "time_off", timeOffEntry });
      continue;
    }

    // Layer 2: date override
    const override = overrideByDate.get(date);
    if (override) {
      results.push({ date, isWorking: override.isWorking, source: "date_override", override });
      continue;
    }

    // Layer 3: weekly default
    const dow = new Date(date + "T00:00:00Z").getUTCDay();
    if (opts.useCustomSchedule !== false) {
      const hoursRow = opts.weeklyHours.find((h) => h.dayOfWeek === dow);
      if (hoursRow !== undefined) {
        results.push({ date, isWorking: hoursRow.isWorking, source: "weekly_default" });
        continue;
      }
    }

    // Layer 4: company default
    const companyRow = opts.companyDefaultHours?.find((h) => h.dayOfWeek === dow);
    results.push({ date, isWorking: companyRow?.isOpen ?? false, source: "company_default" });
  }

  return results;
}

export const technicianScheduleOverrideRepository = {
  listOverridesForRange,
  findOverrideForDate,
  findById,
  upsertOverride,
  archiveOverride,
};
