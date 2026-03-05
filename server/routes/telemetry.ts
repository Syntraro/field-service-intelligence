/**
 * Telemetry API — Phase 4B (2026-03-05)
 *
 * POST /api/telemetry/ping
 *   Ingests GPS position from a technician's mobile device.
 *   Auth required. Validates technician belongs to caller's company.
 */

import { Router, type Response } from "express";
import { z } from "zod";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { db } from "../db";
import { technicianPositions, users } from "@shared/schema";
import { eq, and } from "drizzle-orm";

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

// ============================================================================
// POST /ping — Ingest a GPS position
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

  // Insert position record
  await db.insert(technicianPositions).values({
    companyId,
    technicianId: body.technicianId,
    lat: String(body.lat),
    lng: String(body.lng),
    accuracy: body.accuracy != null ? String(body.accuracy) : null,
    speed: body.speed != null ? String(body.speed) : null,
    heading: body.heading != null ? String(body.heading) : null,
    recordedAt: body.timestamp ? new Date(body.timestamp) : new Date(),
  });

  res.json({ success: true });
}));

export default router;
