/**
 * Time Alerts Routes
 *
 * API endpoints for managing time alert settings and notification snoozes.
 * Phase 7: Configurable thresholds, escalation, and weekly digest.
 */

import { Router, Response } from "express";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES, RESTRICTED_MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { timeAlertSettingsRepository } from "../storage/timeAlertSettings";
import { notificationSnoozesRepository } from "../storage/notificationSnoozes";
import {
  runTimeAlertsForCompany,
  runTimeAlertsWorker,
  runWeeklyDigestForCompany,
  getAlertThresholds,
} from "../services/timeAlertsWorker";
import {
  updateTimeAlertSettingsSchema,
  snoozeRequestSchema,
  clearSnoozeRequestSchema,
  type NotificationType,
} from "@shared/schema";
import type { AuthedRequest } from "../auth/tenantIsolation";

const router = Router();

// ============================================================================
// Settings Routes (Manager+)
// ============================================================================

/**
 * GET /api/time-alerts/settings
 * Get time alert settings for the current company
 */
router.get(
  "/settings",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req.user!;
    const settings = await timeAlertSettingsRepository.getSettings(companyId);
    res.json(settings);
  })
);

/**
 * PUT /api/time-alerts/settings
 * Update time alert settings for the current company
 */
router.put(
  "/settings",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req.user!;
    const updates = validateSchema(updateTimeAlertSettingsSchema, req.body);

    const settings = await timeAlertSettingsRepository.upsertSettings(companyId, updates);

    res.json({
      success: true,
      settings,
    });
  })
);

/**
 * DELETE /api/time-alerts/settings
 * Reset settings to defaults for the current company
 */
router.delete(
  "/settings",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req.user!;
    const deleted = await timeAlertSettingsRepository.deleteSettings(companyId);

    res.json({
      success: true,
      deleted,
      message: deleted ? "Settings reset to defaults" : "No custom settings found",
    });
  })
);

/**
 * GET /api/time-alerts/thresholds
 * Get current alert thresholds (includes isDefault flag)
 */
router.get(
  "/thresholds",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req.user!;
    const thresholds = await getAlertThresholds(companyId);
    res.json({ thresholds });
  })
);

// ============================================================================
// Snooze Routes (All authenticated users)
// ============================================================================

/**
 * GET /api/time-alerts/snoozes
 * Get all active snoozes for the current user
 */
router.get(
  "/snoozes",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId, id: userId } = req.user!;
    const snoozes = await notificationSnoozesRepository.getActiveSnoozes(companyId, userId);
    res.json({ snoozes });
  })
);

/**
 * POST /api/time-alerts/snooze
 * Create or update a snooze for a notification type
 */
router.post(
  "/snooze",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId, id: userId } = req.user!;
    const data = validateSchema(snoozeRequestSchema, req.body);

    const snoozeUntil = new Date(data.snoozeUntil);

    // Validate snooze duration (max 30 days)
    const maxSnooze = new Date();
    maxSnooze.setDate(maxSnooze.getDate() + 30);
    if (snoozeUntil > maxSnooze) {
      throw createError(400, "Snooze duration cannot exceed 30 days");
    }

    // Validate snooze is in the future
    if (snoozeUntil <= new Date()) {
      throw createError(400, "Snooze must be in the future");
    }

    const snooze = await notificationSnoozesRepository.setSnooze(
      companyId,
      userId,
      data.type,
      snoozeUntil
    );

    res.json({
      success: true,
      snooze: {
        type: snooze.type,
        snoozeUntil: snooze.snoozeUntil,
      },
    });
  })
);

/**
 * POST /api/time-alerts/snooze/clear
 * Clear a snooze for a notification type
 */
router.post(
  "/snooze/clear",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId, id: userId } = req.user!;
    const data = validateSchema(clearSnoozeRequestSchema, req.body);

    const cleared = await notificationSnoozesRepository.clearSnooze(
      companyId,
      userId,
      data.type
    );

    res.json({
      success: true,
      cleared,
      message: cleared ? "Snooze cleared" : "No snooze found for this type",
    });
  })
);

/**
 * DELETE /api/time-alerts/snoozes
 * Clear all snoozes for the current user
 */
router.delete(
  "/snoozes",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId, id: userId } = req.user!;
    const count = await notificationSnoozesRepository.clearAllSnoozes(companyId, userId);

    res.json({
      success: true,
      cleared: count,
      message: `Cleared ${count} snooze(s)`,
    });
  })
);

// ============================================================================
// Worker Trigger Routes (Manager+)
// ============================================================================

/**
 * POST /api/time-alerts/run
 * Manually trigger time alerts worker for the current company
 *
 * Query params:
 * - allCompanies: "true" to run for all companies (owner-only)
 * - date: Override date for daily checks (YYYY-MM-DD format)
 * - runDigest: "true" to also run weekly digest
 */
router.post(
  "/run",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const runAllCompanies = req.query.allCompanies === "true";
    const dateOverride = req.query.date as string | undefined;
    const runDigest = req.query.runDigest === "true";

    // Only owners can run for all companies
    if (runAllCompanies && user.role !== "owner") {
      throw createError(403, "Only owners can run alerts for all companies");
    }

    // Validate date format if provided
    if (dateOverride && !/^\d{4}-\d{2}-\d{2}$/.test(dateOverride)) {
      throw createError(400, "Invalid date format. Use YYYY-MM-DD.");
    }

    let result;
    if (runAllCompanies) {
      result = await runTimeAlertsWorker({ dateOverride, runDigest });
    } else {
      result = await runTimeAlertsForCompany(user.companyId, { dateOverride, runDigest });
    }

    res.json({
      success: true,
      mode: runAllCompanies ? "all_companies" : "single_company",
      companyId: runAllCompanies ? null : user.companyId,
      dateChecked: dateOverride || "yesterday",
      runDigest,
      result,
    });
  })
);

/**
 * POST /api/time-alerts/run-digest
 * Manually trigger weekly digest for the current company
 *
 * Query params:
 * - weekStart: Override week start date (YYYY-MM-DD format, must be Monday)
 */
router.post(
  "/run-digest",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req.user!;
    let weekStart = req.query.weekStart as string | undefined;

    // Default to last week's Monday
    if (!weekStart) {
      const date = new Date();
      const day = date.getDay();
      const diff = date.getDate() - day + (day === 0 ? -6 : 1) - 7;
      date.setDate(diff);
      weekStart = date.toISOString().split("T")[0];
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      throw createError(400, "Invalid date format. Use YYYY-MM-DD.");
    }

    const result = await runWeeklyDigestForCompany(companyId, weekStart);

    res.json({
      success: true,
      companyId,
      weekStart,
      result,
    });
  })
);

export default router;
