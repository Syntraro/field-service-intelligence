/**
 * Time Analytics Routes (Phase 5)
 *
 * Provides manager-facing endpoints for:
 * - Weekly time utilization trends
 * - Technician-level analytics
 * - Leakage identification (untracked + unassigned time)
 */

import { Router, type Response } from "express";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { timeTrackingRepository } from "../storage/timeTracking";
import { MANAGER_ROLES } from "../auth/roles";
import { requireRole } from "../auth/requireRole";
import type { AuthedRequest } from "../auth/tenantIsolation";

const analyticsRouter = Router();

/**
 * GET /api/analytics/time/weekly
 * Get weekly time analytics data over multiple weeks
 * Manager-only
 *
 * Query params:
 *   weeks: number (default 8, max 26) - Number of weeks to fetch
 *   weekStart: YYYY-MM-DD (optional) - Anchor week (defaults to current week)
 *   technicianId: UUID (optional) - Filter to specific technician
 */
analyticsRouter.get(
  "/time/weekly",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { weeks, weekStart, technicianId } = req.query;

    // Validate weeks param
    let numWeeks = 8;
    if (weeks) {
      const parsed = parseInt(weeks as string, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 26) {
        throw createError(400, "weeks must be a number between 1 and 26");
      }
      numWeeks = parsed;
    }

    // Validate weekStart format if provided
    if (weekStart && typeof weekStart === "string") {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(weekStart)) {
        throw createError(400, "weekStart must be in YYYY-MM-DD format");
      }
    }

    // Validate technicianId if provided
    if (technicianId && typeof technicianId === "string") {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(technicianId)) {
        throw createError(400, "technicianId must be a valid UUID");
      }
    }

    const result = await timeTrackingRepository.getWeeklyAnalytics(
      req.companyId!,
      {
        weeks: numWeeks,
        weekStart: weekStart as string | undefined,
        technicianId: technicianId as string | undefined,
      }
    );

    res.json(result);
  })
);

/**
 * GET /api/analytics/time/technicians
 * Get technician-level analytics for a specific week
 * Manager-only
 *
 * Query params:
 *   weekStart: YYYY-MM-DD (required) - The week to analyze
 *   technicianId: UUID (optional) - Filter to specific technician
 */
analyticsRouter.get(
  "/time/technicians",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { weekStart, technicianId } = req.query;

    if (!weekStart || typeof weekStart !== "string") {
      throw createError(400, "weekStart query parameter is required (YYYY-MM-DD)");
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(weekStart)) {
      throw createError(400, "weekStart must be in YYYY-MM-DD format");
    }

    // Validate technicianId if provided
    if (technicianId && typeof technicianId === "string") {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(technicianId)) {
        throw createError(400, "technicianId must be a valid UUID");
      }
    }

    const result = await timeTrackingRepository.getTechnicianAnalytics(
      req.companyId!,
      {
        weekStart,
        technicianId: technicianId as string | undefined,
      }
    );

    res.json(result);
  })
);

export { analyticsRouter };
export default analyticsRouter;
