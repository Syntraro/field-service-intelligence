import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageSquare, Trash2, FileText, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AddJobNoteDialog } from "./AddJobNoteDialog";

/** Attachment metadata returned from API */
interface NoteAttachment {
  id: string;
  noteId: string;
  fileId: string;
  originalName: string | null;
  mimeType: string | null;
  size: number | null;
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
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const { data: notes = [], isLoading } = useQuery<JobNote[]>({
    queryKey: ["/api/jobs", jobId, "notes"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/notes`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch job notes");
      return res.json();
    },
  });

  // Report count to parent when notes change
  useEffect(() => {
    onCountChange?.(notes.length);
  }, [notes.length, onCountChange]);

  const deleteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      await apiRequest(`/api/jobs/${jobId}/notes/${noteId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "notes"] });
      toast({ title: "Note Deleted", description: "The note has been removed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete note.", variant: "destructive" });
    },
  });

  const getUserName = (note: JobNote) => note.userName;
  const isImage = (mime: string | null) => mime?.startsWith("image/") ?? false;

  // Header bar: "Notes (X)" on left, "+ Add Note" on right
  // The sidebar collapse arrow is rendered by the parent (JobDetailPage), not here.
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
          onClick={() => setIsAddDialogOpen(true)}
          data-testid="button-add-note"
        >
          + Add Note
        </button>
      )}
    </div>
  );

  // Notes list — always visible (no vertical collapse)
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
              className={`group py-3 px-1 ${idx > 0 ? "border-t border-slate-200" : ""}`}
              data-testid={`note-${note.id}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">{getUserName(note)}</span>
                  {" · "}
                  {format(new Date(note.createdAt), "MMM d, h:mm a")}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => deleteMutation.mutate(note.id)}
                  disabled={deleteMutation.isPending}
                  data-testid={`button-delete-note-${note.id}`}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <p className="text-[14px] leading-5 whitespace-pre-wrap mt-0.5 text-slate-800">{note.noteText}</p>

              {/* Attachments display */}
              {note.attachments && note.attachments.length > 0 && (
                <div className="mt-1.5 space-y-1">
                  {note.attachments.map((att) => (
                    <a
                      key={att.id}
                      href={`/api/files/${att.fileId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded border border-border/50 px-2 py-1 bg-muted/20 hover:bg-muted/40 transition-colors group/att"
                      data-testid={`attachment-${att.id}`}
                    >
                      {isImage(att.mimeType) ? (
                        <img
                          src={`/api/files/${att.fileId}`}
                          alt={att.originalName ?? "attachment"}
                          className="h-8 w-8 rounded object-cover shrink-0"
                        />
                      ) : (
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <span className="text-[11px] truncate flex-1">{att.originalName ?? "File"}</span>
                      <Download className="h-3 w-3 text-muted-foreground opacity-0 group-hover/att:opacity-100 transition-opacity shrink-0" />
                    </a>
                  ))}
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

      <AddJobNoteDialog
        jobId={jobId}
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
      />
    </>
  );
}
