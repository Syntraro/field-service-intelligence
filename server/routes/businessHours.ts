/**
 * Business Hours API Routes
 *
 * Endpoints for managing company business hours.
 * Each company has 7 rows (one per day of week: 0=Sunday...6=Saturday).
 */

import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";
import { storage } from "../storage/index";
import { requireRole } from "../auth/requireRole";
import { RESTRICTED_MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import type { AuthedRequest } from "../auth/tenantIsolation";

const router = Router();
const MANAGER_ROLES = RESTRICTED_MANAGER_ROLES;

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

/**
 * Schema for a single day's business hours.
 * - dayOfWeek: 0=Sunday, 1=Monday, ..., 6=Saturday
 * - isOpen: Whether the business is open this day
 * - startMinutes/endMinutes: Time range in minutes from midnight (0-1440)
 */
const businessHourDaySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  isOpen: z.boolean(),
  startMinutes: z.number().int().min(0).max(1439).nullable().optional(),
  endMinutes: z.number().int().min(1).max(1440).nullable().optional(),
}).refine(
  (data) => {
    if (data.isOpen) {
      // Open days must have valid start and end times
      return (
        data.startMinutes !== null &&
        data.startMinutes !== undefined &&
        data.endMinutes !== null &&
        data.endMinutes !== undefined &&
        data.endMinutes > data.startMinutes
      );
    } else {
      // Closed days should have null/undefined times (we'll accept either)
      return true;
    }
  },
  {
    message: "Open days must have startMinutes < endMinutes; closed days should have null times",
  }
);

/**
 * Schema for updating all 7 days of business hours.
 */
const updateBusinessHoursSchema = z.object({
  hours: z.array(businessHourDaySchema).length(7).refine(
    (hours) => {
      // Ensure all 7 days are present (0-6)
      const days = new Set(hours.map((h) => h.dayOfWeek));
      return days.size === 7 && [0, 1, 2, 3, 4, 5, 6].every((d) => days.has(d));
    },
    { message: "Must provide exactly 7 days (0-6)" }
  ),
});

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /api/company/business-hours
 * Returns all 7 days of business hours for the company.
 */
router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) throw createError(401, "Unauthorized");

    const hours = await storage.getCompanyBusinessHours(companyId);
    res.json({ hours });
  })
);

/**
 * PUT /api/company/business-hours
 * Updates all 7 days of business hours for the company.
 * Requires manager role or above.
 */
router.put(
  "/",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) throw createError(401, "Unauthorized");

    const validation = updateBusinessHoursSchema.safeParse(req.body);
    if (!validation.success) {
      const errors = validation.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join(", ");
      throw createError(400, `Validation failed: ${errors}`);
    }

    // Normalize closed days to have null times (not undefined)
    const normalizedHours = validation.data.hours.map((day) => ({
      dayOfWeek: day.dayOfWeek,
      isOpen: day.isOpen,
      startMinutes: day.isOpen ? (day.startMinutes ?? null) : null,
      endMinutes: day.isOpen ? (day.endMinutes ?? null) : null,
    }));

    const updated = await storage.upsertCompanyBusinessHours(companyId, normalizedHours);
    res.json({ hours: updated });
  })
);

export default router;
