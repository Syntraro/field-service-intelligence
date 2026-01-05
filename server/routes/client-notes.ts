import { Router, Request, Response, NextFunction } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import db from "../db";
import { clientNotes, insertClientNoteSchema, clients } from "@shared/schema";
import { sql } from "drizzle-orm";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { parsePaginationLenient, applyOffsetPagination } from "../utils/pagination";
import { paginatedCompat } from "../utils/paginatedResponse";

type AuthedRequest = Request & {
  user?: { id: string } | undefined;
  companyId?: string | undefined;
};

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (!req.companyId) return res.status(401).json({ error: "Unauthorized" });
  next();
}

const router = Router();
router.use(requireAuth);

/**
 * NOTE ROUTES
 *
 * Canonical:
 *  - GET    /api/clients/:clientId/notes
 *  - POST   /api/clients/:clientId/notes
 *  - PATCH  /api/clients/:clientId/notes/:noteId
 *  - DELETE /api/clients/:clientId/notes/:noteId
 *
 * Alias (back-compat):
 *  - GET    /api/client-notes?clientId=...
 *  - POST   /api/client-notes
 *  - PATCH  /api/client-notes/:noteId
 *  - DELETE /api/client-notes/:noteId
 */

function normalizeNoteInput(input: unknown) {
  const base = insertClientNoteSchema
    .pick({ clientId: true, noteText: true })
    .safeParse(input);

  if (!base.success) {
    return { ok: false as const, error: "Invalid note payload" };
  }

  const trimmed = base.data.noteText?.trim?.() ?? "";
  if (!trimmed) return { ok: false as const, error: "Note text is required" };

  return {
    ok: true as const,
    data: { clientId: base.data.clientId, noteText: trimmed },
  };
}

async function assertClientOwned(companyId: string, clientId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId)))
    .limit(1);

  return !!row;
}

router.get("/clients/:clientId/notes", async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId } = req;
    const { clientId } = req.params;
    const { params, explicit } = parsePaginationLenient(req.query);

    // Ownership check: ensure client exists in this tenant
    const ownsClient = await assertClientOwned(companyId!, clientId);
    if (!ownsClient) return res.status(404).json({ error: "Client not found" });

    // Fetch with LIMIT + 1 to determine hasMore efficiently
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
  } catch (err: any) {
    if (err?.status === 400) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: "Failed to fetch notes" });
  }
});

router.post("/clients/:clientId/notes", requireRole(MANAGER_ROLES), async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId, user } = req;
    const { clientId } = req.params;

    const parsed = normalizeNoteInput({ ...req.body, clientId });
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    // Ownership check: ensure client exists in this tenant
    const ownsClient = await assertClientOwned(companyId!, clientId);
    if (!ownsClient) return res.status(404).json({ error: "Client not found" });

    // Check for duplicate note in last 5 seconds (same user, client, text)
    // This catches retry attempts from network timeouts
    const fiveSecondsAgo = new Date(Date.now() - 5000);
    const [recentDuplicate] = await db
      .select()
      .from(clientNotes)
      .where(
        and(
          eq(clientNotes.companyId, companyId!),
          eq(clientNotes.userId, user!.id),
          eq(clientNotes.clientId, clientId),
          eq(clientNotes.noteText, parsed.data.noteText),
          sql`${clientNotes.createdAt} > ${fiveSecondsAgo}`
        )
      )
      .limit(1);

    if (recentDuplicate) {
      // Return existing note with 200 (not 201) to indicate it already existed
      return res.status(200).json(recentDuplicate);
    }

    // Create new note
    const [created] = await db
      .insert(clientNotes)
      .values({
        companyId: companyId!,
        userId: user!.id,
        clientId,
        noteText: parsed.data.noteText,
      })
      .returning();

    res.status(201).json(created);
  } catch {
    res.status(500).json({ error: "Failed to create note" });
  }
});

router.patch("/clients/:clientId/notes/:noteId", requireRole(MANAGER_ROLES), async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId } = req;
    const { clientId, noteId } = req.params;

    const parsed = normalizeNoteInput({ ...req.body, clientId });
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    // Ownership check: ensure client exists in this tenant
    const ownsClient = await assertClientOwned(companyId!, clientId);
    if (!ownsClient) return res.status(404).json({ error: "Client not found" });

    const [updated] = await db
      .update(clientNotes)
      .set({ noteText: parsed.data.noteText })
      .where(
        and(
          eq(clientNotes.id, noteId),
          eq(clientNotes.companyId, companyId!),
          eq(clientNotes.clientId, clientId)
        )
      )
      .returning();

    if (!updated) return res.status(404).json({ error: "Note not found" });
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update note" });
  }
});

router.delete("/clients/:clientId/notes/:noteId", requireRole(MANAGER_ROLES), async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId } = req;
    const { clientId, noteId } = req.params;

    // Ownership check: ensure client exists in this tenant
    const ownsClient = await assertClientOwned(companyId!, clientId);
    if (!ownsClient) return res.status(404).json({ error: "Client not found" });

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

    if (!deleted) return res.status(404).json({ error: "Note not found" });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to delete note" });
  }
});

// ---------------------
// Alias routes (back-compat)
// ---------------------
router.get("/client-notes", async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId } = req;
    const { params, explicit } = parsePaginationLenient(req.query);
    const clientId = String(req.query?.clientId ?? "");
    if (!clientId) return res.status(400).json({ error: "clientId is required" });

    // Ownership check: ensure client exists in this tenant
    const ownsClient = await assertClientOwned(companyId!, clientId);
    if (!ownsClient) return res.status(404).json({ error: "Client not found" });

    // Fetch with LIMIT + 1 to determine hasMore efficiently
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
  } catch (err: any) {
    if (err?.status === 400) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: "Failed to fetch notes" });
  }
});

router.post("/client-notes", requireRole(MANAGER_ROLES), async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId, user } = req;

    const parsed = normalizeNoteInput(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    // Ownership check: ensure client exists in this tenant
    const ownsClient = await assertClientOwned(companyId!, parsed.data.clientId);
    if (!ownsClient) return res.status(404).json({ error: "Client not found" });

    // Check for duplicate note in last 5 seconds
    const fiveSecondsAgo = new Date(Date.now() - 5000);
    const [recentDuplicate] = await db
      .select()
      .from(clientNotes)
      .where(
        and(
          eq(clientNotes.companyId, companyId!),
          eq(clientNotes.userId, user!.id),
          eq(clientNotes.clientId, parsed.data.clientId),
          eq(clientNotes.noteText, parsed.data.noteText),
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
        clientId: parsed.data.clientId,
        noteText: parsed.data.noteText,
      })
      .returning();

    res.status(201).json(created);
  } catch {
    res.status(500).json({ error: "Failed to create note" });
  }
});

router.patch("/client-notes/:noteId", requireRole(MANAGER_ROLES), async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId } = req;
    const { noteId } = req.params;

    const bodySchema = z.object({ noteText: z.string().min(1) });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid note payload" });

    const [updated] = await db
      .update(clientNotes)
      .set({ noteText: parsed.data.noteText.trim() })
      .where(and(eq(clientNotes.id, noteId), eq(clientNotes.companyId, companyId!)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Note not found" });
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update note" });
  }
});

router.delete("/client-notes/:noteId", requireRole(MANAGER_ROLES), async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId } = req;
    const { noteId } = req.params;

    const [deleted] = await db
      .delete(clientNotes)
      .where(and(eq(clientNotes.id, noteId), eq(clientNotes.companyId, companyId!)))
      .returning();

    if (!deleted) return res.status(404).json({ error: "Note not found" });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to delete note" });
  }
});

export default router;
