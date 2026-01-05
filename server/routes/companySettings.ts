import { Router } from "express";
import type { Request, Response } from "express";
import { storage } from "../storage/index";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { RESTRICTED_MANAGER_ROLES } from "../auth/roles";

// Note: requireAuth and ensureTenantContext middleware already applied globally in routes/index.ts
const router = Router();

const MANAGER_ROLES = RESTRICTED_MANAGER_ROLES;

// ========================================
// VALIDATION SCHEMAS
// ========================================

const updateCompanySettingsSchema = z.object({
  companyName: z.string().min(1).max(200).optional(),
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
}).passthrough(); // Allow other settings fields

router.get("/", async (req: Request, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) return res.status(401).json({ error: "Unauthorized" });
  const settings = await storage.getCompanySettings(companyId);
  res.json(settings ?? {});
});

router.put("/", requireRole(MANAGER_ROLES), async (req: Request, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) return res.status(401).json({ error: "Unauthorized" });
  
  const validation = updateCompanySettingsSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ 
      error: "Validation failed", 
      details: validation.error.errors 
    });
  }
  
  const settings = await storage.upsertCompanySettings(companyId, validation.data ?? {});
  res.json(settings ?? {});
});

export default router;