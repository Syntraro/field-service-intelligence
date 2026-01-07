import { Router, Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import db from "../db";
import { clientNotes, insertClientNoteSchema, clients } from "@shared/schema";
import { sql } from "drizzle-orm";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { parsePaginationLenient } from "../utils/pagination";
import { paginatedCompat } from "../utils/paginatedResponse";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";

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
 */
function normalizeNoteInput(input: unknown) {
  const base = insertClientNoteSchema
    .pick({ clientId: true, noteText: true })
    .safeParse(input);

  if (!base.success) {
    throw createError(400, "Invalid note payload");
  }

  const trimmed = base.data.noteText?.trim?.() ?? "";
  if (!trimmed) {
    throw createError(400, "Note text is required");
  }

  return { clientId: base.data.clientId, noteText: trimmed };
}

/**
 * Verifies client ownership within tenant
 */
async function assertClientOwned(companyId: string, clientId: string): Promise<void> {
  const [row] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId)))
    .limit(1);

  if (!row) {
    throw createError(404, "Client not found");
  }
}

// GET /api/clients/:clientId/notes
router.get(
  "/clients/:clientId/notes",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    const { clientId } = req.params;
    const { params, explicit } = parsePaginationLenient(req.query);

    await assertClientOwned(companyId!, clientId);

    const offset = params.offset ?? 0;
    const notes = await db
      .select()
      .from(clientNotes)
      .where(and(eq(clientNotes.companyId, companyId!), eq(clientNotes.clientId, clientId)))
      .orderBy(desc(clientNotes.createdAt))
      .limit(params.limit + 1)
      .offset(offset);

    const hasMore = notes.length > params.limit;
    const items = hasMore ? notes.slice(0, params.limit) : notes;
    const meta = {
      limit: params.limit,
      hasMore,
      nextOffset: hasMore ? offset + params.limit : undefined,
    };

    res.json(paginatedCompat(items, meta, explicit));
  })
);

// POST /api/clients/:clientId/notes
router.post(
  "/clients/:clientId/notes",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId, user } = req;
    const { clientId } = req.params;

    const { clientId: parsedClientId, noteText } = normalizeNoteInput({ ...req.body, clientId });
    await assertClientOwned(companyId!, parsedClientId);

    // Prevent duplicate notes from retry attempts (5-second window)
    const fiveSecondsAgo = new Date(Date.now() - 5000);
    const [recentDuplicate] = await db
      .select()
      .from(clientNotes)
      .where(
        and(
          eq(clientNotes.companyId, companyId!),
          eq(clientNotes.userId, user!.id),
          eq(clientNotes.clientId, parsedClientId),
          eq(clientNotes.noteText, noteText),
          sql`${clientNotes.createdAt} > ${fiveSecondsAgo}`
        )
      )
      .limit(1);

    if (recentDuplicate) {
      return res.status(200).json(recentDuplicate);
    }

    const [created] = await db
      .insert(clientNotes)
      .values({
        companyId: companyId!,
        userId: user!.id,
        clientId: parsedClientId,
        noteText,
      })
      .returning();

    res.status(201).json(created);
  })
);

// PATCH /api/clients/:clientId/notes/:noteId
router.patch(
  "/clients/:clientId/notes/:noteId",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    const { clientId, noteId } = req.params;

    const { noteText } = normalizeNoteInput({ ...req.body, clientId });
    await assertClientOwned(companyId!, clientId);

    const [updated] = await db
      .update(clientNotes)
      .set({ noteText })
      .where(
        and(
          eq(clientNotes.id, noteId),
          eq(clientNotes.companyId, companyId!),
          eq(clientNotes.clientId, clientId)
        )
      )
      .returning();

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

    await assertClientOwned(companyId!, clientId);

    const [deleted] = await db
      .delete(clientNotes)
      .where(
        and(
          eq(clientNotes.id, noteId),
          eq(clientNotes.companyId, companyId!),
          eq(clientNotes.clientId, clientId)
        )
      )
      .returning();

    if (!deleted) {
      throw createError(404, "Note not found");
    }

    res.json({ success: true });
  })
);

export default router;
