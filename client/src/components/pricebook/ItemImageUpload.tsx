/**
 * ItemImageUpload — image manager for price book catalog items and
 * flat-rate service templates.
 *
 * Upload → server compresses (sharp) → R2 storage.
 * Supports: upload, replace, remove, fullscreen viewer.
 * Formats: jpg/jpeg/png/webp · max 5 MB raw.
 *
 * Exports:
 *   ItemImageUpload       — upload/replace/remove control for the detail rail
 *   PricebookThumb        — compact thumbnail for list/table rows (click-to-expand)
 *   PricebookImageViewer  — fullscreen portal overlay (used by both above)
 */

import { useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ImageIcon, Upload, X, Loader2, RefreshCw, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormSection } from "@/components/ui/form-field";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getCSRFToken, queryClient } from "@/lib/queryClient";

const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_RAW_BYTES = 5 * 1024 * 1024;

export type ImageEntityType = "item" | "service-template";

export interface ItemImageMeta {
  imageFileId?: string | null;
  imageStorageKey?: string | null;
  imageMimeType?: string | null;
  imageFileName?: string | null;
  imageAltText?: string | null;
  thumbnailStorageKey?: string | null;
}

interface ItemImageUploadProps {
  entityType: ImageEntityType;
  entityId: string;
  currentImage: ItemImageMeta;
  /** Called after a successful upload or removal with the updated entity. */
  onChanged: (updated: any) => void;
  /** Query keys to invalidate after any change. */
  invalidateKeys?: unknown[][];
}

interface ImageUrls {
  imageUrl: string | null;
  thumbnailUrl: string | null;
}

function useItemImageUrls(entityType: ImageEntityType, entityId: string, hasImage: boolean) {
  const path = entityType === "item"
    ? `/api/items/${entityId}/image-url`
    : `/api/service-templates/${entityId}/image-url`;

  return useQuery<ImageUrls>({
    queryKey: [path],
    queryFn: () => apiRequest<ImageUrls>(path),
    enabled: hasImage,
    staleTime: 8 * 60 * 1000,
    refetchIntervalInBackground: false,
  });
}

// ── Fullscreen image viewer ───────────────────────────────────────────────────

interface PricebookImageViewerProps {
  /** Full-size image URL to display. */
  imageUrl: string;
  /** Alt text for the image — propagated from entity's imageAltText or imageFileName. */
  altText?: string;
  /** Optional filename shown below image. */
  filename?: string | null;
  /** Called when user closes the viewer (Escape, backdrop click, close button). */
  onClose: () => void;
}

/**
 * Fullscreen portal overlay for viewing price book item images.
 *
 * - Renders into document.body via createPortal (above rail/workspace stacking).
 * - Locks body scroll while open; restores on unmount.
 * - Closes on Escape key, backdrop click, or close button.
 * - Focuses the close button on mount for keyboard accessibility.
 * - Caller is responsible for returning focus to the trigger element
 *   (pass a requestAnimationFrame callback to onClose).
 *
 * Performance: the imageUrl signed URL is already cached in TanStack Query
 * from the parent's useItemImageUrls hook — no extra network round-trip.
 * Browser fetches actual image bytes only when the <img> tag renders (on open).
 */
export function PricebookImageViewer({
  imageUrl,
  altText,
  filename,
  onClose,
}: PricebookImageViewerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Lock body scroll while the overlay is mounted.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Escape key closes the viewer.
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [onClose]);

  // Focus the close button immediately on mount so keyboard users can close.
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  const label = altText ? `Image: ${altText}` : "Image viewer";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90"
      data-testid="pricebook-image-viewer"
      onClick={onClose}
    >
      {/* Close button — top-right, always accessible */}
      <button
        ref={closeButtonRef}
        type="button"
        aria-label="Close image viewer"
        data-testid="pricebook-image-viewer-close"
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      >
        <X className="h-5 w-5" />
      </button>

      {/* Image container — stopPropagation prevents backdrop-click when clicking image */}
      <div
        className="flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={imageUrl}
          alt={altText ?? ""}
          className="max-h-[88vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
          data-testid="pricebook-image-viewer-img"
        />
        {filename && (
          <p className="mt-3 max-w-[80vw] truncate text-sm text-white/50">
            {filename}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Upload / replace / remove control (detail rail) ──────────────────────────

export function ItemImageUpload({
  entityType,
  entityId,
  currentImage,
  onChanged,
  invalidateKeys,
}: ItemImageUploadProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);

  const apiPath = entityType === "item"
    ? `/api/items/${entityId}/image`
    : `/api/service-templates/${entityId}/image`;

  const imageUrlQueryKey = entityType === "item"
    ? [`/api/items/${entityId}/image-url`]
    : [`/api/service-templates/${entityId}/image-url`];

  const hasImage = Boolean(currentImage.imageStorageKey);
  const { data: imageUrls } = useItemImageUrls(entityType, entityId, hasImage);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const token = await getCSRFToken();
      const form = new FormData();
      form.append("image", file);
      const res = await fetch(apiPath, {
        method: "POST",
        body: form,
        credentials: "include",
        headers: { "x-csrf-token": token },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Upload failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (updated) => {
      setLocalPreview(null);
      onChanged(updated);
      queryClient.invalidateQueries({ queryKey: imageUrlQueryKey });
      invalidateKeys?.forEach((k) => queryClient.invalidateQueries({ queryKey: k }));
      toast({ title: "Image saved." });
    },
    onError: (err: any) => {
      setLocalPreview(null);
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => apiRequest<any>(apiPath, { method: "DELETE" }),
    onSuccess: (updated) => {
      onChanged(updated);
      queryClient.invalidateQueries({ queryKey: imageUrlQueryKey });
      invalidateKeys?.forEach((k) => queryClient.invalidateQueries({ queryKey: k }));
      toast({ title: "Image removed." });
    },
    onError: () =>
      toast({ title: "Could not remove image.", variant: "destructive" }),
  });

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast({ title: "Unsupported format. Use JPG, PNG, or WebP.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_RAW_BYTES) {
      toast({ title: "Image exceeds 5 MB limit.", variant: "destructive" });
      return;
    }

    const preview = URL.createObjectURL(file);
    setLocalPreview(preview);
    uploadMutation.mutate(file);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const synth = {
      target: { files: e.dataTransfer.files, value: "" },
    } as unknown as React.ChangeEvent<HTMLInputElement>;
    handleFileSelected(synth);
  }

  const isMutating = uploadMutation.isPending || removeMutation.isPending;
  const displayUrl = localPreview ?? imageUrls?.imageUrl ?? null;

  // Full-size URL is available when not using a local preview (local preview is
  // a blob URL — viewer waits for the server-issued signed URL instead).
  const viewerImageUrl = imageUrls?.imageUrl ?? null;

  function handleExpandClose() {
    setViewerOpen(false);
    requestAnimationFrame(() => expandButtonRef.current?.focus());
  }

  return (
    <FormSection title="Item image" className="space-y-2">
      {hasImage || localPreview ? (
        <div className="space-y-2">
          {/*
           * Image container is a tap/click target for expand.
           * cursor-zoom-in signals the affordance on desktop.
           * The Maximize2 icon overlay provides a visible hint on all devices.
           * Disabled while mutating to prevent opening during upload.
           */}
          <button
            ref={expandButtonRef}
            type="button"
            aria-label="View full image"
            data-testid="pricebook-image-expand"
            disabled={isMutating || !viewerImageUrl}
            className="relative w-full rounded-md overflow-hidden border border-border/60 bg-muted/10 flex items-center justify-center min-h-[120px] cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
            onClick={() => setViewerOpen(true)}
          >
            {displayUrl ? (
              <img
                src={displayUrl}
                alt={currentImage.imageAltText ?? currentImage.imageFileName ?? "Item image"}
                className="max-h-48 max-w-full object-contain"
              />
            ) : (
              <ImageIcon className="h-8 w-8 text-muted-foreground/30" aria-hidden="true" />
            )}
            {isMutating && (
              <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {/* Expand affordance icon — pointer-events-none so the button gets the click */}
            {!isMutating && displayUrl && (
              <div
                className="absolute bottom-1.5 right-1.5 rounded bg-black/40 p-1 text-white/90 pointer-events-none"
                aria-hidden="true"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </div>
            )}
          </button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-helper flex-1"
              disabled={isMutating}
              onClick={() => fileInputRef.current?.click()}
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Replace
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-helper text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/50"
              disabled={isMutating}
              onClick={() => removeMutation.mutate()}
            >
              <X className="h-3 w-3 mr-1" />
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/60 bg-muted/10 px-4 py-5 cursor-pointer hover:bg-muted/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
          }}
          aria-label="Upload item image"
        >
          {isMutating ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <Upload className="h-5 w-5 text-muted-foreground/60" />
          )}
          <p className="text-helper text-muted-foreground">
            {isMutating ? "Uploading…" : "Upload image"}
          </p>
          <p className="text-helper text-muted-foreground/60">
            JPG, PNG, WebP · max 5 MB
          </p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        className="sr-only"
        onChange={handleFileSelected}
      />

      {viewerOpen && viewerImageUrl && (
        <PricebookImageViewer
          imageUrl={viewerImageUrl}
          altText={currentImage.imageAltText ?? currentImage.imageFileName ?? undefined}
          filename={currentImage.imageFileName}
          onClose={handleExpandClose}
        />
      )}
    </FormSection>
  );
}

// ── Compact thumbnail for list/table rows (click-to-expand) ──────────────────

interface PricebookThumbProps {
  entityType: ImageEntityType;
  entityId: string;
  thumbnailStorageKey?: string | null;
  className?: string;
}

export function PricebookThumb({ entityType, entityId, thumbnailStorageKey, className }: PricebookThumbProps) {
  const { data } = useItemImageUrls(entityType, entityId, Boolean(thumbnailStorageKey));
  const [viewerOpen, setViewerOpen] = useState(false);
  const thumbButtonRef = useRef<HTMLButtonElement>(null);

  if (!thumbnailStorageKey) {
    return (
      <div className={`flex items-center justify-center rounded bg-muted/30 ${className ?? "h-8 w-8"}`}>
        <ImageIcon className="h-3.5 w-3.5 text-muted-foreground/30" aria-hidden />
      </div>
    );
  }

  if (!data?.thumbnailUrl) {
    return <div className={`rounded bg-muted/40 animate-pulse ${className ?? "h-8 w-8"}`} />;
  }

  function handleThumbClose() {
    setViewerOpen(false);
    requestAnimationFrame(() => thumbButtonRef.current?.focus());
  }

  return (
    <>
      <button
        ref={thumbButtonRef}
        type="button"
        aria-label="View item image"
        data-testid={`pricebook-thumb-${entityId}`}
        className={`rounded overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${className ?? "h-8 w-8"}`}
        onClick={() => setViewerOpen(true)}
      >
        <img
          src={data.thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-contain"
        />
      </button>

      {/* Full-size URL is already in cache from useItemImageUrls — no extra fetch.
          Browser loads actual image bytes only when this img tag mounts (on open). */}
      {viewerOpen && data.imageUrl && (
        <PricebookImageViewer
          imageUrl={data.imageUrl}
          onClose={handleThumbClose}
        />
      )}
    </>
  );
}
