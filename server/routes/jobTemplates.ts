import { Router, Response } from "express";
import { storage } from "../storage/index";
import { insertJobTemplateSchema, insertJobTemplateLineItemSchema } from "@shared/schema";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { parsePaginationLenient, applyOffsetPagination } from "../utils/pagination";
import { paginatedCompat } from "../utils/paginatedResponse";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";

const router = Router();

/**
 * Lightweight validators (non-breaking).
 * We keep your existing behavior, but validate obvious required fields.
 */
const idSchema = z.string().min(1);
const jobTypeSchema = z.string().min(1);

router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const { params, explicit } = parsePaginationLenient(req.query);
  const { jobType, activeOnly } = req.query;

  // Preserve original semantics:
  // activeOnly defaults true unless explicitly "false"
  const filter = {
    jobType: typeof jobType === "string" ? jobType : undefined,
    activeOnly: activeOnly === "false" ? false : true,
  };

  const allTemplates = await storage.getJobTemplates(companyId, filter);

  // Apply pagination
  const offset = params.offset ?? 0;
  const { items, meta } = applyOffsetPagination(allTemplates, offset, params.limit);

  res.json(paginatedCompat(items, meta, explicit));
}));

router.get("/:id", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const idParsed = idSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    throw createError(400, "Invalid template id");
  }

  const template = await storage.getJobTemplate(companyId, idParsed.data);
  if (!template) {
    throw createError(404, "Template not found");
  }

  const lines = await storage.getJobTemplateLineItems(template.id);
  res.json({ ...template, lines });
}));

const createTemplateSchema = insertJobTemplateSchema.extend({
  lines: z.array(insertJobTemplateLineItemSchema.omit({ templateId: true })).optional().default([]),
}).strict();

router.post("/", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const parsed = validateSchema(createTemplateSchema, req.body);

  const { lines, ...templateData } = parsed;

  const template = await storage.createJobTemplate(companyId, templateData, lines);

  const createdLines = await storage.getJobTemplateLineItems(template.id);
  res.status(201).json({ ...template, lines: createdLines });
}));

const updateTemplateSchema = insertJobTemplateSchema.partial().extend({
  lines: z.array(insertJobTemplateLineItemSchema.omit({ templateId: true })).optional(),
}).strict();

router.patch("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const idParsed = idSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    throw createError(400, "Invalid template id");
  }

  const parsed = validateSchema(updateTemplateSchema, req.body);

  const { lines, ...templateData } = parsed;

  const template = await storage.updateJobTemplate(companyId, idParsed.data, templateData, lines);

  if (!template) {
    throw createError(404, "Template not found");
  }

  const updatedLines = await storage.getJobTemplateLineItems(template.id);
  res.json({ ...template, lines: updatedLines });
}));

router.delete("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const idParsed = idSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    throw createError(400, "Invalid template id");
  }

  const deleted = await storage.deleteJobTemplate(companyId, idParsed.data);
  if (!deleted) {
    throw createError(404, "Template not found");
  }

  // Preserve original behavior: 204 no content
  res.status(204).send();
}));

router.post("/:id/set-default", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const idParsed = idSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    throw createError(400, "Invalid template id");
  }

  const { jobType } = req.body;
  const jobTypeParsed = jobTypeSchema.safeParse(jobType);
  if (!jobTypeParsed.success) {
    throw createError(400, "jobType is required");
  }

  const template = await storage.setJobTemplateAsDefault(companyId, idParsed.data, jobTypeParsed.data);
  if (!template) {
    throw createError(404, "Template not found");
  }

  res.json(template);
}));

const applyToJobSchema = z.object({
  jobId: z.string().min(1),
  templateId: z.string().min(1),
}).strict();

router.post("/apply-to-job", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const { jobId, templateId } = validateSchema(applyToJobSchema, req.body);

  const createdParts = await storage.applyJobTemplateToJob(companyId, jobId, templateId);
  res.status(201).json(createdParts);
}));

router.get("/default/:jobType", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const jobTypeParsed = jobTypeSchema.safeParse(req.params.jobType);
  if (!jobTypeParsed.success) {
    throw createError(400, "Invalid jobType");
  }

  const template = await storage.getDefaultJobTemplateForJobType(companyId, jobTypeParsed.data);
  if (!template) {
    throw createError(404, "No default template for this job type");
  }

  const lines = await storage.getJobTemplateLineItems(template.id);
  res.json({ ...template, lines });
}));

router.post("/:id/clone", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const idParsed = idSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    throw createError(400, "Invalid template id");
  }

  const clonedTemplate = await storage.cloneJobTemplate(companyId, idParsed.data);
  if (!clonedTemplate) {
    throw createError(404, "Template not found");
  }

  const lines = await storage.getJobTemplateLineItems(clonedTemplate.id);
  res.status(201).json({ ...clonedTemplate, lines });
}));

export default router;
