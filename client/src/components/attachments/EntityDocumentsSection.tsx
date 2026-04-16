import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Paperclip, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AttachmentView } from "./AttachmentView";
import {
  SUPPORTED_MIME_TYPES,
  useFileUpload,
  validateFileClientSide,
} from "@/hooks/useFileUpload";

/**
 * Reusable entity-level document section (not note-attached).
 *
 * Phase 2 (2026-04-12): one component, many entities. Client documents
 * use it today; contract and technician documents will use the same
 * component when their UI surfaces land — only the `entityType` and
 * `listUrl` change.
 */

export type DocumentEntityType = "client_document" | "contract_document" | "technician_document";

interface FileDTO {
  id: string;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  status: string;
  storageProvider: string;
  createdAt: string;
}

interface Props {
  /** Adapter-keyed entity type the upload pipeline uses. */
  entityType: DocumentEntityType;
  /** The target entity's id (clientId / contractId / technicianId). */
  entityId: string;
  /** Server list endpoint (e.g. `/api/clients/:id/files`). */
  listUrl: string;
  /** Optional section title. */
  title?: string;
}

export function EntityDocumentsSection({ entityType, entityId, listUrl, title = "Documents" }: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<File[]>([]);
  const { upload, progress, isUploading } = useFileUpload();

  const qk = [listUrl];
  const { data: files = [], isLoading } = useQuery<FileDTO[]>({
    queryKey: qk,
    queryFn: () => apiRequest<FileDTO[]>(listUrl),
    enabled: Boolean(entityId),
  });

  const deleteMutation = useMutation({
    mutationFn: async (fileId: string) =>
      apiRequest(`/api/files/${fileId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk });
      toast({ title: "Document removed" });
    },
    onError: () =>
      toast({ title: "Error", description: "Failed to remove document.", variant: "destructive" }),
  });

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    const valid: File[] = [];
    for (const f of picked) {
      const err = validateFileClientSide(f);
      if (err) {
        toast({ title: "File rejected", description: err, variant: "destructive" });
        continue;
      }
      valid.push(f);
    }
    setStaged((prev) => [...prev, ...valid]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleUploadAll = async () => {
    for (const file of staged) {
      try {
        await upload(file, { entityType: entityType as any, entityId });
      } catch (e: any) {
        toast({
          title: "Upload failed",
          description: e?.message || "File failed to upload.",
          variant: "destructive",
        });
      }
    }
    setStaged([]);
    queryClient.invalidateQueries({ queryKey: qk });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[#0f172a]">{title}</span>
        <Button
          variant="outline"
          size="sm"
          className="text-xs gap-1.5"
          onClick={() => fileRef.current?.click()}
          disabled={isUploading}
        >
          <Paperclip className="h-3.5 w-3.5" />
          Attach
        </Button>
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        accept={SUPPORTED_MIME_TYPES.join(",")}
        className="hidden"
        onChange={handlePick}
      />

      {staged.length > 0 && (
        <div className="rounded border border-dashed border-slate-300 p-2 space-y-1">
          {staged.map((f, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1 bg-slate-50"
            >
              <span className="text-xs truncate flex-1">{f.name}</span>
              <button
                type="button"
                onClick={() => setStaged((prev) => prev.filter((_, idx) => idx !== i))}
                className="text-slate-500 hover:text-slate-700"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
          <Button size="sm" className="w-full" onClick={handleUploadAll} disabled={isUploading}>
            {isUploading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                Uploading {Math.round(progress * 100)}%
              </>
            ) : (
              <>Upload {staged.length} file{staged.length === 1 ? "" : "s"}</>
            )}
          </Button>
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : files.length === 0 ? (
        <p className="text-xs text-muted-foreground">No documents yet</p>
      ) : (
        <div className="space-y-1">
          {files.map((f) => (
            <div key={f.id} className="group flex items-center gap-2">
              <div className="flex-1">
                <AttachmentView
                  attachment={{
                    id: f.id,
                    fileId: f.id,
                    originalName: f.filename,
                    mimeType: f.mimeType,
                    size: f.sizeBytes,
                    storageProvider: f.storageProvider,
                    status: f.status,
                  }}
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => deleteMutation.mutate(f.id)}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
