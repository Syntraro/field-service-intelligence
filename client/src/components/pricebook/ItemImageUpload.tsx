/**
 * ItemImageUpload — image manager for price book catalog items and
 * flat-rate service templates.
 *
 * Upload → server compresses (sharp) → R2 storage.
 * Supports: upload, replace, remove.
 * Formats: jpg/jpeg/png/webp · max 5 MB raw.
 */

import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ImageIcon, Upload, X, Loader2, RefreshCw } from "lucide-react";
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

export function ItemImageUpload({
  entityType,
  entityId,
  currentImage,
  onChanged,
  invalidateKeys,
}: ItemImageUploadProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);

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

  return (
    <FormSection title="Item image" className="space-y-2">
      {hasImage || localPreview ? (
        <div className="space-y-2">
          <div className="relative rounded-md overflow-hidden border border-border/60 bg-muted/10 flex items-center justify-center min-h-[120px]">
            {displayUrl ? (
              <img
                src={displayUrl}
                alt={currentImage.imageAltText ?? currentImage.imageFileName ?? "Item image"}
                className="max-h-48 max-w-full object-contain"
              />
            ) : (
              <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
            )}
            {isMutating && (
              <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
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
    </FormSection>
  );
}

// ── Compact thumbnail for list/table rows ────────────────────────────────────

interface PricebookThumbProps {
  entityType: ImageEntityType;
  entityId: string;
  thumbnailStorageKey?: string | null;
  className?: string;
}

export function PricebookThumb({ entityType, entityId, thumbnailStorageKey, className }: PricebookThumbProps) {
  const { data } = useItemImageUrls(entityType, entityId, Boolean(thumbnailStorageKey));

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

  return (
    <img
      src={data.thumbnailUrl}
      alt=""
      className={`rounded object-cover ${className ?? "h-8 w-8"}`}
    />
  );
}
