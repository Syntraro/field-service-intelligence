/**
 * Auto-Gap Scheduling — suggests optimal time slots for unscheduled visits.
 *
 * Phase 6 (2026-03-05): Gap analysis + travel time + risk scoring.
 *
 * Given a visit duration and location, finds the best available gaps
 * across technicians in a date range, ranked by travel time and risk.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { JOB_ACTIVE_SQL_J } from "../storage/jobFilters";
import { VISIT_TERMINAL_STATUS_SQL } from "./visitPredicates";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SuggestVisitSlotsInput {
  companyId: string;
  visitDurationMinutes: number;
  location: { lat: number; lng: number };
  dateFrom: string; // YYYY-MM-DD
  dateTo: string;   // YYYY-MM-DD
  techIds?: string[];
  workday?: { start: string; end: string }; // "HH:MM" format
}

export interface SuggestedSlot {
  technicianId: string;
  technicianName: string;
  date: string;
  start: string;  // ISO
  end: string;    // ISO
  prevVisitId: string | null;
  nextVisitId: string | null;
  travelBeforeMinutes: number;
  travelAfterMinutes: number;
  addedDriveMinutes: number;
  downstreamLateMinutes: number;
  riskFlags: {
    offline?: boolean;
    runningLong?: boolean;
    hasAlerts?: boolean;
  };
  score: number;
  explanation: string;
}

interface ScheduledVisitRow {
  visitId: string;
  scheduledStart: Date;
  scheduledEnd: Date | null;
  estimatedDurationMinutes: number | null;
  technicianId: string;
  locationLat: string | null;
  locationLng: string | null;
  locationName: string | null;
  jobNumber: string | null;
}

interface TechPositionRow {
  technicianId: string;
  lastSeenAt: Date;
}

interface AttentionRow {
  entityId: string;
  ruleType: string;
  technicianId: string | null;
}

interface TechInfo {
  id: string;
  fullName: string;
}

// ---------------------------------------------------------------------------
// Haversine + travel estimate
// ---------------------------------------------------------------------------

import { haversineMeters, estimateTravelMinutes } from "./distance";

// ---------------------------------------------------------------------------
// Workday parsing
// ---------------------------------------------------------------------------

function parseHHMM(hhmm: string): { hours: number; minutes: number } {
  const [h, m] = hhmm.split(":").map(Number);
  return { hours: h || 0, minutes: m || 0 };
}

function workdayBounds(dateStr: string, workday: { start: string; end: string }): { start: Date; end: Date } {
  const s = parseHHMM(workday.start);
  const e = parseHHMM(workday.end);
  const startDate = new Date(`${dateStr}T${String(s.hours).padStart(2, "0")}:${String(s.minutes).padStart(2, "0")}:00`);
  const endDate = new Date(`${dateStr}T${String(e.hours).padStart(2, "0")}:${String(e.minutes).padStart(2, "0")}:00`);
  return { start: startDate, end: endDate };
}

// ---------------------------------------------------------------------------
// Batch data fetchers
// ---------------------------------------------------------------------------

async function fetchVisitsInRange(
  companyId: string,
  dateFrom: string,
  dateTo: string,
  techIds?: string[],
): Promise<ScheduledVisitRow[]> {
  const techFilter = techIds && techIds.length > 0
    ? sql`AND jv.assigned_technician_ids && ${techIds}`
    : sql``;

  const { rows } = await db.execute(sql`
    SELECT
      jv.id AS "visitId",
      jv.scheduled_start AS "scheduledStart",
      jv.scheduled_end AS "scheduledEnd",
      jv.estimated_duration_minutes AS "estimatedDurationMinutes",
      jv.assigned_technician_ids[1] AS "technicianId",
      cl.lat AS "locationLat",
      cl.lng AS "locationLng",
      -- 2026-05-01 bypass cleanup: locationName resolves via the
      -- canonical parent-first COALESCE so auto-gap suggestions show
      -- the current parent name even on stale-denormalized rows.
      COALESCE(cc.name, NULLIF(cl.company_name, '')) AS "locationName",
      j.job_number AS "jobNumber"
    FROM job_visits jv
    JOIN jobs j ON j.id = jv.job_id AND j.company_id = ${companyId}
      AND ${sql.raw(JOB_ACTIVE_SQL_J)}
    LEFT JOIN client_locations cl ON cl.id = j.location_id
    LEFT JOIN customer_companies cc ON cl.parent_company_id = cc.id
    WHERE jv.company_id = ${companyId}
      AND jv.is_active = true
      AND jv.archived_at IS NULL
      AND jv.scheduled_start IS NOT NULL
      AND jv.scheduled_start >= ${dateFrom}::date
      AND jv.scheduled_start < (${dateTo}::date + INTERVAL '1 day')
      AND jv.status NOT IN (${sql.raw(VISIT_TERMINAL_STATUS_SQL)})
      ${techFilter}
    ORDER BY jv.scheduled_start ASC
  `);
  return rows as unknown as ScheduledVisitRow[];
}

async function fetchLivePositions(companyId: string): Promise<Map<string, TechPositionRow>> {
  const { rows } = await db.execute(sql`
    SELECT technician_id AS "technicianId", last_seen_at AS "lastSeenAt"
    FROM technician_live_positions
    WHERE company_id = ${companyId}
  `);
  const map = new Map<string, TechPositionRow>();
  for (const r of rows as unknown as TechPositionRow[]) {
    map.set(r.technicianId, r);
  }
  return map;
}

async function fetchOpenAlerts(companyId: string): Promise<AttentionRow[]> {
  const { rows } = await db.execute(sql`
    SELECT
      ai.entity_id AS "entityId",
      ai.rule_type AS "ruleType",
      ai.meta->>'technicianId' AS "technicianId"
    FROM attention_items ai
    WHERE ai.tenant_id = ${companyId}
      AND ai.status = 'open'
      AND ai.rule_type IN ('visit.late', 'visit.overdue', 'visit.running_long', 'tech.offline', 'tech.idle')
  `);
  return rows as unknown as AttentionRow[];
}

async function fetchSchedulableTechs(companyId: string): Promise<TechInfo[]> {
  const { rows } = await db.execute(sql`
    SELECT id, full_name AS "fullName"
    FROM users
    WHERE company_id = ${companyId}
      AND is_schedulable = true
      AND status = 'active'
    ORDER BY full_name ASC
  `);
  return rows as unknown as TechInfo[];
}

// ---------------------------------------------------------------------------
// Core suggestion engine
// ---------------------------------------------------------------------------

export async function suggestVisitSlots(input: SuggestVisitSlotsInput): Promise<SuggestedSlot[]> {
  const {
    companyId,
    visitDurationMinutes,
    location,
    dateFrom,
    dateTo,
    techIds,
    workday = { start: "08:00", end: "17:00" },
  } = input;

  // Batch-fetch all data in parallel
  const [allVisits, livePositions, alerts, allTechs] = await Promise.all([
    fetchVisitsInRange(companyId, dateFrom, dateTo, techIds),
    fetchLivePositions(companyId),
    fetchOpenAlerts(companyId),
    fetchSchedulableTechs(companyId),
  ]);

  // Filter techs to requested IDs if specified
  const techs = techIds && techIds.length > 0
    ? allTechs.filter(t => techIds.includes(t.id))
    : allTechs;

  if (techs.length === 0) return [];

  // Build per-tech alert sets
  const techAlertRules = new Map<string, Set<string>>();
  for (const a of alerts) {
    const tid = a.technicianId;
    if (!tid) continue;
    if (!techAlertRules.has(tid)) techAlertRules.set(tid, new Set());
    techAlertRules.get(tid)!.add(a.ruleType);
  }

  // Group visits by tech+date
  const visitsByTechDate = new Map<string, ScheduledVisitRow[]>();
  for (const v of allVisits) {
    if (!v.technicianId) continue;
    const dateKey = v.scheduledStart.toISOString().slice(0, 10);
    const key = `${v.technicianId}|${dateKey}`;
    if (!visitsByTechDate.has(key)) visitsByTechDate.set(key, []);
    visitsByTechDate.get(key)!.push(v);
  }

  // Build tech name map
  const techNames = new Map<string, string>();
  for (const t of techs) techNames.set(t.id, t.fullName);

  // Generate date list
  const dates: string[] = [];
  const dFrom = new Date(dateFrom);
  const dTo = new Date(dateTo);
  for (let d = new Date(dFrom); d <= dTo; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }

  const candidates: SuggestedSlot[] = [];

  for (const tech of techs) {
    // Risk flags for this tech
    const alertRules = techAlertRules.get(tech.id);
    const livePos = livePositions.get(tech.id);
    const isOffline = !livePos || (Date.now() - livePos.lastSeenAt.getTime() > 5 * 60_000);
    const isRunningLong = alertRules?.has("visit.running_long") ?? false;
    const hasAlerts = alertRules ? alertRules.size > 0 : false;

    const riskFlags = {
      offline: isOffline || undefined,
      runningLong: isRunningLong || undefined,
      hasAlerts: hasAlerts || undefined,
    };

    // Risk penalty for scoring
    let riskPenalty = 0;
    if (isOffline) riskPenalty += 50;
    if (isRunningLong) riskPenalty += 40;
    if (hasAlerts) riskPenalty += 10;

    for (const dateStr of dates) {
      const bounds = workdayBounds(dateStr, workday);
      const key = `${tech.id}|${dateStr}`;
      const dayVisits = visitsByTechDate.get(key) || [];

      // Sort by scheduledStart
      dayVisits.sort((a, b) => a.scheduledStart.getTime() - b.scheduledStart.getTime());

      // Build gap list: workday_start → first visit, between visits, last visit → workday_end
      interface Gap {
        start: Date;
        end: Date;
        prevVisit: ScheduledVisitRow | null;
        nextVisit: ScheduledVisitRow | null;
      }
      const gaps: Gap[] = [];

      // Gap before first visit
      if (dayVisits.length === 0) {
        gaps.push({ start: bounds.start, end: bounds.end, prevVisit: null, nextVisit: null });
      } else {
        const first = dayVisits[0];
        if (first.scheduledStart.getTime() > bounds.start.getTime()) {
          gaps.push({ start: bounds.start, end: first.scheduledStart, prevVisit: null, nextVisit: first });
        }

        // Gaps between visits
        for (let i = 0; i < dayVisits.length - 1; i++) {
          const curr = dayVisits[i];
          const next = dayVisits[i + 1];
          const currEnd = curr.scheduledEnd
            ? curr.scheduledEnd
            : new Date(curr.scheduledStart.getTime() + (curr.estimatedDurationMinutes ?? 60) * 60_000);
          if (currEnd.getTime() < next.scheduledStart.getTime()) {
            gaps.push({ start: currEnd, end: next.scheduledStart, prevVisit: curr, nextVisit: next });
          }
        }

        // Gap after last visit
        const last = dayVisits[dayVisits.length - 1];
        const lastEnd = last.scheduledEnd
          ? last.scheduledEnd
          : new Date(last.scheduledStart.getTime() + (last.estimatedDurationMinutes ?? 60) * 60_000);
        if (lastEnd.getTime() < bounds.end.getTime()) {
          gaps.push({ start: lastEnd, end: bounds.end, prevVisit: last, nextVisit: null });
        }
      }

      // Evaluate each gap
      for (const gap of gaps) {
        // Travel time from previous visit (or 0 if start of day)
        let travelBefore = 0;
        if (gap.prevVisit?.locationLat && gap.prevVisit?.locationLng) {
          travelBefore = estimateTravelMinutes(
            parseFloat(gap.prevVisit.locationLat),
            parseFloat(gap.prevVisit.locationLng),
            location.lat,
            location.lng,
          );
        }

        // Travel time to next visit (or 0 if end of day)
        let travelAfter = 0;
        if (gap.nextVisit?.locationLat && gap.nextVisit?.locationLng) {
          travelAfter = estimateTravelMinutes(
            location.lat,
            location.lng,
            parseFloat(gap.nextVisit.locationLat),
            parseFloat(gap.nextVisit.locationLng),
          );
        }

        // Earliest feasible start = gap.start + travel before
        const earliestStart = new Date(gap.start.getTime() + travelBefore * 60_000);
        const proposedEnd = new Date(earliestStart.getTime() + visitDurationMinutes * 60_000);
        const latestEnd = new Date(gap.end.getTime() - travelAfter * 60_000);

        // Check if visit fits
        if (proposedEnd.getTime() > latestEnd.getTime()) continue;

        // Compute added drive vs direct prev→next
        let directTravel = 0;
        if (
          gap.prevVisit?.locationLat && gap.prevVisit?.locationLng &&
          gap.nextVisit?.locationLat && gap.nextVisit?.locationLng
        ) {
          directTravel = estimateTravelMinutes(
            parseFloat(gap.prevVisit.locationLat),
            parseFloat(gap.prevVisit.locationLng),
            parseFloat(gap.nextVisit.locationLat),
            parseFloat(gap.nextVisit.locationLng),
          );
        }
        const addedDrive = Math.max(0, (travelBefore + travelAfter) - directTravel);

        // Downstream late prediction: if we push into the gap, does the next visit shift?
        let downstreamLate = 0;
        if (gap.nextVisit) {
          const bufferAfter = gap.end.getTime() - proposedEnd.getTime() - travelAfter * 60_000;
          if (bufferAfter < 0) {
            downstreamLate = Math.round(Math.abs(bufferAfter) / 60_000);
          }
        }

        // Score: lower is better
        // Base = total added drive + downstream impact + risk penalty
        const score = Math.round(
          addedDrive * 2 +
          travelBefore +
          travelAfter +
          downstreamLate * 3 +
          riskPenalty
        );

        // Explanation
        const parts: string[] = [];
        parts.push(`${travelBefore}m drive to site`);
        if (travelAfter > 0) parts.push(`${travelAfter}m to next`);
        if (addedDrive > 0) parts.push(`+${addedDrive}m added drive`);
        if (downstreamLate > 0) parts.push(`${downstreamLate}m downstream risk`);
        if (isOffline) parts.push("tech offline");
        if (isRunningLong) parts.push("running long today");

        candidates.push({
          technicianId: tech.id,
          technicianName: techNames.get(tech.id) || tech.id,
          date: dateStr,
          start: earliestStart.toISOString(),
          end: proposedEnd.toISOString(),
          prevVisitId: gap.prevVisit?.visitId ?? null,
          nextVisitId: gap.nextVisit?.visitId ?? null,
          travelBeforeMinutes: travelBefore,
          travelAfterMinutes: travelAfter,
          addedDriveMinutes: addedDrive,
          downstreamLateMinutes: downstreamLate,
          riskFlags,
          score,
          explanation: parts.join(" · "),
        });
      }
    }
  }

  // Sort by score ascending (lower = better), return top 12
  candidates.sort((a, b) => a.score - b.score);
  return candidates.slice(0, 12);
}
