/**
 * Map Routes — Route-visualization surface for scheduled visits + GPS overlay.
 *
 * GET /api/map/day?date=YYYY-MM-DD — Visits + technician display roster + risk for a day.
 *
 * Phase 2 Map Convergence (2026-03-08):
 * The map is a VISUALIZATION surface, not a scheduling engine.
 *
 * Responsibilities RETAINED:
 *   - Scheduled visits for the selected day (route context)
 *   - Job fallback for data-integrity coverage (jobs without visit records)
 *   - Technician display roster for grouping/color/name context
 *   - Live GPS overlay (optional, degrades gracefully)
 *   - Risk flags from attention_items (visualization)
 *   - Tenant/company scoping (security)
 *   - Timezone-aware date boundary computation
 *
 * Responsibilities REMOVED (belong to dispatch):
 *   - Schedulable/eligibility filtering (was: is_schedulable = true AND disabled = false)
 *   - The map now shows a display roster: all active, non-deleted company users who
 *     are either schedulable OR have visits/GPS for the day. This prevents the map
 *     from hiding routes for technicians who were temporarily marked unschedulable
 *     but still have assigned work.
 *
 * How the technician roster differs from dispatch:
 *   - Dispatch uses GET /api/team/technicians (schedulable filter) for ASSIGNMENT authority
 *   - Map uses a display roster: active non-deleted users for grouping/naming/color
 *   - Map does NOT decide who is eligible for new assignments
 */

import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";
import { asyncHandler, createError } from "../middleware/errorHandler";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { requireFeature } from "../auth/requireFeature";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { companyRepository } from "../storage/company";
import { geocodeToLatLng } from "../utils/geocode";

const router = Router();

// Gate all map endpoints behind liveMapEnabled feature flag
router.use(requireFeature("liveMapEnabled"));

const dayQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// Active visit statuses shown on the map (route-relevant statuses only)
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

/**
 * GET /api/map/day?date=YYYY-MM-DD
 *
 * Returns technician display roster + scheduled visits + risk flags for a single day.
 * Falls back to jobs table for scheduled jobs without a corresponding visit record.
 *
 * The technician roster is a DISPLAY model — it includes all active, non-deleted
 * company users for grouping/color/labeling purposes. It does NOT filter by
 * is_schedulable because the map visualizes assigned routes, not assignment authority.
 */
router.get(
  "/day",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const parsed = dayQuerySchema.safeParse(req.query);
    if (!parsed.success) throw createError(400, "Invalid query params");

    const tz = await companyRepository.getCompanyTimezone(companyId);
    const dateStr = parsed.data.date || todayInTimezone(tz);
    const { start, end } = dayBoundsInTz(dateStr, tz);

    // Batch-fetch display roster + visits + job fallback + risk in parallel
    const [techRows, visitRows, jobFallbackRows, riskRows] = await Promise.all([
      // 1) Technician display roster — active, non-deleted company users
      //    LEFT JOIN live positions for optional GPS overlay.
      //    Phase 2: Removed is_schedulable filter. The map shows routes for anyone
      //    who has assigned work, not just dispatch-eligible technicians.
      //    disabled=false and deleted_at IS NULL are kept as basic data-integrity
      //    guards (disabled/deleted users should not appear in any UI).
      db.execute(sql`
        SELECT
          u.id AS "technicianId",
          COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.full_name, u.email) AS "name",
          lp.lat,
          lp.lng,
          COALESCE(lp.last_seen_at >= NOW() - INTERVAL '5 minutes', false) AS "online",
          lp.last_seen_at AS "lastSeenAt",
          u.is_schedulable AS "isSchedulable"
        FROM users u
        LEFT JOIN technician_live_positions lp ON lp.technician_id = u.id AND lp.company_id = u.company_id
        WHERE u.company_id = ${companyId}
          AND u.disabled = false
          AND u.deleted_at IS NULL
        ORDER BY u.full_name ASC
      `),

      // 2) Active visits for the day (timezone-aware boundaries)
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
          AND jv.status IN (${sql.join(ACTIVE_VISIT_STATUSES.map(s => sql`${s}`), sql`, `)})
        ORDER BY jv.scheduled_start ASC
      `),

      // 3) Job fallback: jobs scheduled today that have NO active visit in this window
      db.execute(sql`
        SELECT
          j.id AS "visitId",
          COALESCE(j.primary_technician_id, j.assigned_technician_ids[1]) AS "technicianId",
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

      // 4) Open risk attention items for visits today (visualization only)
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

    // Phase 2: Build display roster from all active users.
    // Strip isSchedulable before sending — it's internal context, not map display data.
    const allTechsRaw = techRows.rows as any[];
    const allTechs = allTechsRaw.map((t) => ({
      technicianId: t.technicianId,
      name: t.name,
      lat: t.lat ?? null,
      lng: t.lng ?? null,
      online: t.online,
      lastSeenAt: t.lastSeenAt,
    }));

    const jobFallbackCount = (jobFallbackRows.rows as any[]).length;
    const visitsWithCoords = visits.filter((v) => v.lat && v.lng).length;
    const visitsMissingScheduledStart = visits.filter((v) => !v.scheduledStart).length;
    const visitsAssigned = visits.filter((v) => v.technicianId).length;
    const visitsUnassigned = visits.filter((v) => !v.technicianId).length;
    const techniciansOnline = allTechs.filter((t) => t.online).length;

    // Dev debug logging
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

    // Build _meta diagnostic hints for empty states
    const _meta: Record<string, any> = {};
    if (allTechs.length === 0) {
      _meta.reasonTechsEmpty = "No active, non-deleted users found for this company.";
    }
    if (visits.length === 0) {
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

/**
 * POST /api/map/geocode-backfill
 *
 * One-time backfill: geocodes all client_locations that have an address but
 * no stored lat/lng. Runs sequentially with a small delay to respect ORS
 * rate limits (~40 req/min on free tier).
 */
router.post(
  "/geocode-backfill",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;

    // Find locations with address but no coordinates
    const missing = await db.execute(sql`
      SELECT id, address, city, province, postal_code AS "postalCode"
      FROM client_locations
      WHERE company_id = ${companyId}
        AND (lat IS NULL OR lng IS NULL)
        AND (address IS NOT NULL AND address != '')
    `);

    const rows = missing.rows as { id: string; address: string; city: string | null; postalCode: string | null; province: string | null }[];
    let updated = 0;
    let failed = 0;
    const results: { id: string; address: string; lat: string | null; lng: string | null; error?: string }[] = [];

    for (const row of rows) {
      try {
        const coords = await geocodeToLatLng(row.address, row.city, row.province, row.postalCode);
        if (coords) {
          await db.execute(sql`
            UPDATE client_locations SET lat = ${coords.lat}, lng = ${coords.lng}
            WHERE id = ${row.id} AND company_id = ${companyId}
          `);
          updated++;
          results.push({ id: row.id, address: row.address, lat: coords.lat, lng: coords.lng });
        } else {
          failed++;
          results.push({ id: row.id, address: row.address, lat: null, lng: null, error: "geocode returned null" });
        }
      } catch (err: any) {
        failed++;
        results.push({ id: row.id, address: row.address, lat: null, lng: null, error: err.message });
      }
      // Rate-limit pause: ~1.5s between calls (ORS free tier: 40 req/min)
      if (rows.indexOf(row) < rows.length - 1) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    res.json({
      total: rows.length,
      updated,
      failed,
      results,
    });
  }),
);

export default router;
