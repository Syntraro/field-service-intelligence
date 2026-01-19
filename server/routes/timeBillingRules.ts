/**
 * Time Billing Rules Routes
 *
 * API endpoints for managing company-specific billing rules for time entries.
 * Controls rounding, minimums, rate multipliers, and type-specific billing.
 *
 * Phase 8: Billing Rate Rules + Rounding + Invoice Accuracy
 */

import { Router, Response } from "express";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES, RESTRICTED_MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import {
  timeBillingRulesRepository,
  computeRulesHash,
  applyBillingRulesToEntries,
} from "../storage/timeBillingRules";
import { updateTimeBillingRulesSchema } from "@shared/schema";
import type { AuthedRequest } from "../auth/tenantIsolation";

const router = Router();

// ============================================================================
// Rules Endpoints (Manager+)
// ============================================================================

/**
 * GET /api/time-billing/rules
 * Get billing rules for the current company
 */
router.get(
  "/rules",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req.user!;
    const rules = await timeBillingRulesRepository.getRules(companyId);

    res.json({
      rules,
      hash: computeRulesHash(rules),
    });
  })
);

/**
 * PUT /api/time-billing/rules
 * Update billing rules for the current company
 */
router.put(
  "/rules",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req.user!;
    const updates = validateSchema(updateTimeBillingRulesSchema, req.body);

    // Validate rounding increment is reasonable
    if (updates.roundingIncrementMinutes !== undefined) {
      const validIncrements = [1, 5, 6, 10, 15, 30, 60];
      if (!validIncrements.includes(updates.roundingIncrementMinutes)) {
        throw createError(400, "Rounding increment must be 1, 5, 6, 10, 15, 30, or 60 minutes");
      }
    }

    // Validate multipliers are positive
    if (updates.travelRateMultiplier !== undefined) {
      const mult = parseFloat(updates.travelRateMultiplier);
      if (isNaN(mult) || mult < 0 || mult > 10) {
        throw createError(400, "Travel rate multiplier must be between 0 and 10");
      }
    }
    if (updates.onSiteRateMultiplier !== undefined) {
      const mult = parseFloat(updates.onSiteRateMultiplier);
      if (isNaN(mult) || mult < 0 || mult > 10) {
        throw createError(400, "On-site rate multiplier must be between 0 and 10");
      }
    }

    const rules = await timeBillingRulesRepository.upsertRules(companyId, updates);

    res.json({
      success: true,
      rules,
      hash: computeRulesHash(rules),
    });
  })
);

/**
 * DELETE /api/time-billing/rules
 * Reset rules to defaults for the current company
 */
router.delete(
  "/rules",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req.user!;
    const deleted = await timeBillingRulesRepository.deleteRules(companyId);

    res.json({
      success: true,
      deleted,
      message: deleted ? "Rules reset to defaults" : "No custom rules found",
    });
  })
);

/**
 * POST /api/time-billing/preview
 * Preview billing rules applied to a set of time entries
 * Useful for showing estimated billed amounts before invoicing
 */
router.post(
  "/preview",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req.user!;
    const rules = await timeBillingRulesRepository.getRules(companyId);

    // Expect entries in request body
    const { entries } = req.body;
    if (!Array.isArray(entries)) {
      throw createError(400, "entries must be an array");
    }

    // Validate and normalize entries
    const normalizedEntries = entries.map((e: any, i: number) => {
      if (!e.id || typeof e.id !== "string") {
        throw createError(400, `Entry ${i} missing valid id`);
      }
      return {
        id: e.id,
        type: e.type || "on_site",
        durationMinutes: typeof e.durationMinutes === "number" ? e.durationMinutes : 0,
        billableRateSnapshot: e.billableRateSnapshot || "0",
        jobId: e.jobId || null,
        startAt: e.startAt ? new Date(e.startAt) : new Date(),
      };
    });

    const result = applyBillingRulesToEntries(rules, normalizedEntries);

    res.json({
      rulesHash: result.rulesHash,
      totalBilledMinutes: result.totalBilledMinutes,
      totalExcludedMinutes: result.totalExcludedMinutes,
      entries: result.entries.map((e) => ({
        entryId: e.entryId,
        originalMinutes: e.originalMinutes,
        billedMinutes: e.billedMinutes,
        originalRate: e.originalRate,
        billedRate: e.billedRate,
        entryType: e.entryType,
        wasCapped: e.wasCapped,
        wasExcluded: e.wasExcluded,
        exclusionReason: e.exclusionReason,
      })),
    });
  })
);

export default router;
