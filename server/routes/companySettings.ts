import { Router } from "express";
import type { Response } from "express";
import { storage } from "../storage/index";
import { z } from "zod";
import { postalCodeSchema } from "@shared/schema";
import { requireRole } from "../auth/requireRole";
import { RESTRICTED_MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";

// Note: requireAuth and ensureTenantContext middleware already applied globally in routes/index.ts
const router = Router();

// ========================================
// VALIDATION SCHEMAS
// ========================================

const updateCompanySettingsSchema = z.object({
  companyName: z.string().min(1).max(200).optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  provinceState: z.string().max(100).optional(),
  postalCode: postalCodeSchema,
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
  // Expose timezoneConfirmed as a boolean for the frontend onboarding gate
  const raw = (settings ?? {}) as Record<string, unknown>;
  res.json({
    ...raw,
    timezoneConfirmed: Boolean(raw.timezoneConfirmedAt),
  });
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

  const payload: Record<string, unknown> = { ...(validation.data ?? {}) };
  // Auto-stamp timezoneConfirmedAt when timezone is explicitly set
  if (payload.timezone) {
    payload.timezoneConfirmedAt = new Date();
  }
  const settings = await storage.upsertCompanySettings(companyId, userId, payload);
  const raw = (settings ?? {}) as Record<string, unknown>;
  res.json({
    ...raw,
    timezoneConfirmed: Boolean(raw.timezoneConfirmedAt),
  });
});

router.put("/", requireRole(RESTRICTED_MANAGER_ROLES), handleUpsertSettings);
router.post("/", requireRole(RESTRICTED_MANAGER_ROLES), handleUpsertSettings);

export default router;