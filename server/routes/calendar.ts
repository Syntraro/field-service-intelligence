import express, { Request, Response } from "express";
import { z } from "zod";
import { resizeJobTime } from "../services/calendarService";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";

/**
 * Calendar API
 *
 * The frontend expects `calendarData.assignments` to always exist.
 * Even when there are no assignments, we must return:
 *   { assignments: [] }
 *
 * Note: this module currently provides "contract-first" responses so the UI doesn't crash.
 * You can evolve these handlers later to return real assignment data from the DB.
 */
const router = express.Router();

const resizeJobSchema = z.object({
  job: z.object({
    id: z.string().uuid(),
    scheduledStart: z.string().datetime(),
    scheduledEnd: z.string().datetime(),
  }).strict(), // Allow other job fields
  newEndTime: z.string().datetime(),
});

// Basic calendar payload used by Dashboard
router.get("/", asyncHandler(async (_req: Request, res: Response) => {
  res.json({ assignments: [] });
}));

// Common alias endpoint (some clients call /assignments)
router.get("/assignments", asyncHandler(async (_req: Request, res: Response) => {
  res.json({ assignments: [] });
}));

// Lists used by various calendar widgets; keep contract stable (array)
router.get("/unscheduled", asyncHandler(async (_req: Request, res: Response) => {
  res.json([]);
}));

router.get("/overdue", asyncHandler(async (_req: Request, res: Response) => {
  res.json([]);
}));

router.get("/old-unscheduled", asyncHandler(async (_req: Request, res: Response) => {
  res.json([]);
}));

// Resize job block on calendar (used for drag-to-extend)
router.post("/resize", requireRole(MANAGER_ROLES), asyncHandler(async (req: Request, res: Response) => {
  const validation = resizeJobSchema.safeParse(req.body);
  if (!validation.success) {
    throw createError(400, "Validation failed");
  }

  const { job, newEndTime } = validation.data;
  const updated = await resizeJobTime(job, newEndTime);
  res.json(updated);
}));

export default router;
