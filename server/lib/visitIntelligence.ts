/**
 * Visit Intelligence — Computes operational signals from visit schedules,
 * technician live positions, and assignment data.
 *
 * Phase 5 (2026-03-05): Generates attention items for dispatchers.
 * Phase 5B (2026-03-05): visit.running_long with downstream impact preview.
 *
 * Signal types:
 *   visit.late         — scheduled_start + 15m passed, not started
 *   visit.overdue      — scheduled_end passed, visit not completed
 *   visit.running_long — active visit past plannedEnd (+15m warn, +45m high)
 *   tech.offline       — last_seen_at older than 5 minutes
 *   tech.idle          — speed=0 and last_seen_at unchanged >10 min
 *   tech.arrived       — distance < 50m from visit location (emits event, not attention)
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import type { AttentionSeverity } from "@shared/schema";
import { getEffectiveEnd } from "@shared/schema";
import { logEventAsync } from "./events";
import { JOB_ACTIVE_SQL_J } from "../storage/jobFilters";
// 2026-03-18: Import canonical constant for terminal visit statuses.
// The raw SQL query below is a composition of scheduleEligibleVisitFilter
// (from visitPredicates.ts) with intelligence-specific date bounds.
import { TERMINAL_VISIT_STATUSES, VISIT_TERMINAL_STATUS_SQL } from "./visitPredicates";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IntelSignal {
  visitId: string | null;
  technicianId: string;
  type: string;
  message: string;
  severity: "high" | "medium" | "low";
}

export interface DownstreamImpact {
  visitId: string;
  locationName: string | null;
  jobNumber: string | null;
  plannedStart: string;
  predictedStart: string;
  lateByMinutes: number;
}

export interface RunningLongMeta {
  jobNumber: string | null;
  locationName: string | null;
  technicianId: string | null;
  plannedStart: string;
  plannedEnd: string;
  elapsedMinutes: number;
  driftMinutes: number;
  countLateVisits: number;
  downstream: DownstreamImpact[];
}

interface ScheduledVisitRow {
  visitId: string;
  jobId: string;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  estimatedDurationMinutes: number | null;
  status: string;
  checkedInAt: Date | null;
  technicianIds: string[] | null;
  locationLat: string | null;
  locationLng: string | null;
  locationName: string | null;
  jobNumber: string | null;
}

interface TechPositionRow {
  technicianId: string;
  techName: string;
  lat: string;
  lng: string;
  speed: string | null;
  lastSeenAt: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { haversineMeters, estimateTravelMinutes } from "./distance";
// Phase 5: Use canonical attention upsert from attentionRules.ts.
// Previously this file owned a duplicate INSERT ON CONFLICT implementation.
import { upsertAttentionItem } from "./attentionRules";

// ---------------------------------------------------------------------------
// Data fetchers
// ---------------------------------------------------------------------------

/**
 * Fetch today's active visits with assignments and location coordinates.
 *
 * 2026-03-18: Base predicate matches scheduleEligibleVisitFilter from
 * visitPredicates.ts (isActive, !archived, scheduledStart NOT NULL, non-terminal),
 * composed with intelligence-specific date bounds (today only).
 */
async function fetchScheduledVisits(tenantId: string): Promise<ScheduledVisitRow[]> {
  // Use canonical raw SQL terminal status set from visitPredicates.ts

  const { rows } = await db.execute(sql`
    SELECT
      jv.id            AS "visitId",
      jv.job_id        AS "jobId",
      jv.scheduled_start AS "scheduledStart",
      jv.scheduled_end   AS "scheduledEnd",
      jv.estimated_duration_minutes AS "estimatedDurationMinutes",
      jv.status,
      jv.checked_in_at AS "checkedInAt",
      jv.assigned_technician_ids AS "technicianIds",
      cl.lat           AS "locationLat",
      cl.lng           AS "locationLng",
      COALESCE(cc.name, NULLIF(cl.company_name, '')) AS "locationName",
      j.job_number     AS "jobNumber"
    FROM job_visits jv
    JOIN jobs j ON j.id = jv.job_id AND j.company_id = ${tenantId}
      AND ${sql.raw(JOB_ACTIVE_SQL_J)}
    LEFT JOIN client_locations cl ON cl.id = j.location_id
    LEFT JOIN customer_companies cc ON cl.parent_company_id = cc.id
    WHERE jv.company_id = ${tenantId}
      AND jv.is_active = true
      AND jv.archived_at IS NULL
      AND jv.scheduled_start IS NOT NULL
      AND jv.scheduled_start >= CURRENT_DATE
      AND jv.scheduled_start < CURRENT_DATE + INTERVAL '1 day'
      AND jv.status NOT IN (${sql.raw(VISIT_TERMINAL_STATUS_SQL)})
  `);
  return rows as unknown as ScheduledVisitRow[];
}

/** Fetch all live technician positions for this tenant. */
async function fetchTechPositions(tenantId: string): Promise<TechPositionRow[]> {
  const { rows } = await db.execute(sql`
    SELECT
      lp.technician_id AS "technicianId",
      u.full_name      AS "techName",
      lp.lat,
      lp.lng,
      lp.speed,
      lp.last_seen_at  AS "lastSeenAt"
    FROM technician_live_positions lp
    JOIN users u ON u.id = lp.technician_id
    WHERE lp.company_id = ${tenantId}
  `);
  return rows as unknown as TechPositionRow[];
}

// ---------------------------------------------------------------------------
// Downstream impact computation (Phase 5B)
// ---------------------------------------------------------------------------

/**
 * Compute downstream impact for a running-long visit.
 * Returns ETA drift for all subsequent visits for the same tech on the same day.
 */
function computeDownstreamImpact(
  runningVisit: ScheduledVisitRow,
  allVisits: ScheduledVisitRow[],
  driftMinutes: number,
): DownstreamImpact[] {
  const techIds = runningVisit.technicianIds?.length ? runningVisit.technicianIds : [];
  if (techIds.length === 0) return [];

  // Get all visits for same tech(s), after the running visit, same day
  const runningStart = new Date(runningVisit.scheduledStart!).getTime();
  const sameDay = allVisits
    .filter((v) => {
      if (v.visitId === runningVisit.visitId) return false;
      if (!v.scheduledStart) return false;
      const vTechIds = v.technicianIds?.length ? v.technicianIds : [];
      return techIds.some((t) => vTechIds.includes(t));
    })
    .filter((v) => new Date(v.scheduledStart!).getTime() > runningStart)
    .sort((a, b) => new Date(a.scheduledStart!).getTime() - new Date(b.scheduledStart!).getTime());

  if (sameDay.length === 0) return [];

  const impacts: DownstreamImpact[] = [];
  // The running visit's new predicted end
  const runningEnd = runningVisit.scheduledEnd
    ? new Date(runningVisit.scheduledEnd)
    : new Date(new Date(runningVisit.scheduledStart!).getTime() + (runningVisit.estimatedDurationMinutes ?? 60) * 60_000);
  let previousPredictedEnd = new Date(runningEnd.getTime() + driftMinutes * 60_000);

  for (const v of sameDay) {
    const plannedStart = new Date(v.scheduledStart!);

    // Estimate travel from previous stop
    let travelMin = 10; // default
    if (previousPredictedEnd) {
      // Use previous visit's location if available
      const prevVisit = impacts.length > 0
        ? sameDay[impacts.length - 1]
        : runningVisit;
      if (
        prevVisit.locationLat && prevVisit.locationLng &&
        v.locationLat && v.locationLng
      ) {
        travelMin = estimateTravelMinutes(
          parseFloat(prevVisit.locationLat), parseFloat(prevVisit.locationLng),
          parseFloat(v.locationLat), parseFloat(v.locationLng),
        );
      }
    }

    const earliestStart = new Date(previousPredictedEnd.getTime() + travelMin * 60_000);
    const predictedStart = earliestStart > plannedStart ? earliestStart : plannedStart;
    const lateBy = Math.round((predictedStart.getTime() - plannedStart.getTime()) / 60_000);

    if (lateBy > 0) {
      impacts.push({
        visitId: v.visitId,
        locationName: v.locationName,
        jobNumber: v.jobNumber,
        plannedStart: plannedStart.toISOString(),
        predictedStart: predictedStart.toISOString(),
        lateByMinutes: lateBy,
      });
    }

    // This visit's predicted end = predictedStart + duration
    const durMin = v.estimatedDurationMinutes ?? 60;
    previousPredictedEnd = new Date(predictedStart.getTime() + durMin * 60_000);
  }

  return impacts;
}

// ---------------------------------------------------------------------------
// Signal computation
// ---------------------------------------------------------------------------

/**
 * Compute all visit intelligence signals for a tenant.
 * Returns signals and writes attention items + events as side effects.
 */
export async function computeVisitStatusSignals(
  tenantId: string,
  userId: string,
): Promise<IntelSignal[]> {
  const now = new Date();
  const signals: IntelSignal[] = [];

  const [visits, techPositions] = await Promise.all([
    fetchScheduledVisits(tenantId),
    fetchTechPositions(tenantId),
  ]);

  // Build lookup: techId → position
  const techPosMap = new Map<string, TechPositionRow>();
  for (const tp of techPositions) {
    techPosMap.set(tp.technicianId, tp);
  }

  // Build lookup: techId → assigned visitIds (to know who should be working)
  const techVisitMap = new Map<string, ScheduledVisitRow[]>();
  for (const v of visits) {
    const techIds = v.technicianIds?.length ? v.technicianIds : [];
    for (const tid of techIds) {
      if (!techVisitMap.has(tid)) techVisitMap.set(tid, []);
      techVisitMap.get(tid)!.push(v);
    }
  }

  const ctx = { db, tenantId, userId, role: "system" as const };

  // --- Visit-level signals ---
  for (const v of visits) {
    if (!v.scheduledStart) continue;
    const start = new Date(v.scheduledStart);
    // 2026-03-18: Uses canonical getEffectiveEnd() from shared/schema.ts.
    // Previously inline computation was missing the scheduledStart-only fallback.
    const effectiveEnd = getEffectiveEnd(v) ?? start;

    // visit.late: scheduledStart + 15min has passed and visit not started
    const lateThreshold = new Date(start.getTime() + 15 * 60_000);
    if (
      now > lateThreshold &&
      ["scheduled", "dispatched"].includes(v.status)
    ) {
      const msg = `Visit for ${v.locationName || "unknown"} (Job #${v.jobNumber}) is late — not started 15+ min past scheduled time`;
      signals.push({
        visitId: v.visitId,
        technicianId: v.technicianIds?.[0] || "",
        type: "visit.late",
        message: msg,
        severity: "high",
      });
      await upsertAttentionItem(tenantId, "visit.late", "high", {
        entityType: "visit",
        entityId: v.visitId,
        meta: { jobNumber: v.jobNumber, locationName: v.locationName, scheduledStart: start.toISOString() },
      });
    }

    // visit.overdue: effectiveEnd passed and visit not completed
    // (only for not-started visits; started visits get running_long instead)
    if (
      now > effectiveEnd &&
      ["scheduled", "dispatched"].includes(v.status)
    ) {
      const msg = `Visit for ${v.locationName || "unknown"} (Job #${v.jobNumber}) is overdue — past scheduled end`;
      signals.push({
        visitId: v.visitId,
        technicianId: v.technicianIds?.[0] || "",
        type: "visit.overdue",
        message: msg,
        severity: "high",
      });
      await upsertAttentionItem(tenantId, "visit.overdue", "high", {
        entityType: "visit",
        entityId: v.visitId,
        meta: { jobNumber: v.jobNumber, locationName: v.locationName, scheduledEnd: effectiveEnd.toISOString() },
      });
    }

    // visit.running_long: active visit past plannedEnd (Phase 5B)
    const isActive = ["en_route", "on_site", "in_progress", "on_hold"].includes(v.status);
    if (isActive && now > effectiveEnd) {
      const driftMinutes = Math.round((now.getTime() - effectiveEnd.getTime()) / 60_000);
      const actualStart = v.checkedInAt ? new Date(v.checkedInAt) : start;
      const elapsedMinutes = Math.round((now.getTime() - actualStart.getTime()) / 60_000);

      // Severity: +15m = medium, +45m = high
      let severity: AttentionSeverity = "medium";
      if (driftMinutes >= 45) severity = "high";

      // Only signal if past the 15m warn threshold
      if (driftMinutes >= 15) {
        // Compute downstream impact
        const downstream = computeDownstreamImpact(v, visits, driftMinutes);
        const meta: RunningLongMeta = {
          jobNumber: v.jobNumber,
          locationName: v.locationName,
          technicianId: v.technicianIds?.[0] ?? null,
          plannedStart: start.toISOString(),
          plannedEnd: effectiveEnd.toISOString(),
          elapsedMinutes,
          driftMinutes,
          countLateVisits: downstream.length,
          downstream,
        };

        const msg = `Visit at ${v.locationName || "unknown"} (Job #${v.jobNumber}) running ${driftMinutes}m over — ${downstream.length} downstream visit(s) affected`;
        signals.push({
          visitId: v.visitId,
          technicianId: v.technicianIds?.[0] || "",
          type: "visit.running_long",
          message: msg,
          severity,
        });
        await upsertAttentionItem(tenantId, "visit.running_long", severity, {
          entityType: "visit",
          entityId: v.visitId,
          meta: meta as unknown as Record<string, unknown>,
        });
      }
    }

    // tech.arrived: tech position within 50m of visit location
    if (v.locationLat && v.locationLng) {
      const locLat = parseFloat(v.locationLat);
      const locLng = parseFloat(v.locationLng);
      if (!isNaN(locLat) && !isNaN(locLng)) {
        const techIds = v.technicianIds?.length ? v.technicianIds : [];

        for (const tid of techIds) {
          const tp = techPosMap.get(tid);
          if (!tp) continue;
          const tLat = parseFloat(tp.lat);
          const tLng = parseFloat(tp.lng);
          if (isNaN(tLat) || isNaN(tLng)) continue;

          const dist = haversineMeters(tLat, tLng, locLat, locLng);
          if (dist < 50 && ["scheduled", "dispatched", "en_route"].includes(v.status)) {
            signals.push({
              visitId: v.visitId,
              technicianId: tid,
              type: "tech.arrived",
              message: `${tp.techName} arrived at ${v.locationName || "site"} (${Math.round(dist)}m)`,
              severity: "low",
            });
            logEventAsync(ctx, {
              eventType: "tech.arrived",
              entityType: "visit",
              entityId: v.visitId,
              summary: `${tp.techName} arrived at ${v.locationName || "site"}`,
              meta: { technicianId: tid, visitId: v.visitId, distance: Math.round(dist) },
            });
          }
        }
      }
    }
  }

  // --- Technician-level signals ---
  for (const tp of techPositions) {
    const lastSeen = new Date(tp.lastSeenAt);
    const ageMs = now.getTime() - lastSeen.getTime();
    const ageMin = ageMs / 60_000;

    // tech.offline: last_seen_at > 5 minutes ago
    if (ageMin > 5) {
      signals.push({
        visitId: null,
        technicianId: tp.technicianId,
        type: "tech.offline",
        message: `${tp.techName} is offline — last seen ${Math.round(ageMin)}m ago`,
        severity: "medium",
      });
      if (techVisitMap.has(tp.technicianId)) {
        await upsertAttentionItem(tenantId, "tech.offline", "medium", {
          entityType: "technician",
          entityId: tp.technicianId,
          meta: { techName: tp.techName, lastSeenAt: lastSeen.toISOString(), minutesAgo: Math.round(ageMin) },
        });
      }
    }

    // tech.idle: speed=0 and last_seen_at unchanged >10 minutes
    const speed = tp.speed ? parseFloat(tp.speed) : 0;
    if (speed === 0 && ageMin > 10 && ageMin <= 5 * 60) {
      signals.push({
        visitId: null,
        technicianId: tp.technicianId,
        type: "tech.idle",
        message: `${tp.techName} has been idle for ${Math.round(ageMin)}m`,
        severity: "low",
      });
      if (techVisitMap.has(tp.technicianId)) {
        await upsertAttentionItem(tenantId, "tech.idle", "low", {
          entityType: "technician",
          entityId: tp.technicianId,
          meta: { techName: tp.techName, idleMinutes: Math.round(ageMin) },
        });
      }
    }
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Remainder actions (Phase 5B)
// ---------------------------------------------------------------------------

/** Fetch remaining visits for a tech on the same day, after the given visit. */
export async function fetchRemainderVisits(
  tenantId: string,
  visitId: string,
): Promise<{
  sourceVisit: ScheduledVisitRow;
  remainder: ScheduledVisitRow[];
  technicianId: string;
}> {
  // Fetch the source visit
  const { rows: srcRows } = await db.execute(sql`
    SELECT
      jv.id AS "visitId", jv.job_id AS "jobId",
      jv.scheduled_start AS "scheduledStart", jv.scheduled_end AS "scheduledEnd",
      jv.estimated_duration_minutes AS "estimatedDurationMinutes",
      jv.status, jv.checked_in_at AS "checkedInAt",
      jv.assigned_technician_ids AS "technicianIds",
      cl.lat AS "locationLat", cl.lng AS "locationLng",
      COALESCE(cc.name, NULLIF(cl.company_name, '')) AS "locationName", j.job_number AS "jobNumber"
    FROM job_visits jv
    JOIN jobs j ON j.id = jv.job_id
      AND ${sql.raw(JOB_ACTIVE_SQL_J)}
    LEFT JOIN client_locations cl ON cl.id = j.location_id
    LEFT JOIN customer_companies cc ON cl.parent_company_id = cc.id
    WHERE jv.id = ${visitId} AND jv.company_id = ${tenantId}
  `);
  const sourceVisit = (srcRows as unknown as ScheduledVisitRow[])[0];
  if (!sourceVisit) throw new Error("Visit not found");
  if (!sourceVisit.scheduledStart) throw new Error("Visit has no schedule");

  const technicianId = sourceVisit.technicianIds?.[0] ?? "";
  if (!technicianId) throw new Error("Visit has no assigned technician");

  // Fetch remaining visits for the same tech, same day, after this visit
  const { rows: remRows } = await db.execute(sql`
    SELECT
      jv.id AS "visitId", jv.job_id AS "jobId",
      jv.scheduled_start AS "scheduledStart", jv.scheduled_end AS "scheduledEnd",
      jv.estimated_duration_minutes AS "estimatedDurationMinutes",
      jv.status, jv.checked_in_at AS "checkedInAt",
      jv.assigned_technician_ids AS "technicianIds",
      cl.lat AS "locationLat", cl.lng AS "locationLng",
      COALESCE(cc.name, NULLIF(cl.company_name, '')) AS "locationName", j.job_number AS "jobNumber"
    FROM job_visits jv
    JOIN jobs j ON j.id = jv.job_id
      AND ${sql.raw(JOB_ACTIVE_SQL_J)}
    LEFT JOIN client_locations cl ON cl.id = j.location_id
    LEFT JOIN customer_companies cc ON cl.parent_company_id = cc.id
    WHERE jv.company_id = ${tenantId}
      AND jv.is_active = true
      AND jv.archived_at IS NULL
      AND jv.status NOT IN (${sql.raw(VISIT_TERMINAL_STATUS_SQL)})
      AND jv.scheduled_start IS NOT NULL
      AND jv.scheduled_start > ${new Date(sourceVisit.scheduledStart)}
      AND jv.scheduled_start < ${new Date(sourceVisit.scheduledStart).toISOString().split("T")[0]}::date + INTERVAL '1 day'
      AND jv.id != ${visitId}
      AND ${technicianId} = ANY(jv.assigned_technician_ids)
    ORDER BY jv.scheduled_start ASC
  `);

  return {
    sourceVisit,
    remainder: remRows as unknown as ScheduledVisitRow[],
    technicianId,
  };
}
