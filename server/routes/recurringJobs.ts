/**
 * Recurring Job Templates API Routes
 *
 * CRUD for recurring job templates and generation endpoints.
 *
 * PERMISSIONS:
 * - owner, admin, dispatcher: full access (create, update, generate)
 * - technician, manager: read-only access
 */

import { Router, Response } from "express";
import { z } from "zod";
import { recurringJobsRepository } from "../storage/recurringJobs";
import {
  insertRecurringJobTemplateSchema,
  updateRecurringJobTemplateSchema,
} from "@shared/schema";
import { requireAuth } from "../auth/requireAuth";
import { requireRole } from "../auth/requireRole";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import {
  generateInstances,
  generateForSingleTemplate,
  previewGeneration,
} from "../domain/recurrence";

const router = Router();

// Roles that can modify recurring templates
const SCHEDULING_ROLES = ["owner", "admin", "dispatcher"];

// ============================================================================
// Templates CRUD
// ============================================================================

/**
 * GET /api/recurring-templates
 * List all recurring job templates for the company
 *
 * Query params:
 * - activeOnly: boolean (default false)
 */
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const activeOnly = req.query.activeOnly === "true";

    const templates = await recurringJobsRepository.getTemplates(companyId, {
      activeOnly,
    });

    res.json(templates);
  })
);

/**
 * GET /api/recurring-templates/:id
 * Get a single recurring job template
 */
router.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const templateId = req.params.id;

    const template = await recurringJobsRepository.getTemplate(
      companyId,
      templateId
    );

    if (!template) {
      throw createError(404, "Recurring template not found");
    }

    res.json(template);
  })
);

/**
 * GET /api/recurring-templates/:id/instances
 * Get instances for a template with optional date range filtering
 *
 * Query params:
 * - from: YYYY-MM-DD (optional, filter instances from this date)
 * - to: YYYY-MM-DD (optional, filter instances up to this date)
 * - limit: number (optional, default 100)
 *
 * Returns instances with linked job info (jobNumber, summary, status)
 */
router.get(
  "/:id/instances",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const templateId = req.params.id;
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 100;

    const instances = await recurringJobsRepository.getInstancesWithJobs(
      companyId,
      templateId,
      { from, to, limit }
    );

    res.json(instances);
  })
);

/**
 * POST /api/recurring-templates
 * Create a new recurring job template
 *
 * Requires: owner, admin, or dispatcher role
 */
router.post(
  "/",
  requireAuth,
  requireRole(SCHEDULING_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const data = validateSchema(insertRecurringJobTemplateSchema, req.body);

    // Validate hold reason required if openSubStatusDefault is on_hold
    if (data.openSubStatusDefault === "on_hold" && !data.holdReason) {
      throw createError(400, "holdReason is required when openSubStatusDefault is on_hold");
    }

    // Validate weekly recurrence has daysOfWeek
    if (data.recurrenceKind === "weekly" && (!data.daysOfWeek || data.daysOfWeek.length === 0)) {
      throw createError(400, "daysOfWeek is required for weekly recurrence");
    }

    const template = await recurringJobsRepository.createTemplate(companyId, data);

    res.status(201).json(template);
  })
);

/**
 * PATCH /api/recurring-templates/:id
 * Update a recurring job template
 *
 * Requires: owner, admin, or dispatcher role
 */
router.patch(
  "/:id",
  requireAuth,
  requireRole(SCHEDULING_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const templateId = req.params.id;
    const data = validateSchema(updateRecurringJobTemplateSchema, req.body);

    // Get current template to check constraints
    const existing = await recurringJobsRepository.getTemplate(companyId, templateId);
    if (!existing) {
      throw createError(404, "Recurring template not found");
    }

    // Validate hold reason if transitioning to on_hold
    const newSubStatus = data.openSubStatusDefault !== undefined ? data.openSubStatusDefault : existing.openSubStatusDefault;
    const newHoldReason = data.holdReason !== undefined ? data.holdReason : existing.holdReason;
    if (newSubStatus === "on_hold" && !newHoldReason) {
      throw createError(400, "holdReason is required when openSubStatusDefault is on_hold");
    }

    // Validate weekly recurrence has daysOfWeek
    const newKind = data.recurrenceKind ?? existing.recurrenceKind;
    const newDaysOfWeek = data.daysOfWeek !== undefined ? data.daysOfWeek : existing.daysOfWeek;
    if (newKind === "weekly" && (!newDaysOfWeek || newDaysOfWeek.length === 0)) {
      throw createError(400, "daysOfWeek is required for weekly recurrence");
    }

    const updated = await recurringJobsRepository.updateTemplate(
      companyId,
      templateId,
      data
    );

    if (!updated) {
      throw createError(404, "Recurring template not found");
    }

    res.json(updated);
  })
);

/**
 * DELETE /api/recurring-templates/:id
 * Deactivate a recurring job template (soft delete)
 *
 * Use ?hard=true for permanent deletion
 *
 * Requires: owner, admin, or dispatcher role
 */
router.delete(
  "/:id",
  requireAuth,
  requireRole(SCHEDULING_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const templateId = req.params.id;
    const hardDelete = req.query.hard === "true";

    let success: boolean;

    if (hardDelete) {
      success = await recurringJobsRepository.deleteTemplate(companyId, templateId);
    } else {
      success = await recurringJobsRepository.deactivateTemplate(companyId, templateId);
    }

    if (!success) {
      throw createError(404, "Recurring template not found");
    }

    res.status(204).send();
  })
);

// ============================================================================
// Preview / Dry Run
// ============================================================================

/**
 * GET /api/recurring-templates/preview
 * Preview generation without creating jobs (dry run)
 *
 * Query params:
 * - windowDays: number (default 45)
 *
 * Returns counts of what would be generated without actually generating.
 */
router.get(
  "/preview",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const windowDays = req.query.windowDays
      ? parseInt(String(req.query.windowDays), 10)
      : 45;

    if (isNaN(windowDays) || windowDays < 1 || windowDays > 365) {
      throw createError(400, "windowDays must be between 1 and 365");
    }

    const result = await previewGeneration(companyId, windowDays);

    res.json(result);
  })
);

// ============================================================================
// Generation
// ============================================================================

/**
 * POST /api/recurring-templates/generate
 * Generate job instances for all active templates
 *
 * Query params:
 * - windowDays: number (default 45)
 *
 * Requires: owner, admin, or dispatcher role
 */
router.post(
  "/generate",
  requireAuth,
  requireRole(SCHEDULING_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const windowDays = req.query.windowDays
      ? parseInt(String(req.query.windowDays), 10)
      : 45;

    if (isNaN(windowDays) || windowDays < 1 || windowDays > 365) {
      throw createError(400, "windowDays must be between 1 and 365");
    }

    const result = await generateInstances(companyId, windowDays);

    res.json(result);
  })
);

/**
 * POST /api/recurring-templates/:id/generate
 * Generate job instances for a single template
 *
 * Query params:
 * - windowDays: number (default 45)
 *
 * Requires: owner, admin, or dispatcher role
 */
router.post(
  "/:id/generate",
  requireAuth,
  requireRole(SCHEDULING_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const templateId = req.params.id;
    const windowDays = req.query.windowDays
      ? parseInt(String(req.query.windowDays), 10)
      : 45;

    if (isNaN(windowDays) || windowDays < 1 || windowDays > 365) {
      throw createError(400, "windowDays must be between 1 and 365");
    }

    const result = await generateForSingleTemplate(companyId, templateId, windowDays);

    if (result.errors.length > 0 && result.templatesProcessed === 0) {
      throw createError(400, result.errors[0]);
    }

    res.json(result);
  })
);

// ============================================================================
// Instance Management
// ============================================================================

/**
 * POST /api/recurring-templates/instances/:id/cancel
 * Cancel a pending instance
 *
 * Requires: owner, admin, or dispatcher role
 */
router.post(
  "/instances/:id/cancel",
  requireAuth,
  requireRole(SCHEDULING_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const instanceId = req.params.id;

    const instance = await recurringJobsRepository.cancelInstance(
      companyId,
      instanceId
    );

    if (!instance) {
      throw createError(404, "Instance not found");
    }

    res.json(instance);
  })
);

/**
 * POST /api/recurring-templates/instances/:id/skip
 * Skip a pending instance
 *
 * Requires: owner, admin, or dispatcher role
 */
router.post(
  "/instances/:id/skip",
  requireAuth,
  requireRole(SCHEDULING_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const instanceId = req.params.id;

    const instance = await recurringJobsRepository.skipInstance(
      companyId,
      instanceId
    );

    if (!instance) {
      throw createError(404, "Instance not found");
    }

    res.json(instance);
  })
);

export default router;
