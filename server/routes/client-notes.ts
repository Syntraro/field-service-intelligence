import { Router, Response } from "express";
import { z } from "zod";
import { insertClientNoteSchema } from "@shared/schema";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { parsePaginationLenient } from "../utils/pagination";
import { paginatedCompat } from "../utils/paginatedResponse";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";
import { clientNotesRepository } from "../storage/clientNotes";

const router = Router();

/**
 * NOTE ROUTES - Canonical only
 *  - GET    /api/clients/:clientId/notes
 *  - POST   /api/clients/:clientId/notes
 *  - PATCH  /api/clients/:clientId/notes/:noteId
 *  - DELETE /api/clients/:clientId/notes/:noteId
 */

/**
 * Normalizes and validates note input
 * Uses locationId as the canonical reference
 */
function normalizeNoteInput(input: unknown) {
  const base = insertClientNoteSchema
    .pick({ locationId: true, noteText: true })
    .safeParse(input);

  if (!base.success) {
    throw createError(400, "Invalid note payload");
  }

  const trimmed = base.data.noteText?.trim?.() ?? "";
  if (!trimmed) {
    throw createError(400, "Note text is required");
  }

  // locationId is required (NOT NULL in schema)
  const locationId = base.data.locationId;
  if (!locationId) {
    throw createError(400, "Location ID is required");
  }

  return { locationId, noteText: trimmed };
}

// GET /api/clients/:clientId/notes
router.get(
  "/clients/:clientId/notes",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    const { clientId } = req.params;
    const { params, explicit } = parsePaginationLenient(req.query);

    await clientNotesRepository.assertClientOwned(companyId!, clientId);

    const offset = params.offset ?? 0;
    const result = await clientNotesRepository.listNotes(companyId!, clientId, {
      limit: params.limit,
      offset,
    });

    const meta = {
      limit: params.limit,
      hasMore: result.hasMore,
      nextOffset: result.nextOffset,
    };

    res.json(paginatedCompat(result.items, meta, explicit));
  })
);

// POST /api/clients/:clientId/notes
router.post(
  "/clients/:clientId/notes",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId, user } = req;
    const { clientId } = req.params; // URL param for backwards compat

    // Pass as locationId (canonical reference)
    const { locationId, noteText } = normalizeNoteInput({ ...req.body, locationId: clientId });
    await clientNotesRepository.assertClientOwned(companyId!, locationId);

    // Prevent duplicate notes from retry attempts (5-second window)
    const recentDuplicate = await clientNotesRepository.findRecentDuplicate(
      companyId!,
      user!.id,
      locationId,
      noteText
    );

    if (recentDuplicate) {
      return res.status(200).json(recentDuplicate);
    }

    const created = await clientNotesRepository.createNote(
      companyId!,
      user!.id,
      locationId,
      noteText
    );

    res.status(201).json(created);
  })
);

// PATCH /api/clients/:clientId/notes/:noteId
router.patch(
  "/clients/:clientId/notes/:noteId",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    const { clientId, noteId } = req.params; // URL param for backwards compat

    // Pass as locationId (canonical reference)
    const { locationId, noteText } = normalizeNoteInput({ ...req.body, locationId: clientId });
    await clientNotesRepository.assertClientOwned(companyId!, locationId);

    const updated = await clientNotesRepository.updateNote(
      companyId!,
      locationId,
      noteId,
      noteText
    );

    if (!updated) {
      throw createError(404, "Note not found");
    }

    res.json(updated);
  })
);

// DELETE /api/clients/:clientId/notes/:noteId
router.delete(
  "/clients/:clientId/notes/:noteId",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    const { clientId, noteId } = req.params;

    await clientNotesRepository.assertClientOwned(companyId!, clientId);

    const deleted = await clientNotesRepository.deleteNote(companyId!, clientId, noteId);

    if (!deleted) {
      throw createError(404, "Note not found");
    }

    res.json({ success: true });
  })
);

export default router;
