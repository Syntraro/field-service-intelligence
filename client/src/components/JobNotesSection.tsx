import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { MessageSquare } from "lucide-react";
import { JobNoteDialog, type ExistingJobNote } from "./JobNoteDialog";
import { NoteAttachmentStrip } from "./attachments/NoteAttachmentStrip";

/** Attachment metadata returned from API. */
interface NoteAttachment {
  id: string;
  noteId: string;
  fileId: string;
  originalName: string | null;
  mimeType: string | null;
  size: number | null;
  /** 'r2' for new R2-backed files, 'local' for legacy disk rows. Undefined on older responses. */
  storageProvider?: string | null;
  status?: string | null;
}

/** Origin discriminator set by the backend on every note row.
 *  - "job" — entity-owned job note (editable by author via existing mutations)
 *  - "client_location" / "client_company" / "client_tenant" — inherited
 *    client_notes (read-only on this surface). */
type NoteOrigin =
  | "job"
  | "client_location"
  | "client_company"
  | "client_tenant";

interface JobNote {
  id: string;
  jobId: string | null;
  noteText: string;
  createdAt: string;
  updatedAt: string | null;
  userName: string;
  user: {
    id: string;
    email: string;
    fullName: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
  attachments?: NoteAttachment[];
  /** Backend-computed — routes render decision (chip, click-to-edit). */
  origin?: NoteOrigin;
  editable?: boolean;
}

interface JobNotesSectionProps {
  jobId: string;
  /** When true, renders without Card wrapper for integration into a unified surface */
  embedded?: boolean;
  /** Report note count to parent for sidebar tab label */
  onCountChange?: (count: number) => void;
  /** When true, hides the internal "+ Add Note" button (parent controls note creation) */
  hideAddButton?: boolean;
  /** When true, hides the internal header row (parent provides its own collapsible header) */
  hideHeader?: boolean;
  /** When false, hides the note count from the header (default: true) */
  showCount?: boolean;
  /** Surface selector — controls which inheritance flag the backend consults.
   *  Default "job" hits /api/jobs/:jobId/notes (inherits showOnJobs).
   *  "invoice" hits /api/invoices/:invoiceId/notes (inherits showOnInvoices).
   *  2026-04-18: reused component keeps one UI; URL is the only difference. */
  source?: "job" | "invoice";
  /** Required when source="invoice". The backing invoice id. */
  invoiceId?: string;
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

export default function JobNotesSection({
  jobId,
  embedded = false,
  onCountChange,
  hideAddButton = false,
  hideHeader = false,
  showCount = true,
  source = "job",
  invoiceId,
}: JobNotesSectionProps) {
  // Canonical dialog: `editingNote === null` with `dialogOpen === true` → create mode;
  // `editingNote` set → edit mode. Single modal instance handles both.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<ExistingJobNote | null>(null);

  // 2026-04-18: the invoice surface reads a dedicated endpoint so the
  // backend consults show_on_invoices (not show_on_jobs). Same response
  // shape, so the rest of this component renders both surfaces uniformly.
  const useInvoiceSource = source === "invoice" && !!invoiceId;
  const fetchUrl = useInvoiceSource
    ? `/api/invoices/${invoiceId}/notes`
    : `/api/jobs/${jobId}/notes`;
  const queryKey = useInvoiceSource
    ? (["/api/invoices", invoiceId, "notes"] as const)
    : (["/api/jobs", jobId, "notes"] as const);

  const { data: notes = [], isLoading } = useQuery<JobNote[]>({
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

  const openCreate = () => {
    setEditingNote(null);
    setDialogOpen(true);
  };

  const openEdit = (note: JobNote) => {
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

  const getUserName = (note: JobNote) => note.userName;

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
            // Backend sets editable=true only for entity-owned notes. Inherited
            // client notes are read-only on this surface (edit happens on the
            // location/customer-company page).
            const canEdit = note.editable !== false && note.origin === "job";
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
                    <span className="font-semibold text-slate-700">{getUserName(note)}</span>
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

  return (
    <>
      {embedded ? (
        <div data-testid="card-job-notes">
          {!hideHeader && header}
          {body}
        </div>
      ) : (
        <Card data-testid="card-job-notes">
          {!hideHeader && header}
          {body}
        </Card>
      )}

      <JobNoteDialog
        jobId={jobId}
        note={editingNote}
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingNote(null);
        }}
        /* 2026-04-18: when rendering on the Invoice surface, the list query
         * lives under a different key — pass it so mutations refresh both. */
        extraInvalidationKey={useInvoiceSource ? queryKey as unknown as readonly unknown[] : undefined}
      />
    </>
  );
}
