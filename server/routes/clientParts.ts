import { Router } from "express";
import type { Request, Response } from "express";
import { storage } from "../storage/index";
import { requireRole } from "../auth/requireRole";

const router = Router();

const MANAGER_ROLES = ["owner", "admin", "manager", "dispatcher"];

// Bulk endpoint expected by frontend: POST /api/client-parts/bulk
// Note: requireAuth and ensureTenantContext middleware already applied globally in routes/index.ts
router.post("/bulk", requireRole(MANAGER_ROLES), async (req: Request, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) return res.status(401).json({ error: "Unauthorized" });
  const items = Array.isArray(req.body) ? req.body : (req.body?.items ?? []);
  const result = await storage.upsertClientPartsBulk(companyId, items);
  res.json(result);
});

export default router;
