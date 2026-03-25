import { useState, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Paperclip, X, FileText, Image as ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useActivityStore } from "@/lib/activityStore";

/** Staged file ready for upload */
interface StagedFile {
  file: File;
  previewUrl?: string;
}

interface AddJobNoteDialogProps {
  jobId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ACCEPTED_TYPES = "image/png,image/jpeg,image/gif,image/webp,application/pdf";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export function AddJobNoteDialog({
  jobId,
  open,
  onOpenChange,
}: AddJobNoteDialogProps) {
  const { toast } = useToast();
  const { logActivity } = useActivityStore();
  const [noteText, setNoteText] = useState("");
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setNoteText("");
      setStagedFiles([]);
      setUploading(false);
    }
  }, [open]);

  // Cleanup preview URLs on unmount or file removal
  useEffect(() => {
    return () => {
      stagedFiles.forEach((sf) => {
        if (sf.previewUrl) URL.revokeObjectURL(sf.previewUrl);
      });
    };
  }, [stagedFiles]);

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const valid: StagedFile[] = [];
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        toast({ title: "File too large", description: `${file.name} exceeds 10 MB.`, variant: "destructive" });
        continue;
      }
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      valid.push({ file, previewUrl });
    }
    setStagedFiles((prev) => [...prev, ...valid].slice(0, 10));
    // Reset input so re-selecting same file works
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (idx: number) => {
    setStagedFiles((prev) => {
      const removed = prev[idx];
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  };

  /** Upload staged files via POST /api/uploads, return fileIds */
  const uploadFiles = async (): Promise<string[]> => {
    if (stagedFiles.length === 0) return [];
    const formData = new FormData();
    stagedFiles.forEach((sf) => formData.append("files", sf.file));

    const res = await fetch("/api/uploads", {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    if (!res.ok) throw new Error("File upload failed");
    const results: Array<{ fileId: string }> = await res.json();
    return results.map((r) => r.fileId);
  };

  const createMutation = useMutation({
    mutationFn: async (data: { noteText: string; attachmentFileIds: string[] }) => {
      return await apiRequest(`/api/jobs/${jobId}/notes`, {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "notes"] });
      logActivity({
        type: "created",
        entityType: "job",
        entityId: jobId,
        label: "Added Note",
        meta: noteText.slice(0, 60) || undefined,
      });
      toast({ title: "Note Added", description: "The note has been added to the job." });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add note.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedNote = noteText.trim();
    if (!trimmedNote) {
      toast({ title: "Error", description: "Note text cannot be empty.", variant: "destructive" });
      return;
    }

    try {
      setUploading(true);
      const attachmentFileIds = await uploadFiles();
      createMutation.mutate({ noteText: trimmedNote, attachmentFileIds });
    } catch (err: any) {
      toast({ title: "Upload Error", description: err.message || "File upload failed.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const isSubmitting = uploading || createMutation.isPending;

  /** Format file size for display */
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-add-note">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Note</DialogTitle>
            <DialogDescription>
              Add a note to track job details and communication.
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
                data-testid="input-note-text"
                className="resize-none"
              />
            </div>

            {/* Attachment section */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs gap-1.5"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSubmitting}
                  data-testid="button-attach-file"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  Attach Files
                </Button>
                <span className="text-[11px] text-muted-foreground">Images & PDFs, max 10 MB each</span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES}
                multiple
                className="hidden"
                onChange={handleFilePick}
              />

              {/* Staged file previews */}
              {stagedFiles.length > 0 && (
                <div className="space-y-1.5">
                  {stagedFiles.map((sf, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 rounded border border-border/60 px-2 py-1.5 bg-muted/30"
                      data-testid={`staged-file-${idx}`}
                    >
                      {sf.previewUrl ? (
                        <img src={sf.previewUrl} alt="" className="h-8 w-8 rounded object-cover shrink-0" />
                      ) : (
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs truncate">{sf.file.name}</p>
                        <p className="text-[10px] text-muted-foreground">{formatSize(sf.file.size)}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0"
                        onClick={() => removeFile(idx)}
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
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-note"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !noteText.trim()}
              data-testid="button-save-note"
            >
              {isSubmitting && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Add Note
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
