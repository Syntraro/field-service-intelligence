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

interface JobNote {
  id: string;
  jobId: string;
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
  };
  attachments?: NoteAttachment[];
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
}

export default function JobNotesSection({ jobId, embedded = false, onCountChange, hideAddButton = false, hideHeader = false, showCount = true }: JobNotesSectionProps) {
  // Canonical dialog: `editingNote === null` with `dialogOpen === true` → create mode;
  // `editingNote` set → edit mode. Single modal instance handles both.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<ExistingJobNote | null>(null);

  const { data: notes = [], isLoading } = useQuery<JobNote[]>({
    queryKey: ["/api/jobs", jobId, "notes"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/notes`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch job notes");
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
          {notes.map((note, idx) => (
            <div
              key={note.id}
              role="button"
              tabIndex={0}
              onClick={() => openEdit(note)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openEdit(note);
                }
              }}
              className={`group py-3 px-1 cursor-pointer rounded hover:bg-slate-50 transition-colors ${idx > 0 ? "border-t border-slate-200" : ""}`}
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
          ))}
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
      />
    </>
  );
}
