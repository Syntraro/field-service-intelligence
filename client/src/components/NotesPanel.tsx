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
import { NoteAttachmentStrip } from "@/components/attachments/NoteAttachmentStrip";
import {
  SUPPORTED_MIME_TYPES,
  useFileUpload,
  validateFileClientSide,
} from "@/hooks/useFileUpload";
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
  storageProvider?: string | null;
  status?: string | null;
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
  // 2026-04-18 attachment-edit state — stage-then-commit so Cancel is a no-op
  // at the server. Loaded from note.attachments on startEdit. Commit runs on
  // Save: PATCH → DELETE(each markedForRemoval) → upload(each pendingFile).
  const [editExistingAttachments, setEditExistingAttachments] = useState<Attachment[]>([]);
  const [editMarkedForRemoval, setEditMarkedForRemoval] = useState<Set<string>>(new Set());
  const [editPendingFiles, setEditPendingFiles] = useState<PendingFile[]>([]);
  const [isEditSaving, setIsEditSaving] = useState(false);
  const editFileInputRef = useRef<HTMLInputElement>(null);

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

  // 2026-04-12 Phase 2: client notes use the canonical R2 lifecycle via
  // useFileUpload. The create path is note-first → per-file 3-step upload.
  const { upload: uploadAttachment, isUploading: isAttachmentUploading } = useFileUpload();

  const createNoteMutation = useMutation({
    mutationFn: async (payload: {
      noteText: string;
      showOnJobs: boolean;
      showOnInvoices: boolean;
      showOnQuotes: boolean;
    }) => apiRequest<{ id: string }>(base, { method: "POST", body: JSON.stringify(payload) }),
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

  // 2026-04-18: detach is invoked directly by the edit-save batch below via
  // `apiRequest` so removals + uploads can share a single query invalidation
  // at the end. A dedicated mutation hook would invalidate per-call and
  // trigger N redundant refetches for N attachments.

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

    try {
      // Step 1 — create the note. We need a persisted noteId before any
      // attachment can be placed under tenants/.../notes/{noteId}/.
      const note = await createNoteMutation.mutateAsync({
        noteText: text,
        showOnJobs,
        showOnInvoices,
        showOnQuotes,
      });

      // Step 2 — upload staged attachments via the R2 3-step lifecycle.
      // Each successful finalize also inserts the note_attachments join row.
      for (const pf of pendingFiles) {
        const err = validateFileClientSide(pf.file);
        if (err) {
          toast({ title: "File rejected", description: err, variant: "destructive" });
          continue;
        }
        try {
          await uploadAttachment(pf.file, { entityType: "client_note", entityId: note.id });
        } catch (e: any) {
          toast({
            title: "Upload failed",
            description: e?.message || "File failed to upload.",
            variant: "destructive",
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: qk });
      resetForm();
      toast({ title: "Note added" });
    } catch {
      toast({ title: "Error", description: "Failed to add note.", variant: "destructive" });
    }
  };

  const startEdit = (note: NoteWithAttachments) => {
    // Revoke any object URLs from a prior open-edit session before we
    // drop the reference — prevents URL leaks when switching between
    // notes without going through Cancel.
    editPendingFiles.forEach((pf) => pf.preview && URL.revokeObjectURL(pf.preview));
    setEditingNoteId(note.id);
    setEditText(note.noteText);
    setEditShowOnJobs(note.showOnJobs ?? false);
    setEditShowOnInvoices(note.showOnInvoices ?? false);
    setEditShowOnQuotes(note.showOnQuotes ?? false);
    setEditExistingAttachments(note.attachments ?? []);
    setEditMarkedForRemoval(new Set());
    setEditPendingFiles([]);
  };

  const cancelEdit = () => {
    // Revoke staged object URLs to avoid leaks. No server traffic — Cancel
    // is intentionally a no-op at the API level.
    editPendingFiles.forEach((pf) => pf.preview && URL.revokeObjectURL(pf.preview));
    setEditingNoteId(null);
    setEditExistingAttachments([]);
    setEditMarkedForRemoval(new Set());
    setEditPendingFiles([]);
  };

  const toggleMarkForRemoval = (attachmentId: string) => {
    setEditMarkedForRemoval((prev) => {
      const next = new Set(prev);
      if (next.has(attachmentId)) next.delete(attachmentId);
      else next.add(attachmentId);
      return next;
    });
  };

  const handleEditFilesSelected = (fileList: FileList | null) => {
    if (!fileList) return;
    const newFiles: PendingFile[] = Array.from(fileList).map((f) => ({
      file: f,
      preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
    }));
    setEditPendingFiles((prev) => [...prev, ...newFiles]);
  };

  const removeEditPendingFile = (idx: number) => {
    setEditPendingFiles((prev) => {
      const pf = prev[idx];
      if (pf.preview) URL.revokeObjectURL(pf.preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleEditSave = async (noteId: string) => {
    const text = editText.trim();
    if (!text) return;
    setIsEditSaving(true);
    try {
      // 1) PATCH text + visibility flags. PATCH does not touch attachments,
      //    so text/visibility-only saves cannot duplicate or drop files.
      //    Using apiRequest directly so we can batch invalidation + toasting
      //    across all three steps below.
      await apiRequest(`${base}/${noteId}`, {
        method: "PATCH",
        body: JSON.stringify({
          noteText: text,
          showOnJobs: editShowOnJobs,
          showOnInvoices: editShowOnInvoices,
          showOnQuotes: editShowOnQuotes,
        }),
      });

      // 2) Detach any attachments the user marked for removal. Tenant
      //    isolation + 404 handling lives in the canonical route.
      for (const attachmentId of Array.from(editMarkedForRemoval)) {
        try {
          await apiRequest(`/api/notes/${noteId}/attachments/${attachmentId}`, {
            method: "DELETE",
          });
        } catch (e: any) {
          toast({
            title: "Remove failed",
            description: e?.message || "Failed to remove attachment.",
            variant: "destructive",
          });
        }
      }

      // 3) Upload any newly staged files. The R2 lifecycle's ensureAttachment
      //    is idempotent, so a retried upload will not double-insert the
      //    note_attachments join row.
      for (const pf of editPendingFiles) {
        const err = validateFileClientSide(pf.file);
        if (err) {
          toast({ title: "File rejected", description: err, variant: "destructive" });
          continue;
        }
        try {
          await uploadAttachment(pf.file, { entityType: "client_note", entityId: noteId });
        } catch (e: any) {
          toast({
            title: "Upload failed",
            description: e?.message || "File failed to upload.",
            variant: "destructive",
          });
        }
      }

      // 4) One invalidation at the end — refetches the note list including
      //    updated attachment metadata.
      queryClient.invalidateQueries({ queryKey: qk });
      toast({ title: "Note updated" });
      cancelEdit();
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message || "Failed to update note.",
        variant: "destructive",
      });
    } finally {
      setIsEditSaving(false);
    }
  };

  const isBusy = createNoteMutation.isPending || isAttachmentUploading;

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
            <p className="text-xs">No notes yet.</p>
          </div>
        ) : (
          notes.map((note) => (
            <div key={note.id} className="px-3 py-2.5 border border-slate-200 border-l-2 border-l-slate-300 rounded-md text-sm overflow-hidden group" data-testid={`note-${note.id}`}>
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

                  {/* Existing attachments (staged for removal with X). Hidden
                      when empty so the edit panel stays compact. */}
                  {editExistingAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {editExistingAttachments.map((att) => {
                        const marked = editMarkedForRemoval.has(att.id);
                        return (
                          <div
                            key={att.id}
                            className={`flex items-center gap-1.5 px-2 py-1 border rounded text-xs bg-background ${marked ? "opacity-50 line-through" : ""}`}
                            data-testid={`edit-existing-attachment-${att.id}`}
                          >
                            {isImage(att.mimeType) ? (
                              <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <FileIcon className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                            <span className="max-w-[140px] truncate" title={att.originalName ?? "Attachment"}>
                              {att.originalName ?? "Attachment"}
                            </span>
                            {att.size != null && (
                              <span className="text-muted-foreground">{formatBytes(att.size)}</span>
                            )}
                            <button
                              type="button"
                              onClick={() => toggleMarkForRemoval(att.id)}
                              className="text-muted-foreground hover:text-destructive"
                              aria-label={marked ? "Undo remove" : `Remove ${att.originalName ?? "attachment"}`}
                              data-testid={`edit-toggle-remove-${att.id}`}
                            >
                              {marked ? <Plus className="h-3 w-3" /> : <X className="h-3 w-3" />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* File picker for additional attachments staged during edit. */}
                  <div className="space-y-2">
                    <input
                      ref={editFileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => handleEditFilesSelected(e.target.files)}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => editFileInputRef.current?.click()}
                      type="button"
                      data-testid="edit-attach-files"
                    >
                      <Paperclip className="h-3.5 w-3.5 mr-1.5" /> Attach Files
                    </Button>
                    {editPendingFiles.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {editPendingFiles.map((pf, i) => (
                          <div key={i} className="flex items-center gap-1.5 px-2 py-1 border rounded text-xs bg-background">
                            {pf.preview ? (
                              <img src={pf.preview} alt="" className="h-6 w-6 rounded object-cover" />
                            ) : (
                              <FileIcon className="h-4 w-4 text-muted-foreground" />
                            )}
                            <span className="max-w-[120px] truncate">{pf.file.name}</span>
                            <button
                              type="button"
                              onClick={() => removeEditPendingFile(i)}
                              className="text-muted-foreground hover:text-destructive"
                              aria-label={`Remove ${pf.file.name}`}
                              data-testid={`edit-remove-pending-${i}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={cancelEdit}>Cancel</Button>
                    <Button
                      size="sm"
                      onClick={() => handleEditSave(note.id)}
                      disabled={!editText.trim() || isEditSaving}
                      data-testid={`button-save-edit-${note.id}`}
                    >
                      {isEditSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                /* ── Read View ──── */
                <>
                  <p className="whitespace-pre-wrap break-words text-xs leading-relaxed" style={{ overflowWrap: "anywhere" }}>{note.noteText}</p>

                  {/* Visibility badges */}
                  {(note.showOnJobs || note.showOnInvoices || note.showOnQuotes) && (
                    <div className="flex gap-1.5 mt-2.5">
                      {note.showOnJobs && <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">Jobs</span>}
                      {note.showOnInvoices && <span className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-700">Invoices</span>}
                      {note.showOnQuotes && <span className="text-xs px-1.5 py-0.5 rounded bg-purple-50 text-purple-700">Quotes</span>}
                    </div>
                  )}

                  {/* Compact Jobber-style attachment strip — images as 56px thumbs + lightbox, non-images as chips */}
                  {note.attachments && note.attachments.length > 0 && (
                    <div className="mt-2.5">
                      <NoteAttachmentStrip attachments={note.attachments} />
                    </div>
                  )}

                  {/* Compact metadata: "Author · Date, Time" + actions.
                      Footer is smaller and more muted; the action buttons
                      sit at idle opacity-50 and reach full opacity on card
                      hover so they don't compete with the body at rest. */}
                  <div className="flex items-center justify-between mt-3 text-[11px] text-muted-foreground">
                    <span className="truncate mr-2">
                      {note.createdByName || "Unknown"} · {note.createdAt && format(new Date(note.createdAt), "MMM d, h:mm a")}
                    </span>
                    <div className="flex gap-1 flex-shrink-0 opacity-50 group-hover:opacity-100 transition-opacity">
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
