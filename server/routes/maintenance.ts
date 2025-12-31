import { Router } from "express";
import type { Request, Response } from "express";
import { storage } from "../storage/index";

// Note: requireAuth and ensureTenantContext middleware already applied globally in routes/index.ts
const router = Router();

router.get("/recently-completed", async (req: Request, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) return res.status(401).json({ error: "Unauthorized" });
  const limit = Number((req.query as any)?.limit ?? 50);
  const rows = await storage.getMaintenanceRecentlyCompleted(companyId, Number.isFinite(limit) ? limit : 50);
  res.json(rows);
});

router.get("/statuses", async (req: Request, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) return res.status(401).json({ error: "Unauthorized" });
  const rows = await storage.getMaintenanceStatuses(companyId);
  res.json(rows);
});

export default router;
