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
import {
  buildPreviewSampleData,
} from "../services/templateDataBuilder";
import { renderTemplate } from "../services/templateRenderer";

const router = Router();

const paramsSchema = z.object({
  entityType: z.enum(communicationTemplateEntityTypeEnum),
  channel: z.enum(communicationTemplateChannelEnum),
});

/**
 * GET /api/communication-templates/:entityType/:channel
 *
 * Always returns a template shape. If a tenant row exists, returns it with
 * `isDefault: false`. Otherwise returns the canonical system default (from
 * `communicationTemplatesService.getDefaultTemplate`) with `isDefault: true`
 * — Settings UI is guaranteed a populated subject + body and never has to
 * render an empty "No subject / No body" state.
 *
 * When no default exists for the tuple (e.g. any SMS channel today), returns
 * 404 so callers can distinguish "fully unsupported" from "using default".
 */
router.get(
  "/:entityType/:channel",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId;
    if (!tenantId) throw createError(401, "Unauthorized");

    const { entityType, channel } = validateSchema(paramsSchema, req.params);
    const tenantRow = await communicationTemplatesService.getTemplate(tenantId, entityType, channel);
    if (tenantRow) {
      res.json({ ...tenantRow, isDefault: false });
      return;
    }

    const fallback = communicationTemplatesService.getDefaultTemplate(entityType, channel);
    if (!fallback) throw createError(404, "Template not found");

    res.json({
      id: null,
      tenantId,
      entityType,
      channel,
      subjectTemplate: fallback.subjectTemplate ?? null,
      bodyTemplate: fallback.bodyTemplate,
      isActive: true,
      isDefault: true,
      createdAt: null,
      updatedAt: null,
    });
  }),
);

/**
 * POST /api/communication-templates/preview/:entityType
 *
 * Preview-only renderer for the Settings editor. Accepts ad-hoc
 * `{ subjectTemplate, bodyTemplate }` in the body and renders them through
 * the canonical `templateRenderer` against a fixed sample-data dictionary.
 * Never touches real entities or send flows. Used exclusively by the
 * Settings UI's live preview pane.
 */
const previewParamsSchema = z.object({
  entityType: z.enum(communicationTemplateEntityTypeEnum),
});
const previewBodySchema = z.object({
  subjectTemplate: z.string().max(500).nullable().optional(),
  bodyTemplate: z.string().max(20000),
});

router.post(
  "/preview/:entityType",
  requireRole(RESTRICTED_MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId;
    if (!tenantId) throw createError(401, "Unauthorized");

    const { entityType } = validateSchema(previewParamsSchema, req.params);
    const { subjectTemplate, bodyTemplate } = validateSchema(previewBodySchema, req.body ?? {});

    const sample = buildPreviewSampleData(entityType);
    const rendered = renderTemplate(
      { subjectTemplate: subjectTemplate ?? null, bodyTemplate },
      sample,
    );
    res.json({ subject: rendered.subject, body: rendered.body, sample });
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
  requireRole(RESTRICTED_MANAGER_ROLES),
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
  requireRole(RESTRICTED_MANAGER_ROLES),
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
  requireRole(RESTRICTED_MANAGER_ROLES),
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
