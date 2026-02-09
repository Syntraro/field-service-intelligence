import { Router, Response } from "express";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import { noteAttachmentRepository } from "../storage/noteAttachments";

const router = Router();

const attachBodySchema = z.object({
  fileId: z.string().min(1, "fileId is required"),
});

/**
 * NOTE ATTACHMENTS
 * POST   /api/notes/:noteId/attachments       — attach a file
 * DELETE /api/notes/:noteId/attachments/:attachmentId — detach a file
 */

// POST /api/notes/:noteId/attachments
router.post(
  "/:noteId/attachments",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId, user } = req;
    const { noteId } = req.params;
    const { fileId } = validateSchema(attachBodySchema, req.body);

    const row = await noteAttachmentRepository.attach(companyId, user!.id, noteId, fileId);
    res.status(201).json(row);
  })
);

// DELETE /api/notes/:noteId/attachments/:attachmentId
router.delete(
  "/:noteId/attachments/:attachmentId",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    const { attachmentId } = req.params;

    const row = await noteAttachmentRepository.detach(companyId, attachmentId);
    if (!row) throw createError(404, "Attachment not found");
    res.json({ success: true });
  })
);

export default router;
