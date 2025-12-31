import { Router, Request, Response, NextFunction } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import db from "../db";
import { clientNotes, insertClientNoteSchema } from "@shared/schema";

type AuthedRequest = Request & {
  user?: { id: string } | undefined;
  companyId?: string | undefined;
};

function requireCompanyContext(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (!req.companyId) return res.status(400).json({ error: "Missing company context" });
  next();
}

const router = Router();
router.use(requireCompanyContext);

/**
 * CANONICAL:
 *  - GET    /api/clients/:clientId/notes
 *  - POST   /api/clients/:clientId/notes
 *  - PATCH  /api/clients/:clientId/notes/:noteId
 *  - DELETE /api/clients/:clientId/notes/:noteId
 *
 * ALIAS (back-compat):
 *  - GET    /api/client-notes?clientId=...
 *  - POST   /api/client-notes
 *  - PATCH  /api/client-notes/:id
 *  - DELETE /api/client-notes/:id
 */

// ---------------------
// Helpers
// ---------------------
function normalizeNoteInput(body: any) {
  const parsed = insertClientNoteSchema
    .extend({
      clientId: z.string(),
      noteText: z.string().min(1),
    })
    .safeParse(body);

  if (!parsed.success) {
    const msg = parsed.error.issues?.[0]?.message ?? "Invalid note payload";
    return { ok: false as const, error: msg };
  }
  return { ok: true as const, data: parsed.data };
}

// ---------------------
// Canonical routes
// ---------------------
router.get("/clients/:clientId/notes", async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId } = req;
    const { clientId } = req.params;

    const notes = await db
      .select()
      .from(clientNotes)
      .where(and(eq(clientNotes.companyId, companyId!), eq(clientNotes.clientId, clientId)))
      .orderBy(desc(clientNotes.createdAt));

    res.json(notes);
  } catch {
    res.status(500).json({ error: "Failed to fetch notes" });
  }
});

router.post("/clients/:clientId/notes", async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId, user } = req;
    const { clientId } = req.params;

    const parsed = normalizeNoteInput({ ...req.body, clientId });
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

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

router.patch("/clients/:clientId/notes/:noteId", async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId } = req;
    const { clientId, noteId } = req.params;

    const noteText = z.string().min(1).safeParse(req.body?.noteText);
    if (!noteText.success) return res.status(400).json({ error: "Invalid noteText" });

    const [updated] = await db
      .update(clientNotes)
      .set({ noteText: noteText.data, updatedAt: new Date() })
      .where(and(eq(clientNotes.id, noteId), eq(clientNotes.companyId, companyId!), eq(clientNotes.clientId, clientId)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Note not found" });
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update note" });
  }
});

router.delete("/clients/:clientId/notes/:noteId", async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId } = req;
    const { clientId, noteId } = req.params;

    const [deleted] = await db
      .delete(clientNotes)
      .where(and(eq(clientNotes.id, noteId), eq(clientNotes.companyId, companyId!), eq(clientNotes.clientId, clientId)))
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
    const clientId = String(req.query?.clientId ?? "");
    if (!clientId) return res.status(400).json({ error: "clientId is required" });

    const notes = await db
      .select()
      .from(clientNotes)
      .where(and(eq(clientNotes.companyId, companyId!), eq(clientNotes.clientId, clientId)))
      .orderBy(desc(clientNotes.createdAt));

    res.json(notes);
  } catch {
    res.status(500).json({ error: "Failed to fetch notes" });
  }
});

router.post("/client-notes", async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId, user } = req;

    const parsed = normalizeNoteInput(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

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

router.patch("/client-notes/:id", async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId } = req;
    const { id } = req.params;

    const noteText = z.string().min(1).safeParse(req.body?.noteText);
    if (!noteText.success) return res.status(400).json({ error: "Invalid noteText" });

    const [updated] = await db
      .update(clientNotes)
      .set({ noteText: noteText.data, updatedAt: new Date() })
      .where(and(eq(clientNotes.id, id), eq(clientNotes.companyId, companyId!)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Note not found" });
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update note" });
  }
});

router.delete("/client-notes/:id", async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId } = req;
    const { id } = req.params;

    const [deleted] = await db
      .delete(clientNotes)
      .where(and(eq(clientNotes.id, id), eq(clientNotes.companyId, companyId!)))
      .returning();

    if (!deleted) return res.status(404).json({ error: "Note not found" });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to delete note" });
  }
});

export default router;
