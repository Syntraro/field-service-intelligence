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
import { logEventAsync } from "../lib/events";
import { getQueryCtx } from "../lib/queryCtx";
// 2026-05-07 RALPH — note.created activity rows used to interpolate the
// raw locationId UUID into both `summary` and the meta payload, leaving
// the rail Activity panel rendering "Note added to location <uuid>".
// We resolve a display name at emit time so the rail and the global
// Activity Feed can both render user-facing copy without any client-
// side ID parsing or UUID fallbacks.
import { db } from "../db";
import { clientLocations, customerCompanies } from "@shared/schema";
import { and, eq } from "drizzle-orm";

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

    // 2026-05-07 RALPH — emit note.created with display-safe meta so the
    // rail Activity panel + global Activity Feed never render raw UUIDs.
    // Resolve the location's display name (location label first, parent
    // customer-company name as fallback). Truncated note preview is
    // stashed under `meta.preview` to match the canonical Activity Feed
    // formatter contract (formatActivityEvent.ts:179-182).
    const [loc] = await db
      .select({
        location: clientLocations.location,
        companyName: clientLocations.companyName,
        parentName: customerCompanies.name,
      })
      .from(clientLocations)
      .leftJoin(customerCompanies, eq(clientLocations.parentCompanyId, customerCompanies.id))
      .where(and(eq(clientLocations.id, locationId), eq(clientLocations.companyId, companyId)))
      .limit(1);
    const locationName =
      loc?.location?.trim() ||
      loc?.companyName?.trim() ||
      loc?.parentName?.trim() ||
      null;
    const NOTE_PREVIEW_MAX = 140;
    const preview =
      body.noteText.length > NOTE_PREVIEW_MAX
        ? `${body.noteText.slice(0, NOTE_PREVIEW_MAX - 1)}…`
        : body.noteText;

    const ctx = getQueryCtx(req);
    logEventAsync(ctx, {
      eventType: "note.created",
      entityType: "location",
      entityId: locationId,
      // Summary kept for legacy readers, but no UUIDs in user-visible
      // copy. The rail panel and Activity Feed both build display copy
      // from `event_type` + `meta` and ignore `summary`.
      summary: locationName ? `Note added to ${locationName}` : "Note added",
      meta: {
        noteId: created.id,
        locationId,
        locationName,
        preview,
      },
    });

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
