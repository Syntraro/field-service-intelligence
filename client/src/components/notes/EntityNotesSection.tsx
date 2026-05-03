/**
 * EntityNotesSection — canonical notes section for job / invoice / quote
 * detail pages.
 *
 * 2026-05-02 (Audit #2 PR 3C): consolidates the prior `JobNotesSection`
 * (with `source="job"|"invoice"`) and `QuoteNotesSection` into a single
 * component parameterized by `entityType`. Renders the merged feed of
 * entity-owned notes plus inherited client notes (location / customer-
 * company / tenant-wide) where the matching `show_on_*` flag is true.
 *
 * Parameterization matrix:
 *   - entityType="job"     → reads /api/jobs/${entityId}/notes;
 *                            owned-note origin "job"; entityId = jobId.
 *   - entityType="invoice" → reads /api/invoices/${invoiceId}/notes
 *                            (different cache key from "job" so the
 *                            invoice-specific show_on_invoices flag is
 *                            honored). The dialog still WRITES through
 *                            /api/jobs/${entityId}/notes (entityId is
 *                            the underlying jobId), so callers pass
 *                            invoiceId AND jobId — see prop docs below.
 *   - entityType="quote"   → reads /api/quotes/${entityId}/notes;
 *                            owned-note origin "quote"; entityId = quoteId.
 *
 * Inherited client notes are read-only on every surface — the chip
 * shows the source ("Location Note" / "Client Note" / "Company Note")
 * and the row's edit-on-click handler skips them.
 */

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { MessageSquare } from "lucide-react";
import { EntityNoteDialog, type ExistingEntityNote } from "./EntityNoteDialog";
import { NoteAttachmentStrip } from "@/components/attachments/NoteAttachmentStrip";

/** Attachment metadata returned from any of the three backends. */
interface NoteAttachment {
  id: string;
  noteId: string;
  fileId: string;
  originalName: string | null;
  mimeType: string | null;
  size: number | null;
  /** 'r2' for new R2-backed files, 'local' for legacy disk rows. */
  storageProvider?: string | null;
  status?: string | null;
}

/**
 * Origin discriminator set by the backend on every row.
 *
 * The owned origins ("job" / "quote") are emitted by the entity's own
 * notes route. Invoice surface re-uses the job-notes write path under
 * the hood, so its owned rows still arrive with `origin: "job"` — the
 * frontend treats `origin === entityType` (or `origin === "job"` when
 * `entityType === "invoice"`) as "this row is editable on this
 * surface." Inherited rows always carry a `client_*` origin and are
 * read-only on every surface.
 */
type NoteOrigin =
  | "job"
  | "quote"
  | "client_location"
  | "client_company"
  | "client_tenant";

interface EntityNote {
  id: string;
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
  attachments?: NoteAttachment[];
  origin?: NoteOrigin;
  editable?: boolean;
}

export type EntityNotesEntityType = "job" | "invoice" | "quote";

interface EntityNotesSectionProps {
  entityType: EntityNotesEntityType;
  /**
   * The id used for the canonical READ cache + display key:
   *   - "job"     → jobId (matches /api/jobs/:jobId/notes)
   *   - "invoice" → invoiceId (matches /api/invoices/:invoiceId/notes)
   *   - "quote"   → quoteId (matches /api/quotes/:quoteId/notes)
   *
   * For the "invoice" surface, `writeEntityId` is also required because
   * invoice notes are stored under jobs server-side.
   */
  entityId: string;
  /**
   * Required for `entityType="invoice"` only — the underlying jobId
   * that the WRITE path uses (`/api/jobs/:jobId/notes`). Ignored on
   * other surfaces. This mirrors the prior JobNotesSection contract
   * where the invoice surface received both `jobId` and `invoiceId`.
   */
  writeEntityId?: string;
  /** When true, renders without Card wrapper for integration into a unified surface. */
  embedded?: boolean;
  /** Report note count to parent for sidebar tab label. */
  onCountChange?: (count: number) => void;
  /** When true, hides the internal "+ Add Note" button (parent controls note creation). */
  hideAddButton?: boolean;
  /** When true, hides the internal header row (parent provides its own collapsible header). */
  hideHeader?: boolean;
  /** When false, hides the note count from the header (default: true). */
  showCount?: boolean;
  /** Quote-section parity: parent can bump this number to programmatically open the
   *  add-note dialog (e.g. from a sidebar "+" button). Optional everywhere. */
  openAddNoteSignal?: number;
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

/** Resolve the read endpoint + cache key for a given entity type. */
function resolveReadEndpoint(entityType: EntityNotesEntityType, entityId: string) {
  if (entityType === "quote") {
    return {
      url: `/api/quotes/${entityId}/notes`,
      queryKey: ["/api/quotes", entityId, "notes"] as const,
    };
  }
  if (entityType === "invoice") {
    return {
      url: `/api/invoices/${entityId}/notes`,
      queryKey: ["/api/invoices", entityId, "notes"] as const,
    };
  }
  return {
    url: `/api/jobs/${entityId}/notes`,
    queryKey: ["/api/jobs", entityId, "notes"] as const,
  };
}

/**
 * Decide which rows on the merged feed are editable from this surface.
 * Owned rows for the entity are editable; inherited client_* rows are
 * never editable. The invoice surface treats `origin === "job"` as
 * editable because invoice notes are stored under jobs server-side.
 */
function isOwnedRowEditable(
  note: EntityNote,
  entityType: EntityNotesEntityType,
): boolean {
  if (note.editable === false) return false;
  if (entityType === "quote") return note.origin === "quote";
  // job + invoice both expect origin "job" on owned rows
  return note.origin === "job";
}

export function EntityNotesSection({
  entityType,
  entityId,
  writeEntityId,
  embedded = false,
  onCountChange,
  hideAddButton = false,
  hideHeader = false,
  showCount = true,
  openAddNoteSignal,
}: EntityNotesSectionProps) {
  // Canonical dialog: `editingNote === null` with `dialogOpen === true` → create mode;
  // `editingNote` set → edit mode. Single modal instance handles both.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<ExistingEntityNote | null>(null);

  const { url: fetchUrl, queryKey } = resolveReadEndpoint(entityType, entityId);

  const { data: notes = [], isLoading } = useQuery<EntityNote[]>({
    queryKey: queryKey as unknown as readonly unknown[],
    queryFn: async () => {
      const res = await fetch(fetchUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch notes");
      return res.json();
    },
  });

  useEffect(() => {
    onCountChange?.(notes.length);
  }, [notes.length, onCountChange]);

  // 2026-05-02 (PR 3C): parent-driven add-note opener (matches the
  // `QuoteNotesSection` parity contract). Optional on every surface.
  useEffect(() => {
    if (openAddNoteSignal !== undefined && openAddNoteSignal > 0) {
      setEditingNote(null);
      setDialogOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAddNoteSignal]);

  const openCreate = () => {
    setEditingNote(null);
    setDialogOpen(true);
  };

  const openEdit = (note: EntityNote) => {
    setEditingNote({
      id: note.id,
      noteText: note.noteText,
      attachments: (note.attachments ?? []).map((a) => ({
        id: a.id,
        noteId: a.noteId,
        fileId: a.fileId,
        originalName: a.originalName,
        mimeType: a.mimeType,
        size: a.size,
      })),
    });
    setDialogOpen(true);
  };

  const header = (
    <div
      className="flex items-center justify-between px-4 py-2.5 bg-[#f8fafc] border-b border-[#e2e8f0]"
      data-testid="trigger-notes"
    >
      <span className="text-sm font-semibold text-[#0f172a] flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-[#64748b]" />
        Notes{showCount && notes.length > 0 ? ` (${notes.length})` : ""}
      </span>
      {!hideAddButton && (
        <button
          type="button"
          className="text-xs text-[#76B054] hover:text-[#5F9442] font-medium"
          onClick={openCreate}
          data-testid="button-add-note"
        >
          + Add Note
        </button>
      )}
    </div>
  );

  const body = (
    <div className={embedded ? "px-3 pb-3 pt-1" : "border-t px-3 pb-3 pt-2"}>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading notes...</p>
      ) : notes.length === 0 ? (
        <div className="text-center py-3 text-muted-foreground">
          <MessageSquare className="h-5 w-5 mx-auto mb-1 opacity-50" />
          <p className="text-xs">No notes yet</p>
        </div>
      ) : (
        <div className="space-y-0">
          {notes.map((note, idx) => {
            const canEdit = isOwnedRowEditable(note, entityType);
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
                data-testid={`note-${note.id}`}
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
                      data-testid={`note-origin-${note.id}`}
                    >
                      {chipLabel}
                    </span>
                  )}
                </div>
                <p className="text-[14px] leading-5 whitespace-pre-wrap mt-0.5 text-slate-800">{note.noteText}</p>

                {note.attachments && note.attachments.length > 0 && (
                  // Stop clicks inside the attachment strip (thumbnail → lightbox,
                  // chip → file open) from bubbling up to the note-edit handler.
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

  // Dialog wiring: for "invoice" the dialog WRITES through the job-notes
  // path with `entityId=writeEntityId` (the underlying jobId) and we
  // pass the invoice read-cache key as `extraInvalidationKey` so both
  // caches refresh on success. For "job" / "quote" the dialog's
  // entityId === the section's entityId, no cross-key needed.
  const dialogEntityId = entityType === "invoice"
    ? (writeEntityId ?? entityId)
    : entityId;
  const extraInvalidationKey = entityType === "invoice"
    ? (queryKey as unknown as readonly unknown[])
    : undefined;

  return (
    <>
      {embedded ? (
        <div data-testid={`card-${entityType}-notes`}>
          {!hideHeader && header}
          {body}
        </div>
      ) : (
        <Card data-testid={`card-${entityType}-notes`}>
          {!hideHeader && header}
          {body}
        </Card>
      )}

      <EntityNoteDialog
        entityType={entityType}
        entityId={dialogEntityId}
        note={editingNote}
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingNote(null);
        }}
        extraInvalidationKey={extraInvalidationKey}
      />
    </>
  );
}

export default EntityNotesSection;
