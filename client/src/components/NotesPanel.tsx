/**
 * NotesPanel — reusable notes component with multi-file attachments
 * and visibility flags (Jobs / Invoices / Quotes).
 *
 * Props:
 *   scope: "location" | "company"
 *   companyId: string (customerCompanyId when scope = "company")
 *   locationId?: string (required when scope = "location")
 */
import { useState, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Trash2, Loader2, StickyNote, Paperclip, X, Download, ImageIcon, FileIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import type { ClientNote } from "@shared/schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/* ── Types ─────────────────────────────────────── */

interface Attachment {
  id: string;
  fileId: string;
  originalName: string | null;
  mimeType: string | null;
  size: number | null;
}

interface NoteWithAttachments extends ClientNote {
  attachments?: Attachment[];
  createdByName?: string;
}

interface PendingFile {
  file: File;
  preview?: string; // object URL for images
}

interface NotesPanelProps {
  scope: "location" | "company";
  companyId: string;
  locationId?: string;
  hideAddButton?: boolean;
}

/** Ref handle for controlling NotesPanel from parent (e.g. header "+ Add" button) */
export interface NotesPanelRef {
  startAdding: () => void;
}

/* ── Helpers ───────────────────────────────────── */

function apiBase(scope: string, companyId: string, locationId?: string) {
  return scope === "location"
    ? `/api/locations/${locationId}/notes`
    : `/api/customer-companies/${companyId}/notes`;
}

function isImage(mime: string | null) {
  return !!mime && mime.startsWith("image/");
}

function formatBytes(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── Component ─────────────────────────────────── */

const NotesPanel = forwardRef<NotesPanelRef, NotesPanelProps>(function NotesPanel(
  { scope, companyId, locationId, hideAddButton = false },
  ref
) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [isAdding, setIsAdding] = useState(false);

  // Expose startAdding to parent via ref
  useImperativeHandle(ref, () => ({ startAdding: () => setIsAdding(true) }), []);
  const [noteText, setNoteText] = useState("");
  const [showOnJobs, setShowOnJobs] = useState(false);
  const [showOnInvoices, setShowOnInvoices] = useState(false);
  const [showOnQuotes, setShowOnQuotes] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);

  // Edit state
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editShowOnJobs, setEditShowOnJobs] = useState(false);
  const [editShowOnInvoices, setEditShowOnInvoices] = useState(false);
  const [editShowOnQuotes, setEditShowOnQuotes] = useState(false);

  // Delete state
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null);

  const base = apiBase(scope, companyId, locationId);
  const qk = scope === "location"
    ? ["/api/locations", locationId, "notes"]
    : ["/api/customer-companies", companyId, "notes"];

  // ── Queries ───────────────────────────────────

  const { data: notes = [], isLoading } = useQuery<NoteWithAttachments[]>({
    queryKey: qk,
    queryFn: () => apiRequest(base),
    enabled: scope === "location" ? Boolean(locationId) : Boolean(companyId),
  });

  // ── Mutations ─────────────────────────────────

  const uploadFilesMutation = useMutation({
    mutationFn: async (files: File[]): Promise<{ fileId: string }[]> => {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      return apiRequest("/api/uploads", { method: "POST", body: form as any });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: {
      noteText: string;
      showOnJobs: boolean;
      showOnInvoices: boolean;
      showOnQuotes: boolean;
      attachmentFileIds: string[];
    }) => apiRequest(base, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk });
      resetForm();
      toast({ title: "Note added" });
    },
    onError: () => toast({ title: "Error", description: "Failed to add note.", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ noteId, ...body }: { noteId: string; noteText: string; showOnJobs: boolean; showOnInvoices: boolean; showOnQuotes: boolean }) =>
      apiRequest(`${base}/${noteId}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk });
      setEditingNoteId(null);
      toast({ title: "Note updated" });
    },
    onError: () => toast({ title: "Error", description: "Failed to update note.", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (noteId: string) => apiRequest(`${base}/${noteId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk });
      setDeleteNoteId(null);
      toast({ title: "Note deleted" });
    },
    onError: () => toast({ title: "Error", description: "Failed to delete note.", variant: "destructive" }),
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: async ({ noteId, attachmentId }: { noteId: string; attachmentId: string }) =>
      apiRequest(`/api/notes/${noteId}/attachments/${attachmentId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk });
      toast({ title: "Attachment removed" });
    },
    onError: () => toast({ title: "Error", description: "Failed to remove attachment.", variant: "destructive" }),
  });

  // ── Helpers ───────────────────────────────────

  const resetForm = useCallback(() => {
    setIsAdding(false);
    setNoteText("");
    setShowOnJobs(false);
    setShowOnInvoices(false);
    setShowOnQuotes(false);
    pendingFiles.forEach((pf) => pf.preview && URL.revokeObjectURL(pf.preview));
    setPendingFiles([]);
  }, [pendingFiles]);

  const handleFilesSelected = (fileList: FileList | null) => {
    if (!fileList) return;
    const newFiles: PendingFile[] = Array.from(fileList).map((f) => ({
      file: f,
      preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
    }));
    setPendingFiles((prev) => [...prev, ...newFiles]);
  };

  const removePendingFile = (idx: number) => {
    setPendingFiles((prev) => {
      const pf = prev[idx];
      if (pf.preview) URL.revokeObjectURL(pf.preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleCreate = async () => {
    const text = noteText.trim();
    if (!text) return;

    let fileIds: string[] = [];
    if (pendingFiles.length > 0) {
      try {
        const results = await uploadFilesMutation.mutateAsync(pendingFiles.map((pf) => pf.file));
        fileIds = results.map((r) => r.fileId);
      } catch {
        toast({ title: "Upload failed", description: "Could not upload files.", variant: "destructive" });
        return;
      }
    }

    createMutation.mutate({
      noteText: text,
      showOnJobs,
      showOnInvoices,
      showOnQuotes,
      attachmentFileIds: fileIds,
    });
  };

  const startEdit = (note: NoteWithAttachments) => {
    setEditingNoteId(note.id);
    setEditText(note.noteText);
    setEditShowOnJobs(note.showOnJobs ?? false);
    setEditShowOnInvoices(note.showOnInvoices ?? false);
    setEditShowOnQuotes(note.showOnQuotes ?? false);
  };

  const isBusy = createMutation.isPending || uploadFilesMutation.isPending;

  // ── Render ────────────────────────────────────

  if (isLoading) {
    return <div className="py-4 text-sm text-muted-foreground">Loading notes...</div>;
  }

  return (
    <>
      <div className="space-y-2">
        {/* Add button (hidden when parent provides its own header button) */}
        {!hideAddButton && !isAdding && (
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" className="text-xs h-auto p-0 text-primary" onClick={() => setIsAdding(true)} data-testid="button-add-note">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Note
            </Button>
          </div>
        )}

        {/* ── Add Note Form ────────────────────── */}
        {isAdding && (
          <div className="space-y-3 p-4 border rounded-md bg-muted/30">
            <Textarea
              placeholder="Enter your note..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              rows={3}
              data-testid="textarea-new-note"
            />

            {/* Visibility checkboxes */}
            <div className="flex flex-wrap gap-4 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Checkbox checked={showOnJobs} onCheckedChange={(v) => setShowOnJobs(v === true)} />
                Show on Jobs
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Checkbox checked={showOnInvoices} onCheckedChange={(v) => setShowOnInvoices(v === true)} />
                Show on Invoices
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Checkbox checked={showOnQuotes} onCheckedChange={(v) => setShowOnQuotes(v === true)} />
                Show on Quotes
              </label>
            </div>

            {/* File picker + pending files list */}
            <div className="space-y-2">
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleFilesSelected(e.target.files)} />
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} type="button">
                <Paperclip className="h-3.5 w-3.5 mr-1.5" /> Attach Files
              </Button>
              {pendingFiles.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {pendingFiles.map((pf, i) => (
                    <div key={i} className="flex items-center gap-1.5 px-2 py-1 border rounded text-xs bg-background">
                      {pf.preview ? (
                        <img src={pf.preview} alt="" className="h-6 w-6 rounded object-cover" />
                      ) : (
                        <FileIcon className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="max-w-[120px] truncate">{pf.file.name}</span>
                      <button type="button" onClick={() => removePendingFile(i)} className="text-muted-foreground hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={resetForm}>Cancel</Button>
              <Button size="sm" onClick={handleCreate} disabled={!noteText.trim() || isBusy}>
                {isBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Note
              </Button>
            </div>
          </div>
        )}

        {/* ── Notes List ───────────────────────── */}
        {notes.length === 0 && !isAdding ? (
          <div className="flex items-center justify-center gap-1.5 py-2 text-muted-foreground">
            <StickyNote className="h-3.5 w-3.5 opacity-30" />
            <p className="text-[11px]">No notes yet.</p>
          </div>
        ) : (
          notes.map((note) => (
            <div key={note.id} className="px-3 py-2.5 border rounded-md text-sm overflow-hidden" data-testid={`note-${note.id}`}>
              {editingNoteId === note.id ? (
                /* ── Inline Edit ─── */
                <div className="space-y-3">
                  <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} data-testid="textarea-edit-note" />
                  <div className="flex flex-wrap gap-4 text-xs">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <Checkbox checked={editShowOnJobs} onCheckedChange={(v) => setEditShowOnJobs(v === true)} />
                      Show on Jobs
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <Checkbox checked={editShowOnInvoices} onCheckedChange={(v) => setEditShowOnInvoices(v === true)} />
                      Show on Invoices
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <Checkbox checked={editShowOnQuotes} onCheckedChange={(v) => setEditShowOnQuotes(v === true)} />
                      Show on Quotes
                    </label>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditingNoteId(null)}>Cancel</Button>
                    <Button
                      size="sm"
                      onClick={() => updateMutation.mutate({ noteId: note.id, noteText: editText.trim(), showOnJobs: editShowOnJobs, showOnInvoices: editShowOnInvoices, showOnQuotes: editShowOnQuotes })}
                      disabled={!editText.trim() || updateMutation.isPending}
                    >
                      {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                /* ── Read View ──── */
                <>
                  <p className="whitespace-pre-wrap break-words text-xs" style={{ overflowWrap: "anywhere" }}>{note.noteText}</p>

                  {/* Visibility badges */}
                  {(note.showOnJobs || note.showOnInvoices || note.showOnQuotes) && (
                    <div className="flex gap-1.5 mt-2">
                      {note.showOnJobs && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">Jobs</span>}
                      {note.showOnInvoices && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700">Invoices</span>}
                      {note.showOnQuotes && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700">Quotes</span>}
                    </div>
                  )}

                  {/* Attachments */}
                  {note.attachments && note.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {note.attachments.map((att) =>
                        isImage(att.mimeType) ? (
                          <a key={att.id} href={`/api/files/${att.fileId}`} target="_blank" rel="noopener noreferrer" className="block">
                            <img src={`/api/files/${att.fileId}`} alt={att.originalName || ""} className="h-16 w-16 rounded border object-cover hover:opacity-80" />
                          </a>
                        ) : (
                          <a
                            key={att.id}
                            href={`/api/files/${att.fileId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-2 py-1 border rounded text-xs hover:bg-muted"
                          >
                            {att.mimeType?.startsWith("image/") ? <ImageIcon className="h-3.5 w-3.5" /> : <FileIcon className="h-3.5 w-3.5" />}
                            <span className="max-w-[120px] truncate">{att.originalName || "file"}</span>
                            <span className="text-muted-foreground">{formatBytes(att.size)}</span>
                            <Download className="h-3 w-3 text-muted-foreground" />
                          </a>
                        )
                      )}
                    </div>
                  )}

                  {/* Compact metadata: "Author · Date, Time" + actions */}
                  <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
                    <span className="truncate mr-2">
                      {note.createdByName || "Unknown"} · {note.createdAt && format(new Date(note.createdAt), "MMM d, h:mm a")}
                    </span>
                    <div className="flex gap-1 flex-shrink-0">
                      <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground" onClick={() => startEdit(note)} data-testid={`button-edit-note-${note.id}`}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive" onClick={() => setDeleteNoteId(note.id)} data-testid={`button-delete-note-${note.id}`}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={Boolean(deleteNoteId)} onOpenChange={() => setDeleteNoteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Note</AlertDialogTitle>
            <AlertDialogDescription>Are you sure? This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteNoteId && deleteMutation.mutate(deleteNoteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});

export default NotesPanel;
