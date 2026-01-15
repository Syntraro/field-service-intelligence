import { Router, Response } from "express";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import { quoteTemplateRepository } from "../storage/quoteTemplates";

const router = Router();

// ========================================
// VALIDATION SCHEMAS
// ========================================

const createQuoteTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  isDefault: z.boolean().optional().default(false),
  lines: z.array(z.object({
    productId: z.string().nullable().optional(),
    description: z.string().min(1).max(500),
    quantity: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().default("1"),
    unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().default("0.00"),
    sortOrder: z.number().int().min(0).optional(),
  })).optional().default([]),
}).strict();

const updateQuoteTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  isDefault: z.boolean().optional(),
  lines: z.array(z.object({
    productId: z.string().nullable().optional(),
    description: z.string().min(1).max(500),
    quantity: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().default("1"),
    unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().default("0.00"),
    sortOrder: z.number().int().min(0).optional(),
  })).optional(),
}).strict();

const applyToQuoteSchema = z.object({
  quoteId: z.string().uuid(),
  mode: z.enum(["replace", "merge"]).optional().default("replace"),
}).strict();

// ========================================
// ROUTES
// ========================================

// GET /api/quote-templates/list - List all quote templates
router.get("/list", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const activeOnly = req.query.activeOnly !== "false";

  const templates = await quoteTemplateRepository.listQuoteTemplates(req.companyId!, {
    activeOnly,
  });

  res.json(templates);
}));

// GET /api/quote-templates/default - Get default template
router.get("/default", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const template = await quoteTemplateRepository.getDefaultQuoteTemplate(req.companyId!);
  res.json(template);
}));

// GET /api/quote-templates/:id - Get single quote template
router.get("/:id", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const template = await quoteTemplateRepository.getQuoteTemplate(req.companyId!, req.params.id);
  if (!template) throw createError(404, "Quote template not found");
  res.json(template);
}));

// POST /api/quote-templates - Create a new quote template
router.post("/", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const validated = validateSchema(createQuoteTemplateSchema, req.body);
  const { lines, ...templateData } = validated;

  const template = await quoteTemplateRepository.createQuoteTemplate(
    req.companyId!,
    templateData,
    lines
  );

  res.status(201).json(template);
}));

// PATCH /api/quote-templates/:id - Update a quote template
router.patch("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const validated = validateSchema(updateQuoteTemplateSchema, req.body);
  const { lines, ...templateData } = validated;

  const template = await quoteTemplateRepository.updateQuoteTemplate(
    req.companyId!,
    req.params.id,
    templateData,
    lines
  );

  if (!template) {
    throw createError(404, "Quote template not found");
  }

  res.json(template);
}));

// DELETE /api/quote-templates/:id - Soft delete a quote template
router.delete("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const deleted = await quoteTemplateRepository.deleteQuoteTemplate(req.companyId!, req.params.id);

  if (!deleted) {
    throw createError(404, "Quote template not found");
  }

  res.json({ success: true });
}));

// POST /api/quote-templates/:id/clone - Clone a quote template
router.post("/:id/clone", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const cloned = await quoteTemplateRepository.cloneQuoteTemplate(req.companyId!, req.params.id);

  if (!cloned) {
    throw createError(404, "Quote template not found");
  }

  res.status(201).json(cloned);
}));

// POST /api/quote-templates/:id/set-default - Set as default template
router.post("/:id/set-default", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const template = await quoteTemplateRepository.setQuoteTemplateAsDefault(req.companyId!, req.params.id);

  if (!template) {
    throw createError(404, "Quote template not found");
  }

  res.json(template);
}));

// POST /api/quote-templates/:id/toggle-active - Toggle active status
router.post("/:id/toggle-active", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);

  const template = await quoteTemplateRepository.toggleQuoteTemplateActive(
    req.companyId!,
    req.params.id,
    isActive
  );

  if (!template) {
    throw createError(404, "Quote template not found");
  }

  res.json(template);
}));

// POST /api/quote-templates/:id/apply - Apply template to a quote
router.post("/:id/apply", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const validated = validateSchema(applyToQuoteSchema, req.body);

  const result = await quoteTemplateRepository.applyQuoteTemplateToQuote(
    req.companyId!,
    validated.quoteId,
    req.params.id,
    validated.mode
  );

  res.json(result);
}));

export default router;
