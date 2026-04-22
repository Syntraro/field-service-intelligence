/**
 * Reference Fields Routes — Canonical API surface for field definitions and per-entity values.
 *
 * 2026-04-10: Created as part of controlled reference fields system (Phase 4).
 * Single dedicated route module — no per-entity route duplication.
 *
 * Mount: /api/reference-fields
 *
 * Endpoints:
 *   A. Definition management (admin/settings)
 *     GET    /                              — list definitions
 *     POST   /                              — create definition
 *     PATCH  /:definitionId                 — update definition (mutable fields only)
 *     POST   /:definitionId/deactivate      — deactivate definition
 *
 *   B. Per-entity field/value retrieval + save
 *     GET    /entities/:entityType/:entityId — get fields + values for entity
 *     PUT    /entities/:entityType/:entityId — replace-all save for entity values
 */

import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { RESTRICTED_MANAGER_ROLES, MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import type { AuthedRequest } from "../auth/tenantIsolation";
import {
  insertReferenceFieldDefinitionSchema,
  updateReferenceFieldDefinitionSchema,
  referenceFieldEntityTypeEnum,
} from "@shared/schema";
import * as service from "../services/referenceFieldsService";

const router = Router();

// ============================================================================
// Route-level validation schemas
// ============================================================================

const entityTypeParam = z.enum(referenceFieldEntityTypeEnum);

const saveValuesBodySchema = z.object({
  values: z.array(z.object({
    fieldDefinitionId: z.string().uuid(),
    textValue: z.string().nullable().optional(),
  })),
}).strict();

// ============================================================================
// A. Definition Management (admin/settings — restricted manager roles)
// ============================================================================

/**
 * GET /api/reference-fields
 * List definitions for current tenant. Optional filters: active, entityType.
 */
router.get(
  "/",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;

    const options: { activeOnly?: boolean; entityType?: any } = {};
    if (req.query.active === "true") options.activeOnly = true;
    if (req.query.active === "false") options.activeOnly = false;
    if (req.query.entityType) {
      const parsed = entityTypeParam.safeParse(req.query.entityType);
      if (!parsed.success) throw createError(400, "Invalid entityType. Must be one of: job, quote, invoice, customer_company, client_location, item.");
      options.entityType = parsed.data;
    }

    const definitions = await service.listDefinitions(companyId, options);
    res.json({ definitions });
  }),
);

/**
 * POST /api/reference-fields
 * Create a new field definition.
 */
router.post(
  "/",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const validated = validateSchema(insertReferenceFieldDefinitionSchema, req.body);

    const definition = await service.createDefinition(companyId, validated);
    res.status(201).json({ definition });
  }),
);

/**
 * PATCH /api/reference-fields/:definitionId
 * Update mutable fields on an existing definition. Key and type are immutable.
 */
router.patch(
  "/:definitionId",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { definitionId } = req.params;
    const validated = validateSchema(updateReferenceFieldDefinitionSchema, req.body);

    const definition = await service.updateDefinition(companyId, definitionId, validated);
    res.json({ definition });
  }),
);

/**
 * POST /api/reference-fields/:definitionId/deactivate
 * Deactivate a definition. Preserves historical values.
 */
router.post(
  "/:definitionId/deactivate",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { definitionId } = req.params;

    const definition = await service.deactivateDefinition(companyId, definitionId);
    res.json({ definition });
  }),
);

// ============================================================================
// B. Per-Entity Field/Value Retrieval + Save (manager roles — matches job/quote/invoice access)
// ============================================================================

/**
 * GET /api/reference-fields/entities/:entityType/:entityId
 * Get all applicable fields + current values for an entity.
 */
// 2026-04-10: No role restriction on entity field READ — matches job/quote/invoice
// detail GET endpoints which are accessible to all authenticated users.
router.get(
  "/entities/:entityType/:entityId",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { entityType, entityId } = req.params;

    // Validate entityType
    const parsedType = entityTypeParam.safeParse(entityType);
    if (!parsedType.success) throw createError(400, "Invalid entityType. Must be one of: job, quote, invoice, customer_company, client_location, item.");

    const entityFields = await service.getEntityFields(companyId, parsedType.data, entityId);

    // Shape response for UI consumption
    const fields = entityFields.map((ef) => ({
      definitionId: ef.definition.id,
      label: ef.definition.label,
      key: ef.definition.key,
      type: ef.definition.type,
      searchable: ef.definition.searchable,
      active: ef.definition.active,
      displayOrder: ef.definition.displayOrder,
      appliesToJobs: ef.definition.appliesToJobs,
      appliesToQuotes: ef.definition.appliesToQuotes,
      appliesToInvoices: ef.definition.appliesToInvoices,
      appliesToCustomers: ef.definition.appliesToCustomers,
      appliesToLocations: ef.definition.appliesToLocations,
      appliesToProducts: ef.definition.appliesToProducts,
      textValue: ef.value?.textValue ?? null,
    }));

    res.json({ entityType: parsedType.data, entityId, fields });
  }),
);

/**
 * PUT /api/reference-fields/entities/:entityType/:entityId
 * Replace-all save of field values for an entity.
 * Returns refreshed state after save.
 */
router.put(
  "/entities/:entityType/:entityId",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { entityType, entityId } = req.params;

    // Validate entityType
    const parsedType = entityTypeParam.safeParse(entityType);
    if (!parsedType.success) throw createError(400, "Invalid entityType. Must be one of: job, quote, invoice, customer_company, client_location, item.");

    const body = validateSchema(saveValuesBodySchema, req.body);

    // Map to service shape
    const submittedValues = body.values.map((v) => ({
      fieldDefinitionId: v.fieldDefinitionId,
      textValue: v.textValue,
    }));

    await service.saveEntityValues(companyId, parsedType.data, entityId, submittedValues);

    // Return refreshed state
    const entityFields = await service.getEntityFields(companyId, parsedType.data, entityId);
    const fields = entityFields.map((ef) => ({
      definitionId: ef.definition.id,
      label: ef.definition.label,
      key: ef.definition.key,
      type: ef.definition.type,
      searchable: ef.definition.searchable,
      active: ef.definition.active,
      displayOrder: ef.definition.displayOrder,
      appliesToJobs: ef.definition.appliesToJobs,
      appliesToQuotes: ef.definition.appliesToQuotes,
      appliesToInvoices: ef.definition.appliesToInvoices,
      appliesToCustomers: ef.definition.appliesToCustomers,
      appliesToLocations: ef.definition.appliesToLocations,
      appliesToProducts: ef.definition.appliesToProducts,
      textValue: ef.value?.textValue ?? null,
    }));

    res.json({ entityType: parsedType.data, entityId, fields });
  }),
);

export default router;
