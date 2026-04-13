/**
 * Communication Templates — routes (Phase 1, 2026-04-12).
 *
 * Thin controller. Validates input, resolves tenantId from auth, delegates
 * to the service. No DB access, no rendering. Per the Phase 1 brief:
 *   - tenantId NEVER comes from the client
 *   - no rendering, no defaults, no preview, no send wiring here
 */

import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { RESTRICTED_MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import {
  communicationTemplateChannelEnum,
  communicationTemplateEntityTypeEnum,
  upsertCommunicationTemplateSchema,
} from "@shared/schema";
import { communicationTemplatesService } from "../services/communicationTemplatesService";

const router = Router();

const MANAGER_ROLES = RESTRICTED_MANAGER_ROLES;

const paramsSchema = z.object({
  entityType: z.enum(communicationTemplateEntityTypeEnum),
  channel: z.enum(communicationTemplateChannelEnum),
});

/**
 * GET /api/communication-templates/:entityType/:channel
 * Returns the tenant's template or 404 if none exists.
 */
router.get(
  "/:entityType/:channel",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId;
    if (!tenantId) throw createError(401, "Unauthorized");

    const { entityType, channel } = validateSchema(paramsSchema, req.params);
    const template = await communicationTemplatesService.getTemplate(tenantId, entityType, channel);
    if (!template) {
      throw createError(404, "Template not found");
    }
    res.json(template);
  }),
);

/**
 * POST /api/communication-templates
 * Upsert the tenant's template for (entityType, channel). Overwrites existing.
 *
 * Payload (canonical camelCase):
 *   {
 *     entityType: "invoice" | "quote" | "job",
 *     channel:    "email" | "sms",
 *     subjectTemplate?: string | null,
 *     bodyTemplate:    string,
 *     isActive?: boolean
 *   }
 *
 * snake_case keys accepted on the wire as well (entity_type, channel,
 * subject_template, body_template, is_active) for caller ergonomics.
 */
router.post(
  "/",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId;
    if (!tenantId) throw createError(401, "Unauthorized");

    // Accept either camelCase (canonical) or snake_case (as per the brief's payload example).
    const raw = req.body ?? {};
    const normalized = {
      entityType: raw.entityType ?? raw.entity_type,
      channel: raw.channel,
      subjectTemplate: raw.subjectTemplate ?? raw.subject_template ?? null,
      bodyTemplate: raw.bodyTemplate ?? raw.body_template,
      isActive: raw.isActive ?? raw.is_active,
    };

    const validated = validateSchema(upsertCommunicationTemplateSchema, normalized);

    const saved = await communicationTemplatesService.upsertTemplate({
      tenantId,
      entityType: validated.entityType,
      channel: validated.channel,
      subjectTemplate: validated.subjectTemplate ?? null,
      bodyTemplate: validated.bodyTemplate,
      isActive: validated.isActive,
    });

    res.json(saved);
  }),
);

// 2026-04-12: also accept PUT on the same collection endpoint since the brief
// lists it as "POST/PUT". Upsert semantics are identical.
router.put(
  "/",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId;
    if (!tenantId) throw createError(401, "Unauthorized");

    const raw = req.body ?? {};
    const normalized = {
      entityType: raw.entityType ?? raw.entity_type,
      channel: raw.channel,
      subjectTemplate: raw.subjectTemplate ?? raw.subject_template ?? null,
      bodyTemplate: raw.bodyTemplate ?? raw.body_template,
      isActive: raw.isActive ?? raw.is_active,
    };
    const validated = validateSchema(upsertCommunicationTemplateSchema, normalized);

    const saved = await communicationTemplatesService.upsertTemplate({
      tenantId,
      entityType: validated.entityType,
      channel: validated.channel,
      subjectTemplate: validated.subjectTemplate ?? null,
      bodyTemplate: validated.bodyTemplate,
      isActive: validated.isActive,
    });
    res.json(saved);
  }),
);

/**
 * DELETE /api/communication-templates/:entityType/:channel
 * Removes the tenant's template row, reverting to the system default
 * fallback. Returns 204 when a row was deleted, 404 when none existed.
 */
router.delete(
  "/:entityType/:channel",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId;
    if (!tenantId) throw createError(401, "Unauthorized");
    const { entityType, channel } = validateSchema(paramsSchema, req.params);
    const removed = await communicationTemplatesService.deleteTemplate(tenantId, entityType, channel);
    if (!removed) throw createError(404, "Template not found");
    res.status(204).end();
  }),
);

export default router;
