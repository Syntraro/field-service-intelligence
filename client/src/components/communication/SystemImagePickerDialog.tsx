/**
 * SystemImagePickerDialog (2026-04-14)
 *
 * Modal for selecting images already stored in the platform for the Send
 * Invoice flow. Replaces the local file-explorer upload. Data source is
 * `/api/invoices/:id/available-images`, which unions job-note image
 * attachments for the invoice's linked job + client-document image files
 * for the invoice's location. Image files only (mime `image/*`).
 *
 * Thumbnails resolve via the canonical `resolveFileAccessUrl` (the same
 * helper the attachment strip + saved-attachment thumbs use).
 */

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Check, FileText } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { resolveFileAccessUrl } from "@/hooks/useFileUpload";

interface AvailableImage {
  id: string;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  source: "job_note" | "client_document";
}

export interface PickedImage {
  fileId: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
}

interface SystemImagePickerDialogProps {
  invoiceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** fileIds already attached in the send modal — shown disabled. */
  alreadyAttachedFileIds: readonly string[];
  /** Max additional images the caller can accept. */
  maxSelect: number;
  onConfirm: (images: PickedImage[]) => void;
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ImageTile({
  image,
  disabled,
  selected,
  onToggle,
}: {
  image: AvailableImage;
  disabled: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    resolveFileAccessUrl(image.id)
      .then((u) => !cancelled && setUrl(u))
      .catch(() => !cancelled && setUrl(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [image.id]);

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`relative text-left border rounded-md overflow-hidden transition-shadow ${
        selected ? "ring-2 ring-primary" : "hover:ring-2 hover:ring-primary/30"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      data-testid={`system-image-${image.id}`}
    >
      <div className="aspect-square bg-muted/30 flex items-center justify-center">
        {loading ? (
          <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
        ) : url ? (
          <img src={url} alt={image.filename ?? ""} className="h-full w-full object-cover" />
        ) : (
          <FileText className="h-6 w-6 text-muted-foreground" />
        )}
      </div>
      {selected && (
        <div className="absolute top-1 right-1 h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
          <Check className="h-3 w-3" />
        </div>
      )}
      <div className="px-2 py-1.5">
        <p className="text-xs truncate">{image.filename ?? "image"}</p>
        <p className="text-helper text-muted-foreground">
          {image.source === "job_note" ? "Job note" : "Client document"} · {formatSize(image.sizeBytes)}
        </p>
      </div>
    </button>
  );
}

export function SystemImagePickerDialog({
  invoiceId,
  open,
  onOpenChange,
  alreadyAttachedFileIds,
  maxSelect,
  onConfirm,
}: SystemImagePickerDialogProps) {
  const [images, setImages] = useState<AvailableImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) {
      setPicked(new Set());
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiRequest<{ images: AvailableImage[] }>(
      `/api/invoices/${invoiceId}/available-images`,
    )
      .then((r) => !cancelled && setImages(r.images ?? []))
      .catch((e: any) => !cancelled && setError(e?.message ?? "Could not load images"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, invoiceId]);

  const alreadySet = useMemo(
    () => new Set(alreadyAttachedFileIds),
    [alreadyAttachedFileIds],
  );

  const togglePick = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= maxSelect) return prev;
        next.add(id);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    const selected = images
      .filter((i) => picked.has(i.id))
      .map<PickedImage>((i) => ({
        fileId: i.id,
        filename: i.filename ?? "image",
        sizeBytes: i.sizeBytes ?? 0,
        mimeType: i.mimeType ?? "image/*",
      }));
    onConfirm(selected);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-4 pb-3 border-b">
          <DialogTitle>Select images from this customer</DialogTitle>
          <DialogDescription>
            Images already stored for this job or customer. Pick up to {maxSelect}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="flex items-center gap-2 text-helper text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading images…
            </div>
          ) : error ? (
            <div className="text-xs text-destructive">{error}</div>
          ) : images.length === 0 ? (
            <div className="text-helper text-muted-foreground">
              No existing images found for this invoice's job or customer.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {images.map((img) => {
                const alreadyAttached = alreadySet.has(img.id);
                return (
                  <ImageTile
                    key={img.id}
                    image={img}
                    disabled={alreadyAttached}
                    selected={picked.has(img.id)}
                    onToggle={() => {
                      if (alreadyAttached) return;
                      togglePick(img.id);
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="px-5 py-3 border-t bg-background">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={picked.size === 0}
            data-testid="button-confirm-system-images"
          >
            Attach {picked.size > 0 ? `(${picked.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
