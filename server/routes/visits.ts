/**
 * Visits Routes — Canonical visit feed API.
 *
 * GET /api/visits — Returns visits with job + location data.
 * Supports date range, technician, status, and location filters.
 * RBAC: Technicians see only their assigned visits automatically.
 *
 * Phase 3 Step C4: Created as part of Canonical Visit Feed Migration.
 */
import { Router, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { getQueryCtx } from "../lib/queryCtx";
import { getVisitFeed, type VisitFeedFilters } from "../storage/visits";

const router = Router();

/** Query param schema for GET /api/visits */
const visitFeedQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  technicianId: z.string().uuid().optional(),
  status: z.string().optional(),
  excludeStatuses: z.string().optional(), // comma-separated
  unscheduled: z.enum(["true", "false"]).optional(),
  jobId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
});

/**
 * GET /api/visits
 *
 * Query params:
 *   from       — ISO date string (range start, inclusive)
 *   to         — ISO date string (range end, inclusive)
 *   technicianId — UUID, filter to specific technician
 *   status     — Single status string
 *   excludeStatuses — Comma-separated statuses to exclude
 *   unscheduled — "true" to get only unscheduled visits
 *   jobId      — UUID, filter to specific job
 *   locationId — UUID, filter to specific location
 */
router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const query = visitFeedQuerySchema.parse(req.query);
    const ctx = getQueryCtx(req);

    const filters: VisitFeedFilters = {};

    if (query.from) filters.from = new Date(query.from);
    if (query.to) filters.to = new Date(query.to);
    if (query.technicianId) filters.technicianId = query.technicianId;
    if (query.status) filters.status = query.status;
    if (query.excludeStatuses) {
      filters.excludeStatuses = query.excludeStatuses.split(",").map(s => s.trim());
    }
    if (query.unscheduled === "true") filters.unscheduled = true;
    if (query.jobId) filters.jobId = query.jobId;
    if (query.locationId) filters.locationId = query.locationId;

    const visits = await getVisitFeed(ctx, filters);

    res.json({ visits, count: visits.length });
  })
);

export default router;
