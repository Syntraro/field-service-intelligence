import { Router } from "express";
import type { Request, Response } from "express";
import { storage } from "../storage/index";

// Note: requireAuth and ensureTenantContext middleware already applied globally in routes/index.ts
const router = Router();

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

    const created = await storage.createPart(companyId, req.body);
    return res.json(created);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Failed to create part" });
  }
});

router.put("/:id", async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId;
    if (!companyId) return res.status(401).json({ error: "Unauthorized" });

    const updated = await storage.updatePart(companyId, req.params.id, req.body);
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
