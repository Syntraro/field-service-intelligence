import { Router } from "express";
import type { Request, Response } from "express";
import { storage } from "../storage/index";
import { asyncHandler, createError } from "../middleware/errorHandler";

const router = Router();

// Note: This file only has GET routes, no POST/PUT/PATCH
// No validation needed for GET routes

router.get("/usage", asyncHandler(async (req: Request, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) {
    throw createError(401, "Unauthorized");
  }
  const usage = await storage.getSubscriptionUsage(companyId);
  res.json(usage);
}));

router.get("/can-add-location", asyncHandler(async (req: Request, res: Response) => {
  const companyId = req.companyId;
  if (!companyId) {
    throw createError(401, "Unauthorized");
  }
  const result = await storage.canAddLocation(companyId);
  res.json(result);
}));

export default router;
