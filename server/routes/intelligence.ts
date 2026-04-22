/**
 * Intelligence Routes — Operational signal evaluation + dispatcher actions.
 *
 * Phase 5 (2026-03-05): Visit intelligence + attention rules.
 * Phase 5B (2026-03-05): Running-long detection, shift/optimize remainder.
 *
 * POST /api/intelligence/evaluate              — Run signal computation
 * POST /api/intelligence/visits/:id/shift-remainder    — Shift remaining visits forward
 * POST /api/intelligence/visits/:id/optimize-remainder — Re-optimize remaining visits
 * POST /api/intelligence/suggest-slots                 — Phase 6: Auto-gap scheduling
 */

import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { computeVisitStatusSignals, fetchRemainderVisits } from "../lib/visitIntelligence";
import { suggestVisitSlots } from "../lib/autoGapScheduling";
import { jobVisitsRepository, isVisitActioned } from "../storage/jobVisits";
import { logEventAsync } from "../lib/events";
import { getQueryCtx } from "../lib/queryCtx";
import { routeOptimizationService } from "../routeOptimizationService";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { JOB_ACTIVE_SQL_J } from "../storage/jobFilters";
// 2026-04-21 Phase 1.5 canonicalization: bulk schedule-rewrites on the
// intelligence routes route through the orchestrator so actioned-visit
// protection and optimistic-locking plumbing fire uniformly with single-
// visit reschedules.
import * as lifecycle from "../services/jobLifecycleOrchestrator";

const router = Router();

/**
 * POST /api/intelligence/evaluate
 * Runs visit intelligence signal computation.
 * Generates attention items and returns detected signals.
 */
router.post(
  "/evaluate",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId;
    const userId = req.user!.id;

    const signals = await computeVisitStatusSignals(tenantId, userId);

    res.json({
      evaluated: true,
      signalCount: signals.length,
      signals,
    });
  }),
);

// ---------------------------------------------------------------------------
// Phase 5B: Shift Remainder
// ---------------------------------------------------------------------------

const shiftSchema = z.object({
  driftMinutes: z.number().int().min(1).optional(),
});

/**
 * POST /api/intelligence/visits/:id/shift-remainder
 * Shifts all remaining visits for the same tech/day forward by driftMinutes.
 * If driftMinutes not provided, computes from current running-long state.
 */
router.post(
  "/visits/:id/shift-remainder",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId;
    const visitId = req.params.id;
    const body = validateSchema(shiftSchema, req.body);

    const { sourceVisit, remainder, technicianId } = await fetchRemainderVisits(tenantId, visitId);

    if (remainder.length === 0) {
      return res.json({ shifted: 0, message: "No remaining visits to shift" });
    }

    // Compute drift if not provided
    const now = new Date();
    const plannedEnd = sourceVisit.scheduledEnd
      ? new Date(sourceVisit.scheduledEnd)
      : new Date(
          new Date(sourceVisit.scheduledStart!).getTime() +
            (sourceVisit.estimatedDurationMinutes ?? 60) * 60_000,
        );
    const drift = body.driftMinutes ?? Math.max(1, Math.round((now.getTime() - plannedEnd.getTime()) / 60_000));

    // Validate all visits have schedule before modifying
    const missing = remainder.filter((v) => !v.scheduledStart);
    if (missing.length > 0) {
      throw createError(400, `${missing.length} visit(s) missing scheduledStart`);
    }

    // 2026-04-21 Phase 1.5: each visit shift routes through
    // `lifecycle.rescheduleVisit(mode:"replace")` so the same invariants
    // that guard single-visit reschedules apply. Actioned visits are
    // skipped with a stable reason — shifting an in-progress or en-route
    // visit silently would erase real-world state.
    let shifted = 0;
    const skipped: { visitId: string; reason: string }[] = [];
    for (const v of remainder) {
      if (isVisitActioned(v as any)) {
        skipped.push({ visitId: v.visitId, reason: `Visit is actioned (status=${v.status})` });
        continue;
      }
      const oldStart = new Date(v.scheduledStart!);
      const newStart = new Date(oldStart.getTime() + drift * 60_000);
      const durMin = v.estimatedDurationMinutes ?? 60;
      const newEnd = v.scheduledEnd
        ? new Date(new Date(v.scheduledEnd).getTime() + drift * 60_000)
        : new Date(newStart.getTime() + durMin * 60_000);

      try {
        await lifecycle.rescheduleVisit({
          type: "RESCHEDULE_VISIT",
          companyId: tenantId,
          visitId: v.visitId,
          startAt: newStart,
          endAt: newEnd,
          mode: "replace",
        });
        shifted++;
      } catch (err: any) {
        skipped.push({ visitId: v.visitId, reason: err?.message || "Reschedule failed" });
      }
    }

    // Log event
    const ctx = getQueryCtx(req);
    logEventAsync(ctx, {
      eventType: "schedule.shift_remainder",
      entityType: "visit",
      entityId: visitId,
      summary: `Shifted ${shifted} visit(s) forward by ${drift}m for technician (${skipped.length} skipped)`,
      meta: { technicianId, driftMinutes: drift, shiftedCount: shifted, skippedCount: skipped.length, skipped },
    });

    res.json({
      shifted,
      skipped,
      driftMinutes: drift,
      technicianId,
      message: `Shifted ${shifted} visit(s) forward by ${drift} minutes${skipped.length ? ` (${skipped.length} skipped)` : ""}`,
    });
  }),
);

// ---------------------------------------------------------------------------
// Phase 5B: Optimize Remainder
// ---------------------------------------------------------------------------

/**
 * POST /api/intelligence/visits/:id/optimize-remainder
 * Collects remaining stops for the tech/day, calls route optimization,
 * and applies the optimized order + recomputed start times.
 */
router.post(
  "/visits/:id/optimize-remainder",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId;
    const visitId = req.params.id;

    const { sourceVisit, remainder, technicianId } = await fetchRemainderVisits(tenantId, visitId);

    if (remainder.length === 0) {
      return res.json({ optimized: 0, message: "No remaining visits to optimize" });
    }

    // Validate all visits have lat/lng
    const missingCoords = remainder.filter(
      (v) => !v.locationLat || !v.locationLng,
    );
    if (missingCoords.length > 0) {
      const names = missingCoords.map((v) => v.locationName || v.visitId).join(", ");
      throw createError(
        400,
        `Cannot optimize: ${missingCoords.length} visit(s) missing coordinates: ${names}`,
      );
    }

    // Build stops for optimization
    // Start from source visit location (or first remainder if no coords)
    const startCoords: [number, number] | undefined =
      sourceVisit.locationLat && sourceVisit.locationLng
        ? [parseFloat(sourceVisit.locationLng), parseFloat(sourceVisit.locationLat)]
        : undefined;

    const geocodedClients = remainder.map((v) => ({
      client: { id: v.visitId, companyName: v.locationName || v.visitId } as any,
      coordinates: [parseFloat(v.locationLng!), parseFloat(v.locationLat!)] as [number, number],
      address: v.locationName || "",
    }));

    const optimized = await routeOptimizationService.optimizeRoute(geocodedClients, startCoords);

    if (!optimized) {
      throw createError(502, "Route optimization service returned no result");
    }

    // Determine baseline start: now or source visit's planned end
    const now = new Date();
    const plannedEnd = sourceVisit.scheduledEnd
      ? new Date(sourceVisit.scheduledEnd)
      : new Date(
          new Date(sourceVisit.scheduledStart!).getTime() +
            (sourceVisit.estimatedDurationMinutes ?? 60) * 60_000,
        );
    let cursor = now > plannedEnd ? now : plannedEnd;

    // 2026-04-21 Phase 1.5: route each per-visit reschedule through
    // `lifecycle.rescheduleVisit(mode:"replace")`. Actioned visits are
    // skipped — rewriting an in-progress visit's schedule from a route
    // optimizer would erase real-world state.
    let applied = 0;
    const skipped: { visitId: string; reason: string }[] = [];
    for (const idx of optimized.order) {
      const v = remainder[idx];
      const durMin = v.estimatedDurationMinutes ?? 60;

      // Add travel time from previous stop
      const prevVisit = applied === 0 ? sourceVisit : remainder[optimized.order[applied - 1]];
      if (
        prevVisit.locationLat && prevVisit.locationLng &&
        v.locationLat && v.locationLng
      ) {
        const travelMs = estimateTravelMs(
          parseFloat(prevVisit.locationLat), parseFloat(prevVisit.locationLng),
          parseFloat(v.locationLat), parseFloat(v.locationLng),
        );
        cursor = new Date(cursor.getTime() + travelMs);
      } else {
        cursor = new Date(cursor.getTime() + 10 * 60_000); // 10min fallback
      }

      const newStart = new Date(cursor);
      const newEnd = new Date(newStart.getTime() + durMin * 60_000);

      if (isVisitActioned(v as any)) {
        skipped.push({ visitId: v.visitId, reason: `Visit is actioned (status=${v.status})` });
        continue;
      }

      try {
        await lifecycle.rescheduleVisit({
          type: "RESCHEDULE_VISIT",
          companyId: tenantId,
          visitId: v.visitId,
          startAt: newStart,
          endAt: newEnd,
          mode: "replace",
        });
        cursor = newEnd;
        applied++;
      } catch (err: any) {
        skipped.push({ visitId: v.visitId, reason: err?.message || "Reschedule failed" });
      }
    }

    // Log event
    const ctx = getQueryCtx(req);
    logEventAsync(ctx, {
      eventType: "schedule.optimize_remainder",
      entityType: "visit",
      entityId: visitId,
      summary: `Optimized ${applied} remaining visit(s) for technician (${skipped.length} skipped)`,
      meta: {
        technicianId,
        optimizedCount: applied,
        skippedCount: skipped.length,
        skipped,
        totalDistanceMeters: optimized.totalDistance,
        totalDurationSeconds: optimized.totalDuration,
      },
    });

    res.json({
      optimized: applied,
      skipped,
      technicianId,
      totalDistanceMeters: optimized.totalDistance,
      totalDurationSeconds: optimized.totalDuration,
      message: `Optimized ${applied} remaining visit(s)${skipped.length ? ` (${skipped.length} skipped)` : ""}`,
    });
  }),
);

// ---------------------------------------------------------------------------
// Phase 6: Auto-Gap Scheduling — suggest optimal time slots
// ---------------------------------------------------------------------------

const suggestSlotsSchema = z.object({
  visitId: z.string().optional(),
  durationMinutes: z.number().int().min(5).max(480).optional(),
  location: z.object({
    lat: z.number(),
    lng: z.number(),
  }).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  techIds: z.array(z.string()).optional(),
  workday: z.object({
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
  }).optional(),
});

/**
 * POST /api/intelligence/suggest-slots
 * Returns ranked gap-based slot suggestions for placing a visit.
 * Requires either visitId (reads duration + location from DB) or durationMinutes + location.
 */
router.post(
  "/suggest-slots",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId;
    const body = validateSchema(suggestSlotsSchema, req.body);

    let durationMinutes: number;
    let location: { lat: number; lng: number };

    if (body.visitId) {
      // Resolve visit from DB
      const visit = await jobVisitsRepository.getJobVisit(tenantId, body.visitId);
      if (!visit) throw createError(404, "Visit not found");

      durationMinutes = body.durationMinutes ?? visit.estimatedDurationMinutes ?? 60;

      // Get location from the visit's job → client_location
      if (body.location) {
        location = body.location;
      } else {
        const { rows } = await db.execute(sql`
          SELECT cl.lat, cl.lng
          FROM jobs j
          JOIN client_locations cl ON cl.id = j.location_id
          WHERE j.id = ${visit.jobId} AND j.company_id = ${tenantId}
            AND ${sql.raw(JOB_ACTIVE_SQL_J)}
        `);
        const loc = (rows as any[])[0];
        if (!loc?.lat || !loc?.lng) {
          throw createError(400, "Visit's job location has no coordinates. Please add lat/lng to the client location first.");
        }
        location = { lat: parseFloat(loc.lat), lng: parseFloat(loc.lng) };
      }
    } else {
      // Manual params required
      if (!body.durationMinutes) throw createError(400, "durationMinutes required when visitId not provided");
      if (!body.location) throw createError(400, "location required when visitId not provided");
      durationMinutes = body.durationMinutes;
      location = body.location;
    }

    const suggestions = await suggestVisitSlots({
      companyId: tenantId,
      visitDurationMinutes: durationMinutes,
      location,
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
      techIds: body.techIds,
      workday: body.workday,
    });

    res.json({ suggestions });
  }),
);

/** Travel time estimate: 2 min per km (~30 km/h city). Returns milliseconds. */
function estimateTravelMs(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const distM = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.max(5 * 60_000, (distM / 1000) * 2 * 60_000); // min 5 min
}

export default router;
