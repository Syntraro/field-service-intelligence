import express, { Response } from "express";
import { technicianRepository } from "../storage/technicians";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { RESTRICTED_MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";
import { db } from "../db";
import { users } from "@shared/schema";
import { sql } from "drizzle-orm";

const router = express.Router();

// ========================================
// VALIDATION SCHEMAS
// ========================================

const createTechnicianSchema = z.object({
  name: z.string().min(1).max(200),
  userId: z.string().uuid().optional(),
});

router.post("/", requireRole(RESTRICTED_MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const validation = createTechnicianSchema.safeParse(req.body);
  if (!validation.success) {
    throw createError(400, "Validation failed");
  }

  const { name, userId } = validation.data;
  const companyId = req.companyId!;
  const tech = await technicianRepository.createTechnician(companyId, name, userId);
  res.json(tech);
}));

// ========================================
// GET /live — Live position per technician (Phase 4B.1, 2026-03-05)
// Reads from technician_live_positions (one row per tech, UPSERT target).
// Includes online flag: last_seen_at >= now() - interval '5 minutes'
// ========================================

router.get("/live", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;

  const rows = await db.execute(sql`
    SELECT
      lp.technician_id AS "technicianId",
      COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.full_name, u.email) AS "name",
      lp.lat,
      lp.lng,
      lp.speed,
      lp.last_seen_at AS "lastSeenAt",
      (lp.last_seen_at >= NOW() - INTERVAL '5 minutes') AS "online"
    FROM technician_live_positions lp
    JOIN users u ON u.id = lp.technician_id
    WHERE lp.company_id = ${companyId}
    ORDER BY lp.last_seen_at DESC
  `);

  res.json(rows.rows);
}));

export default router;