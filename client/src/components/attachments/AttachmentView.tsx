import { useEffect, useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { resolveFileAccessUrl } from "@/hooks/useFileUpload";

/**
 * Single-file display row with thumbnail/icon + filename + open/download
 * affordance. Handles both storage providers:
 *
 *   - r2:    resolves a short-lived signed URL via POST /api/files/:id/access-url
 *   - local: the same endpoint returns the legacy /api/files/:id path
 *
 * The component never knows which provider is in play — it just asks the
 * server for a URL right before it needs one. Signed URLs are cached in
 * memory for the lifetime of the component; we deliberately don't share a
 * global cache because the expiry would be hard to reason about.
 */

export interface AttachmentInfo {
  id: string;
  fileId: string;
  originalName: string | null;
  mimeType: string | null;
  size: number | null;
  storageProvider?: string | null;
  status?: string | null;
}

interface AttachmentViewProps {
  attachment: AttachmentInfo;
  /** Show the image inline when mimeType is an image. Defaults to true. */
  showThumbnail?: boolean;
  /** Called when user removes the attachment (optional). */
  onRemove?: () => void;
}

const isImageMime = (mime?: string | null): boolean => !!mime && mime.startsWith("image/");

export function AttachmentView({
  attachment,
  showThumbnail = true,
}: AttachmentViewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // Pre-resolve URLs for images so the thumbnail renders immediately.
    // PDFs and other types resolve lazily on click.
    if (!showThumbnail || !isImageMime(attachment.mimeType)) return;
    let cancelled = false;
    setLoadingUrl(true);
    resolveFileAccessUrl(attachment.fileId)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch((e) => {
        if (!cancelled) setErr(e?.message || "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoadingUrl(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.fileId, attachment.mimeType, showThumbnail]);

  const handleOpen = async () => {
    try {
      const resolved = url ?? (await resolveFileAccessUrl(attachment.fileId));
      window.open(resolved, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      setErr(e?.message || "Failed to open");
    }
  };

  const filename = attachment.originalName ?? "Attachment";

  return (
    <button
      type="button"
      onClick={handleOpen}
      className="flex w-full items-center gap-2 rounded border border-border/50 px-2 py-1 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
      data-testid={`attachment-${attachment.id}`}
    >
      {showThumbnail && isImageMime(attachment.mimeType) ? (
        loadingUrl ? (
          <Loader2 className="h-8 w-8 text-muted-foreground shrink-0 animate-spin" />
        ) : url ? (
          <img
            src={url}
            alt={filename}
            className="h-8 w-8 rounded object-cover shrink-0"
          />
        ) : (
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
        )
      ) : (
        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
      )}
      <span className="text-[11px] truncate flex-1">{filename}</span>
      <Download className="h-3 w-3 text-muted-foreground shrink-0" />
      {err && <span className="text-[11px] text-red-500">{err}</span>}
    </button>
  );
}
