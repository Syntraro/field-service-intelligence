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

/** Shared schema for note body fields. */
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
 * LOCATION NOTES
 * GET    /api/locations/:locationId/notes
 * POST   /api/locations/:locationId/notes
 * PATCH  /api/locations/:locationId/notes/:noteId
 * DELETE /api/locations/:locationId/notes/:noteId
 *
 * All enforce: companyId matches location's company + locationId = :locationId
 */

// GET /api/locations/:locationId/notes
router.get(
  "/:locationId/notes",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    const { locationId } = req.params;
    const { params, explicit } = parsePaginationLenient(req.query);

    await clientNotesRepository.assertClientOwned(companyId, locationId);

    const result = await clientNotesRepository.listLocationNotes(companyId, locationId, {
      limit: params.limit,
      offset: params.offset ?? 0,
    });

    // Enrich each note with its attachments
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

// POST /api/locations/:locationId/notes
router.post(
  "/:locationId/notes",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId, user } = req;
    const { locationId } = req.params;

    const body = validateSchema(noteBodySchema, req.body);
    await clientNotesRepository.assertClientOwned(companyId, locationId);

    // Dedupe within 5-second window
    const dup = await clientNotesRepository.findRecentDuplicate(companyId, user!.id, locationId, body.noteText);
    if (dup) return res.status(200).json(dup);

    const created = await clientNotesRepository.createNote(companyId, user!.id, locationId, body.noteText, {
      showOnJobs: body.showOnJobs,
      showOnInvoices: body.showOnInvoices,
      showOnQuotes: body.showOnQuotes,
    });

    // Attach uploaded files if provided
    if (body.attachmentFileIds?.length) {
      await Promise.all(
        body.attachmentFileIds.map((fid) => noteAttachmentRepository.attach(companyId, user!.id, created.id, fid))
      );
    }

    // Return note with attachments
    const attachments = await noteAttachmentRepository.listByNote(companyId, created.id);
    res.status(201).json({ ...created, attachments });
  })
);

// PATCH /api/locations/:locationId/notes/:noteId
router.patch(
  "/:locationId/notes/:noteId",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    const { locationId, noteId } = req.params;

    const body = validateSchema(noteUpdateSchema, req.body);
    await clientNotesRepository.assertClientOwned(companyId, locationId);

    const updated = await clientNotesRepository.updateNote(companyId, locationId, noteId, body.noteText, {
      showOnJobs: body.showOnJobs,
      showOnInvoices: body.showOnInvoices,
      showOnQuotes: body.showOnQuotes,
    });

    if (!updated) throw createError(404, "Note not found");

    const attachments = await noteAttachmentRepository.listByNote(companyId, updated.id);
    res.json({ ...updated, attachments });
  })
);

// DELETE /api/locations/:locationId/notes/:noteId
router.delete(
  "/:locationId/notes/:noteId",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    const { locationId, noteId } = req.params;

    await clientNotesRepository.assertClientOwned(companyId, locationId);
    const deleted = await clientNotesRepository.deleteNote(companyId, locationId, noteId);

    if (!deleted) throw createError(404, "Note not found");
    // note_attachments cascade-deleted by FK constraint
    res.json({ success: true });
  })
);

export default router;
