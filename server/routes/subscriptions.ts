import { Router } from "express";
import type { Request, Response } from "express";
import { storage } from "../storage/index";

const router = Router();

router.get("/usage", async (req: Request, res: Response) => {
  const companyId = req.companyId;
  const usage = await storage.getSubscriptionUsage(companyId);
  res.json(usage);
});

router.get("/can-add-location", async (req: Request, res: Response) => {
  const companyId = req.companyId;
  const result = await storage.canAddLocation(companyId);
  res.json(result);
});

export default router;