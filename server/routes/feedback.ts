/**
 * Feedback Routes — Internal feedback tracking (no email, no notifications).
 *
 * Endpoints match the existing client UI (FeedbackDialog + Admin feedback tab):
 *
 *   POST   /api/feedback              — submit feedback (any authenticated user)
 *   GET    /api/feedback              — list feedback (company-scoped)
 *   PATCH  /api/feedback/:id/status   — update status (admin/owner)
 *   PATCH  /api/feedback/:id/archive  — toggle archive flag (admin/owner)
 *   DELETE /api/feedback/:id          — hard delete (admin/owner)
 *
 * 2026-04-10: Created to back the existing client UI that was calling
 * these endpoints with no server handler. The feedback table + schema
 * already existed in shared/schema.ts and the DB since migration 0003.
 */

import { Router, Response } from "express";
import { z } from "zod";
import { feedbackRepository } from "../storage/feedback";
import { requireRole } from "../auth/requireRole";
import { ADMIN_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";

const router = Router();

// ── Validation ──

const createFeedbackSchema = z.object({
  category: z.string().min(1).max(50),
  message: z.string().min(1).max(5000),
}).strict();

const updateStatusSchema = z.object({
  status: z.string().min(1).max(50),
}).strict();

const updateArchiveSchema = z.object({
  archived: z.boolean(),
}).strict();

// ── POST /api/feedback — submit feedback (any authenticated user) ──

router.post("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const userId = req.user?.id;
  const userEmail = req.user?.email;

  if (!userId || !userEmail) {
    throw createError(401, "Not authenticated");
  }

  const data = validateSchema(createFeedbackSchema, req.body);

  const row = await feedbackRepository.create(companyId, userId, userEmail, {
    category: data.category,
    message: data.message,
  });

  res.status(201).json(row);
}));

// ── GET /api/feedback — list feedback (company-scoped) ──

router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const rows = await feedbackRepository.list(companyId);
  res.json(rows);
}));

// ── PATCH /api/feedback/:id/status — update status (admin/owner) ──

router.patch("/:id/status", requireRole(ADMIN_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const data = validateSchema(updateStatusSchema, req.body);

  const row = await feedbackRepository.updateStatus(companyId, req.params.id, data.status);
  if (!row) throw createError(404, "Feedback not found");

  res.json(row);
}));

// ── PATCH /api/feedback/:id/archive — toggle archive flag (admin/owner) ──

router.patch("/:id/archive", requireRole(ADMIN_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const data = validateSchema(updateArchiveSchema, req.body);

  const row = await feedbackRepository.updateArchived(companyId, req.params.id, data.archived);
  if (!row) throw createError(404, "Feedback not found");

  res.json(row);
}));

// ── DELETE /api/feedback/:id — hard delete (admin/owner) ──

router.delete("/:id", requireRole(ADMIN_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const deleted = await feedbackRepository.delete(companyId, req.params.id);
  if (!deleted) throw createError(404, "Feedback not found");

  res.json({ success: true });
}));

export default router;
