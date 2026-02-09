import { Router, Response } from "express";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { parsePaginationLenient } from "../utils/pagination";
import { paginatedCompat } from "../utils/paginatedResponse";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import { clientNotesRepository } from "../storage/clientNotes";
import { noteAttachmentRepository } from "../storage/noteAttachments";

const router = Router();

const noteBodySchema = z.object({
  noteText: z.string().min(1, "Note text is required"),
  showOnJobs: z.boolean().optional(),
  showOnInvoices: z.boolean().optional(),
  showOnQuotes: z.boolean().optional(),
  attachmentFileIds: z.array(z.string()).optional(),
});

const noteUpdateSchema = z.object({
  noteText: z.string().min(1, "Note text is required"),
  showOnJobs: z.boolean().optional(),
  showOnInvoices: z.boolean().optional(),
  showOnQuotes: z.boolean().optional(),
});

/**
 * COMPANY NOTES (locationId IS NULL)
 * GET    /api/companies/:companyId/notes
 * POST   /api/companies/:companyId/notes
 * PATCH  /api/companies/:companyId/notes/:noteId
 * DELETE /api/companies/:companyId/notes/:noteId
 *
 * Enforce: req.companyId === :companyId (tenant guard)
 */

// GET /api/companies/:companyId/notes
router.get(
  "/:companyId/notes",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    const routeCompanyId = req.params.companyId;
    if (companyId !== routeCompanyId) throw createError(403, "Forbidden");

    const { params, explicit } = parsePaginationLenient(req.query);
    const result = await clientNotesRepository.listCompanyNotes(companyId, {
      limit: params.limit,
      offset: params.offset ?? 0,
    });

    const enriched = await Promise.all(
      result.items.map(async (note: any) => ({
        ...note,
        attachments: await noteAttachmentRepository.listByNote(companyId, note.id),
      }))
    );

    const meta = { limit: params.limit, hasMore: result.hasMore, nextOffset: result.nextOffset };
    res.json(paginatedCompat(enriched, meta, explicit));
  })
);

// POST /api/companies/:companyId/notes
router.post(
  "/:companyId/notes",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId, user } = req;
    const routeCompanyId = req.params.companyId;
    if (companyId !== routeCompanyId) throw createError(403, "Forbidden");

    const body = validateSchema(noteBodySchema, req.body);
    const created = await clientNotesRepository.createCompanyNote(companyId, user!.id, body.noteText, {
      showOnJobs: body.showOnJobs,
      showOnInvoices: body.showOnInvoices,
      showOnQuotes: body.showOnQuotes,
    });

    if (body.attachmentFileIds?.length) {
      await Promise.all(
        body.attachmentFileIds.map((fid) => noteAttachmentRepository.attach(companyId, user!.id, created.id, fid))
      );
    }

    const attachments = await noteAttachmentRepository.listByNote(companyId, created.id);
    res.status(201).json({ ...created, attachments });
  })
);

// PATCH /api/companies/:companyId/notes/:noteId
router.patch(
  "/:companyId/notes/:noteId",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    const { companyId: routeCompanyId, noteId } = req.params;
    if (companyId !== routeCompanyId) throw createError(403, "Forbidden");

    const body = validateSchema(noteUpdateSchema, req.body);
    const updated = await clientNotesRepository.updateCompanyNote(companyId, noteId, body.noteText, {
      showOnJobs: body.showOnJobs,
      showOnInvoices: body.showOnInvoices,
      showOnQuotes: body.showOnQuotes,
    });

    if (!updated) throw createError(404, "Note not found");
    const attachments = await noteAttachmentRepository.listByNote(companyId, updated.id);
    res.json({ ...updated, attachments });
  })
);

// DELETE /api/companies/:companyId/notes/:noteId
router.delete(
  "/:companyId/notes/:noteId",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    const { companyId: routeCompanyId, noteId } = req.params;
    if (companyId !== routeCompanyId) throw createError(403, "Forbidden");

    const deleted = await clientNotesRepository.deleteCompanyNote(companyId, noteId);
    if (!deleted) throw createError(404, "Note not found");
    res.json({ success: true });
  })
);

export default router;
