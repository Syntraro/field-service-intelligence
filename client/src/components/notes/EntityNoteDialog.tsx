/**
 * EntityNoteDialog — canonical Add/Edit modal for entity-scoped notes
 * (job / invoice / quote). Extracted from `JobNoteDialog` 2026-05-02 as
 * Audit #2 PR 3B. Behavior is byte-equivalent to the prior `JobNoteDialog`
 * for `entityType="job"` and `entityType="invoice"`; the `quote` branch
 * was added for the upcoming `EntityNotesSection` consolidation but has
 * NO consumer in PR 3B (so any quote-specific UI paths are exercised
 * only by future PRs).
 *
 * Mode semantics (driven by the `note` prop):
 *   - `note === null`  → CREATE mode. Empty fields, save POSTs a new note.
 *   - `note !== null`  → EDIT mode. Text + existing attachments preload,
 *                        save PATCHes text, per-attachment remove is live,
 *                        "Delete note" is available.
 *
 * Endpoint resolver:
 *   - "job"     → /api/jobs/${entityId}/notes        (entityId = jobId)
 *   - "invoice" → /api/jobs/${entityId}/notes        (invoice notes are
 *                                                     stored under jobs;
 *                                                     this matches the
 *                                                     pre-extraction
 *                                                     JobNotesSection
 *                                                     `source="invoice"`
 *                                                     write path)
 *   - "quote"   → /api/quotes/${entityId}/notes      (entityId = quoteId)
 *
 * Attachment management:
 *   - Existing attachments render as a compact list with per-item remove
 *     (DELETE ${basePath}/${noteId}/attachments/${attachmentId}).
 *   - Newly staged files use the canonical `useFileUpload` hook, which
 *     binds files to a note via the backend `FileEntityType` enum. Today
 *     that enum supports "job_note" but NOT "quote_note" — so quote
 *     attachments via this dialog are blocked at the upload step. The
 *     dialog still renders the staged-file UI for quote so the future
 *     backend addition is a one-line change here. Until then no caller
 *     uses `entityType="quote"`.
 *   - Cascade on note delete remains the canonical bulk-remove path.
 *
 * All state is local to the dialog; the parent passes `note` + wires
 * `onOpenChange`. No query-layer side effects beyond invalidating the
 * canonical read key (and any `extraInvalidationKey` the parent passes,
 * e.g. the Invoice Detail surface).
 */

import { useEffect, useRef, useState } from "react";
// 2026-05-09: nested AlertDialogs migrated to ConfirmModal.
// 2026-05-10 Phase 2D: outer Dialog migrated to ModalShell.
import {
  ConfirmModal,
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
} from "@/components/ui/modal";
import { InlineTextarea } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { Loader2, Paperclip, X, FileText, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  resolveFileAccessUrl,
  SUPPORTED_MIME_TYPES,
  useFileUpload,
  validateFileClientSide,
} from "@/hooks/useFileUpload";

export type EntityNoteEntityType = "job" | "invoice" | "quote" | "lead";

export interface ExistingNoteAttachment {
  id: string;
  noteId: string;
  fileId: string;
  originalName: string | null;
  mimeType: string | null;
  size: number | null;
}

export interface ExistingEntityNote {
  id: string;
  noteText: string;
  attachments?: ExistingNoteAttachment[];
}

interface EntityNoteDialogProps {
  /** Discriminator for endpoint resolution + activity logging.
   *  - "job": writes to /api/jobs/:entityId/notes.
   *  - "invoice": writes to /api/invoices/:entityId/notes (2026-05-03:
   *    invoice notes are now first-class; entityId is the INVOICE id,
   *    NOT a borrowed jobId).
   *  - "quote": writes to /api/quotes/:entityId/notes (added in PR 3A).
   */
  entityType: EntityNoteEntityType;
  /** jobId for "job"; invoiceId for "invoice"; quoteId for "quote". */
  entityId: string;
  /** `null` → create mode; a note object → edit mode. */
  note: ExistingEntityNote | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 2026-04-18 (preserved from JobNoteDialog): extra TanStack Query key
   *  to invalidate after a successful mutation. Used by the Invoice
   *  Detail surface, which reads notes from a different cache key
   *  (`/api/invoices/:id/notes`) — without this, the invoice notes feed
   *  wouldn't refresh after save/delete. */
  extraInvalidationKey?: readonly unknown[];
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
 * Endpoint resolver — single source of truth for the four note routes.
 * `basePath` is shared across POST / PATCH / DELETE; consumers append
 * `/${noteId}` (or `/${noteId}/attachments/${attachmentId}`) as needed.
 *
 * 2026-05-03: invoice now writes through /api/invoices/:invoiceId/notes
 * (its own first-class table). Previously invoice writes were funneled
 * through /api/jobs/:jobId/notes via a `writeEntityId` indirection,
 * which broke for invoices without a linked job.
 */
function resolveEndpoints(entityType: EntityNoteEntityType, entityId: string) {
  if (entityType === "quote") {
    return {
      basePath: `/api/quotes/${entityId}/notes`,
      readQueryKey: ["/api/quotes", entityId, "notes"] as const,
    };
  }
  if (entityType === "invoice") {
    return {
      basePath: `/api/invoices/${entityId}/notes`,
      readQueryKey: ["/api/invoices", entityId, "notes"] as const,
    };
  }
  // 2026-05-05: lead surface — same shape as quote/invoice. Server
  // emits the canonical envelope and accepts the same POST body
  // (noteText, attachmentFileIds) as the other surfaces.
  if (entityType === "lead") {
    return {
      basePath: `/api/leads/${entityId}/notes`,
      readQueryKey: ["/api/leads", entityId, "notes"] as const,
    };
  }
  return {
    basePath: `/api/jobs/${entityId}/notes`,
    readQueryKey: ["/api/jobs", entityId, "notes"] as const,
  };
}

/**
 * File-upload entityType — maps the dialog-level `entityType` to the
 * canonical `FileEntityType` recognized by the backend file-upload
 * service.
 *
 * 2026-05-02 (Audit #2 PR 3C): backend gained a `quote_note`
 * `FileEntityType` + adapter, so quote attachments now flow through
 * the same R2 upload pipeline as job/client notes.
 *
 * 2026-05-03: backend gained `invoice_note` (writes through
 * `invoice_note_attachments`). Invoice notes no longer borrow the
 * job-side adapter — file binds directly to the invoice-side note row.
 */
function fileUploadEntityFor(
  entityType: EntityNoteEntityType,
): "job_note" | "quote_note" | "invoice_note" | "lead_note" {
  if (entityType === "quote") return "quote_note";
  if (entityType === "invoice") return "invoice_note";
  // 2026-05-05 Lead Visits: lead_note maps to the lead-note adapter
  // in fileUploadService — same R2 lifecycle as the other surfaces.
  if (entityType === "lead") return "lead_note";
  // job uses `job_note`.
  return "job_note";
}

/**
 * Activity-log entity mapping.
 *
 * 2026-05-02 (Audit #2 PR 3C): quote notes log against `quote`.
 * 2026-05-03: invoice notes now log against `invoice` (first-class).
 *   Previously the invoice surface logged against the underlying job —
 *   correct under the prior "invoice borrows job notes" model, wrong
 *   now that invoice notes are independent.
 *
 * The activity store accepts the value via its existing
 * `entityType: string` field; no enum change needed.
 */
function activityLogEntityFor(
  entityType: EntityNoteEntityType,
): "job" | "quote" | "invoice" | "lead" {
  if (entityType === "quote") return "quote";
  if (entityType === "invoice") return "invoice";
  if (entityType === "lead") return "lead";
  return "job";
}

/**
 * Compact thumbnail tile for a saved image attachment in edit mode.
 * Reuses `resolveFileAccessUrl` from `useFileUpload` — no separate
 * access-url resolver. Click opens the full-size image in a new tab;
 * the X button stops propagation so remove never triggers preview.
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

export function EntityNoteDialog({
  entityType,
  entityId,
  note,
  open,
  onOpenChange,
  extraInvalidationKey,
}: EntityNoteDialogProps) {
  const { toast } = useToast();
  const { upload, progress } = useFileUpload();

  const endpoints = resolveEndpoints(entityType, entityId);
  const uploadEntity = fileUploadEntityFor(entityType);
  const activityEntity = activityLogEntityFor(entityType);

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
    queryClient.invalidateQueries({ queryKey: endpoints.readQueryKey as unknown as readonly unknown[] });
    if (extraInvalidationKey) {
      queryClient.invalidateQueries({ queryKey: extraInvalidationKey as unknown[] });
    }
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
        `${endpoints.basePath}/${note.id}/attachments/${attachmentId}`,
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
          `${endpoints.basePath}/${note.id}/attachments/${a.id}`,
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
        const created = await apiRequest<{ id: string }>(endpoints.basePath, {
          method: "POST",
          body: JSON.stringify({ noteText: trimmed }),
        });
        targetNoteId = created.id;
      } else {
        targetNoteId = note!.id;
        if (trimmed !== note!.noteText) {
          await apiRequest(`${endpoints.basePath}/${targetNoteId}`, {
            method: "PATCH",
            body: JSON.stringify({ noteText: trimmed }),
          });

        }
      }

      // 2026-05-02 (Audit #2 PR 3C): all three entity types now route
      // through the canonical R2 upload pipeline (job_note for
      // job/invoice, quote_note for quote). The PR 3B null-gate is
      // removed — uploads always run when files are staged.
      for (let i = 0; i < stagedFiles.length; i++) {
        setUploadIndex(i);
        await upload(stagedFiles[i].file, {
          entityType: uploadEntity,
          entityId: targetNoteId,
        });
      }

      invalidateNotes();
      if (mode === "create") {
        setNoteText("");
        setStagedFiles([]);
        setUploadIndex(0);
        onOpenChange(false);
      } else {
        toast({ title: "Note updated" });
        onOpenChange(false);
      }
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
      await apiRequest(`${endpoints.basePath}/${note.id}`, { method: "DELETE" });
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
      <ModalShell
        open={open}
        onOpenChange={onOpenChange}
        className="sm:max-w-md"
        data-testid="dialog-job-note"
      >
        <form onSubmit={handleSubmit}>
          <ModalHeader>
            <ModalTitle>{mode === "create" ? "Add Note" : "Edit Note"}</ModalTitle>
            <ModalDescription>
              {mode === "create"
                ? "Add a note to track details and communication."
                : "Update the note text, add or remove attachments."}
            </ModalDescription>
          </ModalHeader>

          <ModalBody className="space-y-4">
            <InlineTextarea
              id="noteText"
              label="Note"
              rows={5}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Enter your note here..."
              required
              disabled={busy}
              data-testid="input-note-text"
            />

              {/* Saved attachments (edit mode only) — images as thumbnail
                  grid, non-images as compact file chips. */}
              {mode === "edit" && existingAttachments.length > 0 && (() => {
                const savedImages = existingAttachments.filter((a) => isImageMime(a.mimeType));
                const savedFiles = existingAttachments.filter((a) => !isImageMime(a.mimeType));
                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs flex items-center gap-2">
                        Saved attachments
                        <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                          {existingAttachments.length}
                        </span>
                      </span>
                      {existingAttachments.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-helper text-muted-foreground hover:text-destructive"
                          onClick={() => setConfirmRemoveAll(true)}
                          disabled={busy}
                          data-testid="button-remove-all-attachments"
                        >
                          Remove all
                        </Button>
                      )}
                    </div>

                    {savedImages.length > 0 && (
                      <div className="grid gap-2 grid-cols-3 sm:grid-cols-4">
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
                      <div className="flex flex-col gap-1.5">
                        {savedFiles.map((a) => (
                          <div
                            key={a.id}
                            className="flex items-center gap-2 rounded border border-border/60 px-2 py-1.5 bg-muted/30"
                            data-testid={`existing-attachment-${a.id}`}
                          >
                            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs truncate">{a.originalName ?? "Attachment"}</p>
                              <span className="text-helper text-muted-foreground">{formatSize(a.size)}</span>
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

              {/* New attachments (staged, not yet uploaded). 2026-05-02
                  (PR 3C): always rendered — every entity type now has
                  a backend upload adapter. */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs flex items-center gap-2">
                  New attachments
                  {stagedFiles.length > 0 && (
                    <span className="inline-flex items-center rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                      {stagedFiles.length} staged
                    </span>
                  )}
                </span>
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
                  <span className="text-helper text-muted-foreground">
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
                  <div className="flex flex-col gap-1.5">
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
                          <span className="text-helper text-muted-foreground">{formatSize(sf.file.size)}</span>
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

            {busy && stagedFiles.length > 0 && (
              <div className="text-helper text-muted-foreground">
                Uploading {Math.min(uploadIndex + 1, stagedFiles.length)} of {stagedFiles.length}
                {" — "}
                {Math.round(progress * 100)}%
              </div>
            )}
          </ModalBody>

          <ModalFooter className="justify-between">
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
          </ModalFooter>
        </form>
      </ModalShell>

      <ConfirmModal
        open={confirmDeleteNote}
        onOpenChange={setConfirmDeleteNote}
        title="Delete this note?"
        description="The note and any attachments will be removed. This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        isPending={busy}
        onConfirm={handleDeleteNote}
        testIdPrefix="delete-note"
      />

      <ConfirmModal
        open={confirmRemoveAll}
        onOpenChange={setConfirmRemoveAll}
        title="Remove all saved attachments?"
        description="This detaches every saved attachment on this note. The note itself stays. This cannot be undone."
        confirmLabel="Remove all"
        variant="destructive"
        isPending={busy}
        onConfirm={() => {
          setConfirmRemoveAll(false);
          void detachAllExisting();
        }}
        testIdPrefix="remove-all-attachments"
      />
    </>
  );
}
