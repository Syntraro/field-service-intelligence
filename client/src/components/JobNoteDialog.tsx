/**
 * JobNoteDialog — canonical Add/Edit modal for job notes (2026-04-13).
 *
 * Single source of truth for both creating and editing a job note. Replaces
 * the previous `AddJobNoteDialog` create-only variant; the file is kept
 * removed to prevent parallel editors from reappearing.
 *
 * Mode semantics (driven by the `note` prop):
 *   - `note === null`  → CREATE mode. Empty fields, save POSTs a new note.
 *   - `note !== null` → EDIT mode. Text + existing attachments preload,
 *                       save PATCHes text, per-attachment remove is live,
 *                       "Delete note" is available.
 *
 * Attachment management:
 *   - Existing attachments render as a compact list with per-item remove
 *     (DELETE /api/jobs/:jobId/notes/:noteId/attachments/:attachmentId —
 *     added to `server/routes/jobs.ts` for this commit).
 *   - Newly staged files use the canonical `useFileUpload` hook. In CREATE
 *     mode they're uploaded after the note is created; in EDIT mode they
 *     upload directly against the existing noteId.
 *   - Cascade on note delete stays the mechanism for "remove all". The
 *     "Delete all attachments" button iterates the per-item detach API so
 *     the note itself is preserved.
 *
 * All state is local to the dialog; the parent passes `note` + wires
 * `onOpenChange`. No query-layer side effects beyond invalidating
 * `/api/jobs/:jobId/notes` on success.
 */

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Paperclip, X, FileText, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useActivityStore } from "@/lib/activityStore";
import {
  resolveFileAccessUrl,
  SUPPORTED_MIME_TYPES,
  useFileUpload,
  validateFileClientSide,
} from "@/hooks/useFileUpload";

export interface ExistingNoteAttachment {
  id: string;
  noteId: string;
  fileId: string;
  originalName: string | null;
  mimeType: string | null;
  size: number | null;
}

export interface ExistingJobNote {
  id: string;
  noteText: string;
  attachments?: ExistingNoteAttachment[];
}

interface JobNoteDialogProps {
  jobId: string;
  /** `null` → create mode; a note object → edit mode. */
  note: ExistingJobNote | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface StagedFile {
  file: File;
  previewUrl?: string;
}

const ACCEPTED_TYPES = SUPPORTED_MIME_TYPES.join(",");

const formatSize = (bytes: number | null) => {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const isImageMime = (mime: string | null): boolean =>
  !!mime && mime.startsWith("image/");

/**
 * Compact thumbnail tile for a saved image attachment in edit mode.
 * Reuses the canonical `resolveFileAccessUrl` from `useFileUpload` — no
 * separate access-url resolver. Click opens the full-size image in a new
 * tab; the X button stops propagation so remove never triggers preview.
 */
function SavedImageThumb({
  attachment,
  disabled,
  onRemove,
}: {
  attachment: ExistingNoteAttachment;
  disabled: boolean;
  onRemove: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    resolveFileAccessUrl(attachment.fileId)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.fileId]);

  const handleOpen = async () => {
    try {
      const u = url ?? (await resolveFileAccessUrl(attachment.fileId));
      window.open(u, "_blank", "noopener,noreferrer");
    } catch {
      // swallow — non-critical preview action
    }
  };

  return (
    <div
      className="relative group"
      data-testid={`existing-attachment-thumb-${attachment.id}`}
    >
      <button
        type="button"
        onClick={handleOpen}
        className="h-20 w-20 overflow-hidden rounded-md border border-border/60 bg-muted/30 hover:ring-2 hover:ring-primary/40 transition-shadow"
        title={attachment.originalName ?? "Attachment"}
      >
        {loading ? (
          <div className="flex h-full w-full items-center justify-center">
            <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
          </div>
        ) : url ? (
          <img
            src={url}
            alt={attachment.originalName ?? "attachment"}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <FileText className="h-5 w-5 text-muted-foreground" />
          </div>
        )}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        disabled={disabled}
        aria-label={`Remove ${attachment.originalName ?? "image"}`}
        data-testid={`remove-existing-attachment-${attachment.id}`}
        className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-slate-900 text-white shadow-sm flex items-center justify-center opacity-80 hover:opacity-100 disabled:opacity-40"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

export function JobNoteDialog({ jobId, note, open, onOpenChange }: JobNoteDialogProps) {
  const { toast } = useToast();
  const { logActivity } = useActivityStore();
  const { upload, progress } = useFileUpload();

  const mode = note ? "edit" : "create";

  const [noteText, setNoteText] = useState("");
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<ExistingNoteAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadIndex, setUploadIndex] = useState(0);
  const [confirmDeleteNote, setConfirmDeleteNote] = useState(false);
  const [confirmRemoveAll, setConfirmRemoveAll] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (note) {
      setNoteText(note.noteText);
      setExistingAttachments(note.attachments ?? []);
    } else {
      setNoteText("");
      setExistingAttachments([]);
    }
    setStagedFiles([]);
    setBusy(false);
    setUploadIndex(0);
  }, [open, note]);

  // Revoke object URLs on unmount / staged-list change.
  useEffect(() => {
    return () => {
      stagedFiles.forEach((sf) => sf.previewUrl && URL.revokeObjectURL(sf.previewUrl));
    };
  }, [stagedFiles]);

  const invalidateNotes = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "notes"] });
  };

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const valid: StagedFile[] = [];
    for (const file of files) {
      const err = validateFileClientSide(file);
      if (err) {
        toast({ title: "File rejected", description: err, variant: "destructive" });
        continue;
      }
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      valid.push({ file, previewUrl });
    }
    setStagedFiles((prev) => [...prev, ...valid].slice(0, 10));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeStagedFile = (idx: number) => {
    setStagedFiles((prev) => {
      const removed = prev[idx];
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const detachExistingAttachment = async (attachmentId: string) => {
    if (!note) return;
    try {
      await apiRequest(
        `/api/jobs/${jobId}/notes/${note.id}/attachments/${attachmentId}`,
        { method: "DELETE" },
      );
      setExistingAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
      invalidateNotes();
    } catch (err: any) {
      toast({
        title: "Could not remove attachment",
        description: err?.message ?? "Try again",
        variant: "destructive",
      });
    }
  };

  const detachAllExisting = async () => {
    if (!note || existingAttachments.length === 0) return;
    setBusy(true);
    try {
      // Sequential — keeps error reporting straightforward and avoids
      // slamming the API for what's always a small list.
      for (const a of existingAttachments) {
        await apiRequest(
          `/api/jobs/${jobId}/notes/${note.id}/attachments/${a.id}`,
          { method: "DELETE" },
        );
      }
      setExistingAttachments([]);
      invalidateNotes();
      toast({ title: "All attachments removed" });
    } catch (err: any) {
      toast({
        title: "Could not remove all attachments",
        description: err?.message ?? "Try again",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = noteText.trim();
    if (!trimmed) {
      toast({ title: "Note required", description: "Text cannot be empty", variant: "destructive" });
      return;
    }

    setBusy(true);
    try {
      let targetNoteId: string;

      if (mode === "create") {
        const created = await apiRequest<{ id: string }>(`/api/jobs/${jobId}/notes`, {
          method: "POST",
          body: JSON.stringify({ noteText: trimmed }),
        });
        targetNoteId = created.id;
        logActivity({
          type: "created",
          entityType: "job",
          entityId: jobId,
          label: "Added Note",
          meta: trimmed.slice(0, 60) || undefined,
        });
      } else {
        targetNoteId = note!.id;
        if (trimmed !== note!.noteText) {
          await apiRequest(`/api/jobs/${jobId}/notes/${targetNoteId}`, {
            method: "PATCH",
            body: JSON.stringify({ noteText: trimmed }),
          });
          logActivity({
            type: "updated",
            entityType: "job",
            entityId: jobId,
            label: "Edited Note",
            meta: trimmed.slice(0, 60) || undefined,
          });
        }
      }

      for (let i = 0; i < stagedFiles.length; i++) {
        setUploadIndex(i);
        await upload(stagedFiles[i].file, {
          entityType: "job_note",
          entityId: targetNoteId,
        });
      }

      invalidateNotes();
      toast({
        title: mode === "create" ? "Note added" : "Note updated",
      });
      onOpenChange(false);
    } catch (err: any) {
      toast({
        title: "Save failed",
        description: err?.message ?? "Could not save note",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteNote = async () => {
    if (!note) return;
    setConfirmDeleteNote(false);
    setBusy(true);
    try {
      await apiRequest(`/api/jobs/${jobId}/notes/${note.id}`, { method: "DELETE" });
      invalidateNotes();
      toast({ title: "Note deleted" });
      onOpenChange(false);
    } catch (err: any) {
      toast({
        title: "Delete failed",
        description: err?.message ?? "Could not delete note",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-job-note">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{mode === "create" ? "Add Note" : "Edit Note"}</DialogTitle>
              <DialogDescription>
                {mode === "create"
                  ? "Add a note to track job details and communication."
                  : "Update the note text, add or remove attachments."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="noteText">Note</Label>
                <Textarea
                  id="noteText"
                  rows={5}
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Enter your note here..."
                  required
                  disabled={busy}
                  data-testid="input-note-text"
                  className="resize-none"
                />
              </div>

              {/* Saved attachments (edit mode only) — images as thumbnail
                  grid, non-images as compact file chips. */}
              {mode === "edit" && existingAttachments.length > 0 && (() => {
                const savedImages = existingAttachments.filter((a) => isImageMime(a.mimeType));
                const savedFiles = existingAttachments.filter((a) => !isImageMime(a.mimeType));
                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs flex items-center gap-2">
                        Saved attachments
                        <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                          {existingAttachments.length}
                        </span>
                      </Label>
                      {existingAttachments.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                          onClick={() => setConfirmRemoveAll(true)}
                          disabled={busy}
                          data-testid="button-remove-all-attachments"
                        >
                          Remove all
                        </Button>
                      )}
                    </div>

                    {savedImages.length > 0 && (
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {savedImages.map((a) => (
                          <SavedImageThumb
                            key={a.id}
                            attachment={a}
                            disabled={busy}
                            onRemove={() => detachExistingAttachment(a.id)}
                          />
                        ))}
                      </div>
                    )}

                    {savedFiles.length > 0 && (
                      <div className="space-y-1.5">
                        {savedFiles.map((a) => (
                          <div
                            key={a.id}
                            className="flex items-center gap-2 rounded border border-border/60 px-2 py-1.5 bg-muted/30"
                            data-testid={`existing-attachment-${a.id}`}
                          >
                            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs truncate">{a.originalName ?? "Attachment"}</p>
                              <p className="text-[11px] text-muted-foreground">{formatSize(a.size)}</p>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive"
                              onClick={() => detachExistingAttachment(a.id)}
                              disabled={busy}
                              aria-label={`Remove ${a.originalName ?? "attachment"}`}
                              data-testid={`remove-existing-attachment-${a.id}`}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* New attachments (staged, not yet uploaded) */}
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-2">
                  New attachments
                  {stagedFiles.length > 0 && (
                    <span className="inline-flex items-center rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                      {stagedFiles.length} staged
                    </span>
                  )}
                </Label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1.5"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={busy}
                    data-testid="button-attach-file"
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                    Attach files
                  </Button>
                  <span className="text-[11px] text-muted-foreground">
                    Images ≤10 MB, PDFs ≤20 MB
                  </span>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_TYPES}
                  multiple
                  className="hidden"
                  onChange={handleFilePick}
                />
                {stagedFiles.length > 0 && (
                  <div className="space-y-1.5">
                    {stagedFiles.map((sf, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 rounded border border-emerald-200 px-2 py-1.5 bg-emerald-50/50"
                        data-testid={`staged-file-${idx}`}
                      >
                        {sf.previewUrl ? (
                          <img src={sf.previewUrl} alt="" className="h-8 w-8 rounded object-cover shrink-0" />
                        ) : (
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs truncate">{sf.file.name}</p>
                          <p className="text-[11px] text-muted-foreground">{formatSize(sf.file.size)}</p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeStagedFile(idx)}
                          disabled={busy}
                          aria-label={`Remove ${sf.file.name}`}
                          data-testid={`remove-file-${idx}`}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {busy && stagedFiles.length > 0 && (
              <div className="text-[11px] text-muted-foreground mb-2">
                Uploading {Math.min(uploadIndex + 1, stagedFiles.length)} of {stagedFiles.length}
                {" — "}
                {Math.round(progress * 100)}%
              </div>
            )}

            <DialogFooter className="flex-col gap-2 border-t pt-3 sm:flex-row sm:justify-between sm:gap-3">
              {mode === "edit" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setConfirmDeleteNote(true)}
                  disabled={busy}
                  data-testid="button-delete-note"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Delete note
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={busy}
                  data-testid="button-cancel-note"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={busy || !noteText.trim()}
                  data-testid="button-save-note"
                >
                  {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {mode === "create" ? "Add note" : "Save changes"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDeleteNote} onOpenChange={setConfirmDeleteNote}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this note?</AlertDialogTitle>
            <AlertDialogDescription>
              The note and any attachments will be removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteNote}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmRemoveAll} onOpenChange={setConfirmRemoveAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove all saved attachments?</AlertDialogTitle>
            <AlertDialogDescription>
              This detaches every saved attachment on this note. The note itself stays. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmRemoveAll(false);
                void detachAllExisting();
              }}
            >
              Remove all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
