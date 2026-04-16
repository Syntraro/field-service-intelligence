import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Loader2, X } from "lucide-react";
import { resolveFileAccessUrl } from "@/hooks/useFileUpload";
import type { AttachmentInfo } from "./AttachmentView";

/**
 * NoteAttachmentStrip — compact Jobber-style attachment row for a single note.
 *
 *   - Images render as small uniform thumbnails (fixed 56px square, object-cover).
 *   - Max 4 image thumbnails inline; remainder collapsed into a +N overflow chip.
 *   - Clicking any thumbnail (or the overflow chip) opens a lightbox that
 *     browses every image attachment on the note.
 *   - PDFs / non-image files render as compact chips (icon + truncated name);
 *     clicking opens the file in a new tab via the existing signed-URL flow.
 *
 * One canonical renderer shared across office + tech-app note surfaces.
 */

interface NoteAttachmentStripProps {
  attachments: AttachmentInfo[];
}

const THUMB_VISIBLE = 4;

const isImageMime = (mime?: string | null): boolean => !!mime && mime.startsWith("image/");

function ImageThumb({
  attachment,
  onOpen,
  overlayCount,
}: {
  attachment: AttachmentInfo;
  onOpen: () => void;
  overlayCount?: number;
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

  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-border/60 bg-muted/30 hover:ring-2 hover:ring-primary/40 transition-shadow"
      data-testid={`note-thumb-${attachment.id}`}
      aria-label={attachment.originalName ?? "Image attachment"}
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
      {overlayCount !== undefined && overlayCount > 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-white text-sm font-semibold">
          +{overlayCount}
        </div>
      )}
    </button>
  );
}

function FileChip({ attachment }: { attachment: AttachmentInfo }) {
  const [err, setErr] = useState<string | null>(null);

  const handleOpen = async () => {
    try {
      const resolved = await resolveFileAccessUrl(attachment.fileId);
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
      className="flex h-8 max-w-[200px] items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 hover:bg-muted/50 transition-colors"
      data-testid={`note-chip-${attachment.id}`}
      title={filename}
    >
      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-xs truncate">{filename}</span>
      {err && <span className="text-xs text-red-500 shrink-0">!</span>}
    </button>
  );
}

function Lightbox({
  images,
  startIndex,
  onClose,
}: {
  images: AttachmentInfo[];
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const current = images[index];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setUrl(null);
    resolveFileAccessUrl(current.fileId)
      .then((u) => !cancelled && setUrl(u))
      .catch(() => !cancelled && setUrl(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [current.fileId]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + images.length) % images.length);
      else if (e.key === "ArrowRight") setIndex((i) => (i + 1) % images.length);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [images.length, onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85"
      onClick={onClose}
      data-testid="note-lightbox"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute top-4 right-4 text-white/80 hover:text-white"
        aria-label="Close"
      >
        <X className="h-6 w-6" />
      </button>
      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIndex((i) => (i - 1 + images.length) % images.length);
            }}
            className="absolute left-4 text-white/80 hover:text-white"
            aria-label="Previous"
          >
            <ChevronLeft className="h-8 w-8" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIndex((i) => (i + 1) % images.length);
            }}
            className="absolute right-4 text-white/80 hover:text-white"
            aria-label="Next"
          >
            <ChevronRight className="h-8 w-8" />
          </button>
        </>
      )}
      <div
        className="flex max-h-[90vh] max-w-[90vw] flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <Loader2 className="h-8 w-8 text-white/70 animate-spin" />
        ) : url ? (
          <img
            src={url}
            alt={current.originalName ?? "attachment"}
            className="max-h-[85vh] max-w-[90vw] rounded-md object-contain"
          />
        ) : (
          <span className="text-white/70 text-sm">Failed to load image</span>
        )}
        <div className="text-xs text-white/70">
          {index + 1} / {images.length}
          {current.originalName ? ` — ${current.originalName}` : ""}
        </div>
      </div>
    </div>
  );
}

export function NoteAttachmentStrip({ attachments }: NoteAttachmentStripProps) {
  const { images, files } = useMemo(() => {
    const imgs: AttachmentInfo[] = [];
    const fls: AttachmentInfo[] = [];
    for (const a of attachments) {
      if (isImageMime(a.mimeType)) imgs.push(a);
      else fls.push(a);
    }
    return { images: imgs, files: fls };
  }, [attachments]);

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (images.length === 0 && files.length === 0) return null;

  const visibleImages = images.slice(0, THUMB_VISIBLE);
  const overflow = images.length - visibleImages.length;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="note-attachment-strip">
      {visibleImages.map((att, i) => {
        const isLastVisible = i === visibleImages.length - 1;
        const showOverlay = isLastVisible && overflow > 0;
        return (
          <ImageThumb
            key={att.id}
            attachment={att}
            overlayCount={showOverlay ? overflow : undefined}
            onOpen={() => setLightboxIndex(i)}
          />
        );
      })}
      {files.map((att) => (
        <FileChip key={att.id} attachment={att} />
      ))}
      {lightboxIndex !== null && images.length > 0 && (
        <Lightbox
          images={images}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}
