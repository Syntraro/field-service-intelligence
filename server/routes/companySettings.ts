import { Router } from "express";
import type { Request, Response } from "express";
import { storage } from "../storage/index";

// Note: requireAuth and ensureTenantContext middleware already applied globally in routes/index.ts
const router = Router();

router.get("/", async (req: Request, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) return res.status(401).json({ error: "Unauthorized" });
  const settings = await storage.getCompanySettings(companyId);
  res.json(settings ?? {});
});

router.put("/", async (req: Request, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) return res.status(401).json({ error: "Unauthorized" });
  const settings = await storage.upsertCompanySettings(companyId, req.body ?? {});
  res.json(settings ?? {});
});

export default router;
