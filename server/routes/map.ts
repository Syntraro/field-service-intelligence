/**
 * Map Routes — Aggregated dispatch map data.
 *
 * GET /api/map/day?date=YYYY-MM-DD — Technicians + visits + risk for a day.
 * Date boundaries computed in company timezone (America/Toronto default).
 */

import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { asyncHandler, createError } from "../middleware/errorHandler";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { companySettings } from "@shared/schema";

const router = Router();

const dayQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// Active visit statuses shown on the map
const ACTIVE_VISIT_STATUSES = [
  "scheduled", "dispatched", "en_route", "on_site", "in_progress", "on_hold",
];

/** Get today as YYYY-MM-DD in the given timezone. */
function todayInTimezone(tz: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz }); // en-CA → YYYY-MM-DD
}

/** Compute UTC start/end for a calendar day in the given timezone. */
function dayBoundsInTz(dateStr: string, tz: string) {
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const localStr = probe.toLocaleString("en-US", { timeZone: tz });
  const localTime = new Date(localStr);
  const offsetMs = probe.getTime() - localTime.getTime();
  const start = new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + offsetMs);
  const end = new Date(start.getTime() + 86_400_000); // exclusive upper bound
  return { start, end };
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

/**
 * GET /api/map/day?date=YYYY-MM-DD
 * Returns technician positions + scheduled visits + risk flags for a single day.
 * Falls back to jobs table for scheduled jobs without a corresponding visit.
 */
router.get(
  "/day",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const parsed = dayQuerySchema.safeParse(req.query);
    if (!parsed.success) throw createError(400, "Invalid query params");

    // Compute date in company timezone
    const tz = await getTenantTimezone(companyId);
    const dateStr = parsed.data.date || todayInTimezone(tz);
    const { start, end } = dayBoundsInTz(dateStr, tz);

    // Batch-fetch technicians + visits + job fallback + risk in parallel
    const [techRows, visitRows, jobFallbackRows, riskRows] = await Promise.all([
      // 1) All schedulable technicians, LEFT JOIN live positions for online status
      db.execute(sql`
        SELECT
          u.id AS "technicianId",
          COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.full_name, u.email) AS "name",
          lp.lat,
          lp.lng,
          COALESCE(lp.last_seen_at >= NOW() - INTERVAL '5 minutes', false) AS "online",
          lp.last_seen_at AS "lastSeenAt"
        FROM users u
        LEFT JOIN technician_live_positions lp ON lp.technician_id = u.id AND lp.company_id = u.company_id
        WHERE u.company_id = ${companyId}
          AND u.disabled = false
          AND u.is_schedulable = true
          AND u.deleted_at IS NULL
        ORDER BY u.full_name ASC
      `),

      // 2) Active visits for the day (timezone-aware boundaries, includes visits with missing coords)
      db.execute(sql`
        SELECT
          jv.id AS "visitId",
          COALESCE(jv.assigned_technician_id, jv.assigned_technician_ids[1]) AS "technicianId",
          cl.company_name AS "locationName",
          jv.scheduled_start AS "scheduledStart",
          jv.scheduled_end AS "scheduledEnd",
          COALESCE(jv.estimated_duration_minutes, 60) AS "durationMinutes",
          cl.lat,
          cl.lng,
          jv.status,
          'visit' AS "source"
        FROM job_visits jv
        JOIN jobs j ON j.id = jv.job_id AND j.company_id = ${companyId}
        LEFT JOIN client_locations cl ON cl.id = j.location_id
        WHERE jv.company_id = ${companyId}
          AND jv.is_active = true
          AND jv.archived_at IS NULL
          AND jv.scheduled_start >= ${start.toISOString()}::timestamptz
          AND jv.scheduled_start < ${end.toISOString()}::timestamptz
          AND jv.status = ANY(${ACTIVE_VISIT_STATUSES})
        ORDER BY jv.scheduled_start ASC
      `),

      // 3) Job fallback: jobs scheduled today that have NO active visit in this window
      db.execute(sql`
        SELECT
          j.id AS "visitId",
          j.assigned_technician_user_id AS "technicianId",
          cl.company_name AS "locationName",
          j.scheduled_start AS "scheduledStart",
          j.scheduled_end AS "scheduledEnd",
          60 AS "durationMinutes",
          cl.lat,
          cl.lng,
          j.status,
          'job_fallback' AS "source"
        FROM jobs j
        LEFT JOIN client_locations cl ON cl.id = j.location_id
        WHERE j.company_id = ${companyId}
          AND j.scheduled_start >= ${start.toISOString()}::timestamptz
          AND j.scheduled_start < ${end.toISOString()}::timestamptz
          AND j.status NOT IN ('cancelled', 'voided')
          AND NOT EXISTS (
            SELECT 1 FROM job_visits jv
            WHERE jv.job_id = j.id
              AND jv.company_id = ${companyId}
              AND jv.is_active = true
          AND jv.archived_at IS NULL
              AND jv.scheduled_start >= ${start.toISOString()}::timestamptz
              AND jv.scheduled_start < ${end.toISOString()}::timestamptz
          )
        ORDER BY j.scheduled_start ASC
      `),

      // 4) Open risk attention items for visits today
      db.execute(sql`
        SELECT
          ai.entity_id AS "entityId",
          ai.rule_type AS "ruleType"
        FROM attention_items ai
        WHERE ai.tenant_id = ${companyId}
          AND ai.status = 'open'
          AND ai.entity_type = 'visit'
          AND ai.rule_type IN ('visit.late', 'visit.overdue', 'visit.running_long')
      `),
    ]);

    // Build risk lookup: visitId → { late, overdue, runningLong }
    const riskMap = new Map<string, { late?: boolean; overdue?: boolean; runningLong?: boolean }>();
    for (const r of riskRows.rows as any[]) {
      const existing = riskMap.get(r.entityId) || {};
      if (r.ruleType === "visit.late") existing.late = true;
      if (r.ruleType === "visit.overdue") existing.overdue = true;
      if (r.ruleType === "visit.running_long") existing.runningLong = true;
      riskMap.set(r.entityId, existing);
    }

    // Build visits with risk flags (real visits + job fallbacks)
    const allRows = [...(visitRows.rows as any[]), ...(jobFallbackRows.rows as any[])];
    const visits = allRows.map((v) => {
      const durationMinutes = Number(v.durationMinutes) || 60;
      // Compute scheduledEnd if missing: scheduledStart + durationMinutes
      let scheduledEnd = v.scheduledEnd;
      if (!scheduledEnd && v.scheduledStart) {
        scheduledEnd = new Date(new Date(v.scheduledStart).getTime() + durationMinutes * 60_000).toISOString();
      }
      return {
        visitId: v.visitId,
        technicianId: v.technicianId || null,
        locationName: v.locationName || "Unknown",
        scheduledStart: v.scheduledStart,
        scheduledEnd,
        durationMinutes,
        lat: v.lat ?? null,
        lng: v.lng ?? null,
        status: v.status,
        source: v.source || "visit",
        risk: riskMap.get(v.visitId) || {},
      };
    });

    const allTechs = techRows.rows as any[];
    const jobFallbackCount = (jobFallbackRows.rows as any[]).length;
    const visitsWithCoords = visits.filter((v) => v.lat && v.lng).length;
    const visitsMissingScheduledStart = visits.filter((v) => !v.scheduledStart).length;
    const visitsAssigned = visits.filter((v) => v.technicianId).length;
    const visitsUnassigned = visits.filter((v) => !v.technicianId).length;
    const techniciansOnline = allTechs.filter((t) => t.online).length;

    // Dev debug logging — visits are independent of tech online status
    if (process.env.NODE_ENV !== "production") {
      const sample = visits.slice(0, 5).map((v) => ({
        id: v.visitId, start: v.scheduledStart, technicianId: v.technicianId, status: v.status, src: v.source,
      }));
      console.log(
        `[MAP /day] company=${companyId} date=${dateStr} tz=${tz}`,
        `bounds=[${start.toISOString()} .. ${end.toISOString()})`,
        `techs=${allTechs.length} (online=${techniciansOnline})`,
        `visitsTotal=${visits.length} assigned=${visitsAssigned} unassigned=${visitsUnassigned}`,
        `withCoords=${visitsWithCoords} missingCoords=${visits.length - visitsWithCoords}`,
        `missingScheduledStart=${visitsMissingScheduledStart}`,
        `jobFallback=${jobFallbackCount}`,
        `sample=`, sample,
      );

      // Diagnostic when 0 visits: count all active job_visits for company
      if (visits.length === 0) {
        const diagResult = await db.execute(sql`
          SELECT COUNT(*)::int AS "total" FROM job_visits WHERE company_id = ${companyId} AND is_active = true AND archived_at IS NULL
        `);
        const totalVisits = (diagResult.rows as any[])[0]?.total || 0;
        console.warn(
          `[MAP /day] WARNING: 0 visits for date=${dateStr}.`,
          `Total active job_visits in company: ${totalVisits}.`,
          `Check if scheduled_start is being written by the calendar scheduling flow.`,
        );
      }
    }

    // Build _meta diagnostic hints for empty states (2026-03-05)
    const _meta: Record<string, any> = {};
    if (allTechs.length === 0) {
      _meta.reasonTechsEmpty = "No active users with is_schedulable=true (check users.is_schedulable/disabled/deleted_at).";
    }
    if (visits.length === 0) {
      // Count visits with scheduled_date but no scheduled_start (common backfill gap)
      const gapResult = await db.execute(sql`
        SELECT COUNT(*)::int AS "count"
        FROM job_visits
        WHERE company_id = ${companyId}
          AND is_active = true
          AND archived_at IS NULL
          AND scheduled_start IS NULL
          AND scheduled_date IS NOT NULL
      `);
      const gapCount = (gapResult.rows as any[])[0]?.count || 0;
      _meta.visitsWithScheduledDateButNoStart = gapCount;
      if (gapCount > 0) {
        _meta.reasonVisitsEmpty = `Found ${gapCount} visit(s) with scheduled_date set but scheduled_start NULL (needs backfill or write-path bug).`;
      }
    }

    res.json({
      date: dateStr,
      timezone: tz,
      technicians: allTechs,
      visits,
      meta: {
        techniciansTotal: allTechs.length,
        techniciansOnline,
        jobFallbackCount,
        visitsTotal: visits.length,
        visitsAssigned,
        visitsUnassigned,
        visitsWithCoords,
        visitsMissingCoords: visits.length - visitsWithCoords,
        visitsMissingScheduledStart,
        ..._meta,
      },
    });
  }),
);

export default router;
