import { Router } from "express";
import type { Request, Response } from "express";
import { storage } from "../storage/index";

// Note: requireAuth and ensureTenantContext middleware already applied globally in routes/index.ts
const router = Router();

// ========================================
// VALIDATION SCHEMAS
// ========================================

const createPartSchema = z.object({
  partNumber: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  unitPrice: z.number().min(0).max(999999.99).optional(),
  quantityOnHand: z.number().int().min(0).optional().default(0),
  reorderPoint: z.number().int().min(0).optional(),
  preferredVendor: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
});

const updatePartSchema = createPartSchema.partial();

router.get("/", async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId;
    if (!companyId) return res.status(401).json({ error: "Unauthorized" });

    const q = String((req.query as any)?.q ?? "").trim();
    const rows = await storage.getParts(companyId, q || undefined);
    return res.json(rows ?? []);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Failed to load parts" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId;
    if (!companyId) return res.status(401).json({ error: "Unauthorized" });

    const validation = createPartSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.errors 
      });
    }

    const created = await storage.createPart(companyId, validation.data);
    return res.json(created);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Failed to create part" });
  }
});

router.put("/:id", async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId;
    if (!companyId) return res.status(401).json({ error: "Unauthorized" });

    const validation = updatePartSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.errors 
      });
    }

    const updated = await storage.updatePart(companyId, req.params.id, validation.data);
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Failed to update part" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId;
    if (!companyId) return res.status(401).json({ error: "Unauthorized" });

    const result = await storage.deletePart(companyId, req.params.id);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Failed to delete part" });
  }
});

export default router;
