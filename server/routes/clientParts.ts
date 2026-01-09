import { Router } from "express";
import type { Request, Response } from "express";
import { storage } from "../storage/index";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";

const router = Router();

// Bulk endpoint expected by frontend: POST /api/client-parts/bulk
// Note: requireAuth and ensureTenantContext middleware already applied globally in routes/index.ts
router.post("/bulk", requireRole(MANAGER_ROLES), async (req: Request, res: Response) => {
  const companyId = req.companyId;
  const userId = req.user?.id;
  if (!companyId || !userId) return res.status(401).json({ error: "Unauthorized" });
  const items = Array.isArray(req.body) ? req.body : (req.body?.items ?? []);
  const result = await storage.upsertClientPartsBulk(companyId, userId, items);
  res.json(result);
});

export default router;
