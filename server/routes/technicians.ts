import express, { Response } from "express";
import { createTechnician } from "../services/technicians";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { RESTRICTED_MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";
import { db } from "../db";
import { technicianPositions, users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

const router = express.Router();

const MANAGER_ROLES = RESTRICTED_MANAGER_ROLES;

// ========================================
// VALIDATION SCHEMAS
// ========================================

const createTechnicianSchema = z.object({
  name: z.string().min(1).max(200),
  userId: z.string().uuid().optional(),
});

router.post("/", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const validation = createTechnicianSchema.safeParse(req.body);
  if (!validation.success) {
    throw createError(400, "Validation failed");
  }

  const { name, userId } = validation.data;
  const companyId = req.companyId!;
  const tech = await createTechnician(companyId, name, userId);
  res.json(tech);
}));

// ========================================
// GET /live — Latest position per technician (Phase 4B, 2026-03-05)
// ========================================

router.get("/live", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;

  // DISTINCT ON (technician_id) gives latest row per tech via ORDER BY recorded_at DESC
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (tp.technician_id)
      tp.technician_id AS "technicianId",
      COALESCE(u.first_name || ' ' || u.last_name, u.full_name, u.email) AS "name",
      tp.lat,
      tp.lng,
      tp.speed,
      tp.recorded_at AS "lastSeenAt"
    FROM technician_positions tp
    JOIN users u ON u.id = tp.technician_id
    WHERE tp.company_id = ${companyId}
    ORDER BY tp.technician_id, tp.recorded_at DESC
  `);

  res.json(rows.rows);
}));

export default router;