/**
 * Telemetry API — Phase 4B.1 (2026-03-05)
 *
 * POST /api/telemetry/ping
 *   UPSERT GPS position into technician_live_positions (one row per tech).
 *   History table (technician_positions) is NOT written to by default.
 *
 * POST /api/telemetry/purge
 *   Admin-only. Deletes old rows from technician_positions history table.
 */

import { Router, type Response } from "express";
import { z } from "zod";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { requireRole } from "../auth/requireRole";
import { ADMIN_ROLES } from "../auth/roles";
import { db } from "../db";
import { technicianLivePositions, technicianPositions, users } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

const router = Router();

// ============================================================================
// Validation
// ============================================================================

const pingSchema = z.object({
  technicianId: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().positive().optional(),
  speed: z.number().min(0).optional(),
  heading: z.number().min(0).max(360).optional(),
  timestamp: z.string().datetime().optional(),
});

const purgeSchema = z.object({
  olderThanDays: z.number().int().min(1).max(365),
});

// ============================================================================
// POST /ping — UPSERT into live positions table
// ============================================================================

router.post("/ping", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = validateSchema(pingSchema, req.body);
  const { companyId } = req.user!;

  // Validate technician belongs to caller's company
  const [tech] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, body.technicianId), eq(users.companyId, companyId)))
    .limit(1);

  if (!tech) {
    throw createError(403, "Technician not found or not in your company");
  }

  const now = body.timestamp ? new Date(body.timestamp) : new Date();
  const latStr = String(body.lat);
  const lngStr = String(body.lng);
  const accuracyStr = body.accuracy != null ? String(body.accuracy) : null;
  const speedStr = body.speed != null ? String(body.speed) : null;
  const headingStr = body.heading != null ? String(body.heading) : null;

  // UPSERT into live table — one row per (company_id, technician_id)
  await db.execute(sql`
    INSERT INTO technician_live_positions
      (id, company_id, technician_id, lat, lng, accuracy, speed, heading, last_seen_at, updated_at)
    VALUES
      (gen_random_uuid(), ${companyId}, ${body.technicianId},
       ${latStr}, ${lngStr}, ${accuracyStr}, ${speedStr}, ${headingStr},
       ${now}, ${new Date()})
    ON CONFLICT (company_id, technician_id) DO UPDATE SET
      lat = EXCLUDED.lat,
      lng = EXCLUDED.lng,
      accuracy = EXCLUDED.accuracy,
      speed = EXCLUDED.speed,
      heading = EXCLUDED.heading,
      last_seen_at = EXCLUDED.last_seen_at,
      updated_at = EXCLUDED.updated_at
  `);

  res.json({ success: true });
}));

// ============================================================================
// POST /purge — Delete old history rows (admin-only)
// ============================================================================

router.post("/purge", requireRole(ADMIN_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { olderThanDays } = validateSchema(purgeSchema, req.body);
  const { companyId } = req.user!;

  const result = await db.execute(sql`
    DELETE FROM technician_positions
    WHERE company_id = ${companyId}
      AND recorded_at < NOW() - (${olderThanDays} || ' days')::interval
  `);

  const deletedCount = result.rowCount ?? 0;

  console.log(`[TELEMETRY] Purged ${deletedCount} history rows older than ${olderThanDays} days for company ${companyId}`);

  res.json({ deletedCount });
}));

export default router;
