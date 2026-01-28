import { Router } from "express";
import type { Response } from "express";
import { storage } from "../storage/index";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { RESTRICTED_MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";

// Note: requireAuth and ensureTenantContext middleware already applied globally in routes/index.ts
const router = Router();

const MANAGER_ROLES = RESTRICTED_MANAGER_ROLES;

// ========================================
// VALIDATION SCHEMAS
// ========================================

const updateCompanySettingsSchema = z.object({
  companyName: z.string().min(1).max(200).optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  provinceState: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  email: z.string().email().max(255).optional().or(z.literal("")),
  phone: z.string().max(30).optional(),
  timezone: z.string().max(100).optional(),
  currency: z.string().length(3).optional(),
  defaultTaxRate: z.number().min(0).max(1).optional(),
  businessHours: z.object({
    monday: z.object({ start: z.string(), end: z.string() }).optional(),
    tuesday: z.object({ start: z.string(), end: z.string() }).optional(),
    wednesday: z.object({ start: z.string(), end: z.string() }).optional(),
    thursday: z.object({ start: z.string(), end: z.string() }).optional(),
    friday: z.object({ start: z.string(), end: z.string() }).optional(),
    saturday: z.object({ start: z.string(), end: z.string() }).optional(),
    sunday: z.object({ start: z.string(), end: z.string() }).optional(),
  }).optional(),
  invoiceSettings: z.object({
    defaultTermsDays: z.number().int().min(0).max(365).optional(),
    showCompanyLogo: z.boolean().optional(),
    footer: z.string().max(500).optional(),
  }).optional(),
  calendarStartHour: z.number().int().min(0).max(23).optional(),
  // Regional display preferences
  dateFormat: z.enum(["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"]).optional(),
  timeFormat: z.enum(["12h", "24h"]).optional(),
  weekStartsOn: z.enum(["monday", "sunday"]).optional(),
  // Invoice payment terms default
  defaultPaymentTermsDays: z.number().int().min(0).max(365).optional(),
});

router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) throw createError(401, "Unauthorized");
  const settings = await storage.getCompanySettings(companyId);
  res.json(settings ?? {});
}));

// Handler for both PUT and POST (upsert)
const handleUpsertSettings = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const userId = req.user?.id;
  if (!companyId || !userId) throw createError(401, "Unauthorized");

  const validation = updateCompanySettingsSchema.safeParse(req.body);
  if (!validation.success) {
    const errors = validation.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw createError(400, `Validation failed: ${errors}`);
  }

  const settings = await storage.upsertCompanySettings(companyId, userId, validation.data ?? {});
  res.json(settings ?? {});
});

router.put("/", requireRole(MANAGER_ROLES), handleUpsertSettings);
router.post("/", requireRole(MANAGER_ROLES), handleUpsertSettings);

export default router;