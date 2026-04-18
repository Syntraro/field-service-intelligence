/**
 * QuoteNotesSection (Phase 3D, 2026-04-14)
 *
 * Canonical interactive notes for Quote Detail. Mirrors `JobNotesSection`
 * one-for-one so the UX is identical: list view, add-note button, inline
 * author + timestamp, edit-by-click, delete from the edit dialog.
 *
 * Why a parallel component instead of generalizing JobNotesSection:
 *   - `JobNotesSection` is tightly coupled to `/api/jobs/:jobId/notes`
 *     and `JobNoteDialog` which also posts there, and has R2 attachment
 *     wiring via `entityType: "job_note"`. Generalizing all of that now
 *     would be a large refactor across the notes + file-upload stack.
 *   - This component is a structural mirror using the quote notes API
 *     (`/api/quotes/:id/notes`) — same shape, no attachments yet. A
 *     future pass can lift both into a shared `EntityNotesSection`
 *     without UI changes for consumers.
 *
 * Backend: `server/routes/quotes.ts` GET/POST/PUT/DELETE
 *   `/api/quotes/:id/notes[/ :noteId]`
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { MessageSquare, Loader2, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { NoteAttachmentStrip } from "@/components/attachments/NoteAttachmentStrip";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** Origin discriminator set by the backend on every row.
 *  "quote" = entity-owned; "client_*" = inherited client_notes (read-only). */
type NoteOrigin =
  | "quote"
  | "client_location"
  | "client_company"
  | "client_tenant";

/** Same shape as JobNotesSection's NoteAttachment — inherited client_notes
 *  surface their attachments here so mixed feeds render uniformly. */
interface QuoteNoteAttachment {
  id: string;
  noteId: string;
  fileId: string;
  originalName: string | null;
  mimeType: string | null;
  size: number | null;
  storageProvider?: string | null;
  status?: string | null;
}

interface QuoteNote {
  id: string;
  quoteId: string | null;
  noteText: string;
  createdAt: string;
  updatedAt: string | null;
  userName: string;
  user: {
    id: string;
    email: string | null;
    fullName: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
  origin?: NoteOrigin;
  editable?: boolean;
  attachments?: QuoteNoteAttachment[];
}

function originChipLabel(origin: NoteOrigin | undefined): string | null {
  switch (origin) {
    case "client_location":
      return "Location Note";
    case "client_company":
      return "Client Note";
    case "client_tenant":
      return "Company Note";
    default:
      return null;
  }
}

interface QuoteNotesSectionProps {
  quoteId: string;
  /** Report count to parent if needed. */
  onCountChange?: (count: number) => void;
  /** 2026-04-14 parity pass: when true, renders without the Card shell and
   *  its own header — parent wraps the component in its own Collapsible.
   *  Matches JobNotesSection's embedded/hideHeader/hideAddButton API. */
  embedded?: boolean;
  hideHeader?: boolean;
  hideAddButton?: boolean;
  /** Opens the add-note dialog programmatically from the parent's own
   *  header affordance (e.g. the ghost "+" button on the collapsible
   *  header bar). When provided, the parent sets a ref/state and calls
   *  this opener. Declarative via a prop, imperative via openAddNoteRef
   *  is not needed here because the parent can drive state directly. */
  openAddNoteSignal?: number; // any change triggers open
}

export function QuoteNotesSection({
  quoteId,
  onCountChange,
  embedded = false,
  hideHeader = false,
  hideAddButton = false,
  openAddNoteSignal,
}: QuoteNotesSectionProps) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const notesKey = ["/api/quotes", quoteId, "notes"] as const;

  const { data: notes = [], isLoading } = useQuery<QuoteNote[]>({
    queryKey: notesKey,
    queryFn: () => apiRequest<QuoteNote[]>(`/api/quotes/${quoteId}/notes`),
  });

  useEffect(() => {
    onCountChange?.(notes.length);
  }, [notes.length, onCountChange]);

  // Parent can trigger the add-note dialog by bumping openAddNoteSignal.
  useEffect(() => {
    if (openAddNoteSignal !== undefined && openAddNoteSignal > 0) {
      setEditingId(null);
      setDraft("");
      setDialogOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAddNoteSignal]);

  const createMut = useMutation({
    mutationFn: (text: string) =>
      apiRequest(`/api/quotes/${quoteId}/notes`, {
        method: "POST",
        body: JSON.stringify({ text }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notesKey });
      closeDialog();
    },
    onError: (e: Error) =>
      toast({ title: "Failed to add note", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      apiRequest(`/api/quotes/${quoteId}/notes/${id}`, {
        method: "PUT",
        body: JSON.stringify({ text }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notesKey });
      closeDialog();
    },
    onError: (e: Error) =>
      toast({ title: "Failed to update note", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/quotes/${quoteId}/notes/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notesKey });
      closeDialog();
    },
    onError: (e: Error) =>
      toast({ title: "Failed to delete note", description: e.message, variant: "destructive" }),
  });

  function openCreate() {
    setEditingId(null);
    setDraft("");
    setDialogOpen(true);
  }

  function openEdit(note: QuoteNote) {
    setEditingId(note.id);
    setDraft(note.noteText);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingId(null);
    setDraft("");
    setIsDeleting(false);
  }

  const busy = createMut.isPending || updateMut.isPending || deleteMut.isPending;
  const canSave = draft.trim().length > 0 && !busy;

  function handleSave() {
    const text = draft.trim();
    if (!text) return;
    if (editingId) updateMut.mutate({ id: editingId, text });
    else createMut.mutate(text);
  }

  const header = (
    <div className="flex items-center justify-between px-4 py-2.5 bg-[#f8fafc] border-b border-[#e2e8f0]">
      <span className="text-sm font-semibold text-[#0f172a] flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-[#64748b]" />
        Notes{notes.length > 0 ? ` (${notes.length})` : ""}
      </span>
      {!hideAddButton && (
        <button
          type="button"
          className="text-xs text-[#76B054] hover:text-[#5F9442] font-medium"
          onClick={openCreate}
          data-testid="button-add-quote-note"
        >
          + Add Note
        </button>
      )}
    </div>
  );

  const body = (
    <div className={embedded ? "px-3 pb-3 pt-1" : "px-3 pb-3 pt-2"}>
      {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading notes…</p>
        ) : notes.length === 0 ? (
          <div className="text-center py-3 text-muted-foreground" data-testid="quote-notes-empty">
            <MessageSquare className="h-5 w-5 mx-auto mb-1 opacity-50" />
            <p className="text-xs">No notes yet</p>
          </div>
        ) : (
          <div className="space-y-0">
            {notes.map((note, idx) => {
              // Entity-owned quote notes are editable; inherited client_notes
              // are read-only on this surface. Matches Job/Invoice UX.
              const canEdit = note.editable !== false && note.origin === "quote";
              const chipLabel = originChipLabel(note.origin);
              return (
                <div
                  key={note.id}
                  role={canEdit ? "button" : undefined}
                  tabIndex={canEdit ? 0 : -1}
                  onClick={canEdit ? () => openEdit(note) : undefined}
                  onKeyDown={canEdit ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openEdit(note);
                    }
                  } : undefined}
                  className={`group py-3 px-1 rounded transition-colors ${canEdit ? "cursor-pointer hover:bg-slate-50" : "cursor-default"} ${idx > 0 ? "border-t border-slate-200" : ""}`}
                  data-testid={`quote-note-${note.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-500">
                      <span className="font-semibold text-slate-700">{note.userName}</span>
                      {" · "}
                      {format(new Date(note.createdAt), "MMM d, h:mm a")}
                      {note.updatedAt && note.updatedAt !== note.createdAt && (
                        <span className="ml-1 text-xs text-slate-400">(edited)</span>
                      )}
                    </span>
                    {chipLabel && (
                      <span
                        className="text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0"
                        data-testid={`quote-note-origin-${note.id}`}
                      >
                        {chipLabel}
                      </span>
                    )}
                  </div>
                  <p className="text-[14px] leading-5 whitespace-pre-wrap mt-0.5 text-slate-800">
                    {note.noteText}
                  </p>

                  {note.attachments && note.attachments.length > 0 && (
                    // Stop clicks inside the strip (thumb → lightbox, chip
                    // → file open) from bubbling to the row-edit handler.
                    <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                      <NoteAttachmentStrip attachments={note.attachments} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
    </div>
  );

  const dialog = (
    <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o && !busy) closeDialog(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit note" : "Add note"}</DialogTitle>
          </DialogHeader>
          <Textarea
            rows={6}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a note…"
            disabled={busy}
            data-testid="input-quote-note-text"
          />
          <DialogFooter className="flex items-center gap-2">
            {editingId && (
              isDeleting ? (
                <div className="flex items-center gap-2 mr-auto">
                  <span className="text-xs text-red-600">Delete this note?</span>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setIsDeleting(false)}>Cancel</Button>
                  <Button
                    size="sm"
                    className="bg-red-600 hover:bg-red-700 text-white"
                    disabled={busy}
                    onClick={() => deleteMut.mutate(editingId)}
                    data-testid="button-quote-note-delete-confirm"
                  >
                    {deleteMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Trash2 className="h-3.5 w-3.5 mr-1" />}
                    Delete
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="mr-auto text-red-600 border-red-200 hover:bg-red-50"
                  disabled={busy}
                  onClick={() => setIsDeleting(true)}
                  data-testid="button-quote-note-delete"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />Delete
                </Button>
              )
            )}
            <Button variant="outline" disabled={busy} onClick={closeDialog}>Cancel</Button>
            <Button
              disabled={!canSave}
              onClick={handleSave}
              data-testid="button-quote-note-save"
            >
              {(createMut.isPending || updateMut.isPending) && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              {editingId ? "Save" : "Add note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );

  if (embedded) {
    return (
      <div data-testid="card-quote-notes">
        {!hideHeader && header}
        {body}
        {dialog}
      </div>
    );
  }

  return (
    <div
      className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden"
      data-testid="card-quote-notes"
    >
      {!hideHeader && header}
      {body}
      {dialog}
    </div>
  );
}
