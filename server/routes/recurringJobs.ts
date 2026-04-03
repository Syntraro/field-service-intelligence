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
  generateFromInstances,
  previewGeneration,
  computeOccurrenceDates,
  getCompanyToday,
  formatDateString,
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
 * - type: "pm" | "recurring_job" (optional — filters by jobType server-side)
 */
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const activeOnly = req.query.activeOnly === "true";
    const type = req.query.type as "pm" | "recurring_job" | undefined;

    const templates = await recurringJobsRepository.getTemplates(companyId, {
      activeOnly,
      type: type === "pm" || type === "recurring_job" ? type : undefined,
    });

    // Compute nextOccurrence for each template using canonical recurrence domain logic.
    // computeOccurrenceDates is pure date math (no DB queries), safe to call per-template.
    const today = await getCompanyToday(companyId);
    const windowEnd = new Date(today);
    windowEnd.setFullYear(windowEnd.getFullYear() + 1); // 1-year lookahead

    const templatesWithNext = templates.map((t) => {
      if (!t.isActive) {
        return { ...t, nextOccurrence: null };
      }
      const occurrences = computeOccurrenceDates(t, today, windowEnd);
      return {
        ...t,
        nextOccurrence: occurrences.length > 0 ? formatDateString(occurrences[0]) : null,
      };
    });

    res.json(templatesWithNext);
  })
);

// ============================================================================
// PM Phase 3: Upcoming Planning Queue
// ============================================================================

/**
 * GET /api/recurring-templates/upcoming
 * Get the PM planning queue — upcoming instances with compliance status.
 *
 * Query params:
 * - from: YYYY-MM-DD (default: 30 days ago)
 * - to: YYYY-MM-DD (default: 90 days from now)
 * - statuses: comma-separated instance statuses to include (default: all)
 * - limit: number (default 200)
 * - offset: number (default 0)
 *
 * Returns UpcomingQueueItem[] with computed compliance status.
 */
router.get(
  "/upcoming",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;

    // Default date range: 30 days ago to 90 days from now
    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setDate(defaultFrom.getDate() - 30);
    const defaultTo = new Date(now);
    defaultTo.setDate(defaultTo.getDate() + 90);

    const from = req.query.from ? String(req.query.from) : defaultFrom.toISOString().split("T")[0];
    const to = req.query.to ? String(req.query.to) : defaultTo.toISOString().split("T")[0];
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 200;
    const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;
    const statuses = req.query.statuses ? String(req.query.statuses).split(",") : undefined;

    const items = await recurringJobsRepository.getUpcomingQueue(companyId, {
      from,
      to,
      statuses,
      limit,
      offset,
    });

    res.json(items);
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

    // PM scheduling cross-field validation
    if (data.generationMode === "day_of_month" && !data.generationDayOfMonth) {
      throw createError(400, "generationDayOfMonth is required when generationMode is day_of_month");
    }
    // Dedupe monthsOfYear if provided
    if (data.monthsOfYear) {
      data.monthsOfYear = data.monthsOfYear.filter((v, i, arr) => arr.indexOf(v) === i);
    }

    const template = await recurringJobsRepository.createTemplate(companyId, data);

    // PM create-month fix: On CREATE, immediately generate pending due instances
    // so a newly created PM contract that is already due for the current cycle
    // appears on the Dashboard without relying on the background scheduler or client call.
    // This is CREATE-only behavior; EDIT does NOT auto-generate (see Part 5 TODO below).
    if (template.isActive && template.locationId) {
      try {
        console.log(`[PM-CREATE] Generating instances for new template ${template.id}`, {
          generationMode: template.generationMode,
          monthsOfYear: template.monthsOfYear,
          startDate: template.startDate,
          jobType: template.jobType,
          locationId: template.locationId,
          isActive: template.isActive,
        });
        const genResult = await generateForSingleTemplate(companyId, template.id);
        console.log(`[PM-CREATE] Generation result for ${template.id}:`, genResult);
      } catch (genErr) {
        // Non-fatal: template was created successfully, generation can be retried
        console.error(`[recurringJobs] Post-create generation failed for ${template.id}:`, genErr);
      }
    } else {
      console.log(`[PM-CREATE] Skipping generation: isActive=${template.isActive}, locationId=${template.locationId}`);
    }

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

    // PM scheduling cross-field validation (merge with existing values)
    const effectiveGenMode = data.generationMode ?? existing.generationMode;
    const effectiveGenDay = data.generationDayOfMonth !== undefined ? data.generationDayOfMonth : existing.generationDayOfMonth;
    if (effectiveGenMode === "day_of_month" && !effectiveGenDay) {
      throw createError(400, "generationDayOfMonth is required when generationMode is day_of_month");
    }
    // Dedupe monthsOfYear if provided
    if (data.monthsOfYear) {
      data.monthsOfYear = data.monthsOfYear.filter((v, i, arr) => arr.indexOf(v) === i);
    }

    const updated = await recurringJobsRepository.updateTemplate(
      companyId,
      templateId,
      data
    );

    if (!updated) {
      throw createError(404, "Recurring template not found");
    }

    // TODO: If an edit makes the PM contract due for the current cycle (e.g. adding
    // the current month to monthsOfYear), we should NOT silently auto-generate instances.
    // Instead, the UI should prompt the user: "This contract is now due for the current
    // cycle. Generate a due instance?" This avoids surprising backfill behavior on edit.

    res.json(updated);
  })
);

/**
 * DELETE /api/recurring-templates/:id
 * Smart delete: hard-deletes if no downstream activity (no generated jobs),
 * otherwise archives (deactivate + cancel pending instances) to preserve job history.
 *
 * Use ?force=hard for forced permanent deletion regardless of activity.
 *
 * Returns 200 with { action, instancesCanceled } so the UI shows truthful messages.
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
    const forceHard = req.query.force === "hard";

    // Verify template exists
    const existing = await recurringJobsRepository.getTemplate(companyId, templateId);
    if (!existing) {
      throw createError(404, "Recurring template not found");
    }

    let action: "deleted" | "archived";
    let instancesCanceled = 0;

    if (forceHard) {
      // Forced hard delete — caller takes responsibility for data loss
      await recurringJobsRepository.deleteTemplate(companyId, templateId);
      action = "deleted";
    } else {
      // Smart delete: check for downstream activity (generated jobs)
      const hasActivity = await recurringJobsRepository.hasDownstreamActivity(companyId, templateId);

      if (hasActivity) {
        // Archive: deactivate + cancel all pending instances so they stop
        // appearing as actionable due items on the Dashboard
        const result = await recurringJobsRepository.deactivateTemplate(companyId, templateId);
        instancesCanceled = result.instancesCanceled;
        action = "archived";
      } else {
        // No generated jobs — safe to hard delete (cascade removes pending instances)
        await recurringJobsRepository.deleteTemplate(companyId, templateId);
        action = "deleted";
      }
    }

    res.json({ action, instancesCanceled });
  })
);

/**
 * POST /api/recurring-templates/:id/duplicate
 * Duplicate a recurring job template (PM Phase 2 - copy flow)
 *
 * Creates a paused copy with " (Copy)" suffix.
 * Requires: owner, admin, or dispatcher role
 */
router.post(
  "/:id/duplicate",
  requireAuth,
  requireRole(SCHEDULING_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const templateId = req.params.id;

    const copy = await recurringJobsRepository.duplicateTemplate(
      companyId,
      templateId
    );

    if (!copy) {
      throw createError(404, "Recurring template not found");
    }

    res.status(201).json(copy);
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
 * POST /api/recurring-templates/generate-selected
 * PM Pivot Phase 1: Generate jobs from selected pending PM instances.
 *
 * Body: { instanceIds: string[] }
 *
 * This is the canonical path for job creation in the PM pivot model.
 * Dispatchers select due instances from the PM queue and generate jobs manually.
 * Only processes instances in "pending" status. Concurrency-safe via atomic claim.
 *
 * Requires: owner, admin, or dispatcher role
 */
router.post(
  "/generate-selected",
  requireAuth,
  requireRole(SCHEDULING_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const schema = z.object({
      instanceIds: z.array(z.string().uuid()).min(1).max(100),
    });
    const { instanceIds } = validateSchema(schema, req.body);

    const result = await generateFromInstances(companyId, instanceIds);

    res.json(result);
  })
);

/**
 * POST /api/recurring-templates/generate
 * PM Pivot Phase 1: Create pending due instances for all active PM contracts.
 * Does NOT auto-create jobs — use generate-selected for manual job creation.
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
 * PM Pivot Phase 1: Create pending due instances for a single PM contract.
 * Does NOT auto-create jobs — use generate-selected for manual job creation.
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
