/**
 * Compresses an image file before upload to reduce OCR timeout risk.
 * Max dimension: 1024px. WebP preferred (quality 0.85), JPEG fallback.
 * Uses createImageBitmap + OffscreenCanvas (Chrome/Firefox) with <canvas> fallback (Safari).
 * Returns the original file unchanged on any error.
 */
export async function compressImage(file: File): Promise<File> {
  const MAX_DIM = 1024;
  const QUALITY = 0.85;
  const preferWebP = typeof OffscreenCanvas !== "undefined";
  const outputType = preferWebP ? "image/webp" : "image/jpeg";
  const ext = preferWebP ? "webp" : "jpg";

  try {
    let blob: Blob;

    if (typeof createImageBitmap !== "undefined" && typeof OffscreenCanvas !== "undefined") {
      const bitmap = await createImageBitmap(file);
      const { width, height } = bitmap;
      const scale = Math.min(1, MAX_DIM / Math.max(width, height));
      const w = Math.round(width * scale);
      const h = Math.round(height * scale);

      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      blob = await canvas.convertToBlob({ type: outputType, quality: QUALITY });
    } else {
      // Safari fallback: HTMLCanvasElement
      const url = URL.createObjectURL(file);
      blob = await new Promise<Blob>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.round(img.naturalWidth * scale);
          const h = Math.round(img.naturalHeight * scale);
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) { reject(new Error("no 2d context")); return; }
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(
            (b) => b ? resolve(b) : reject(new Error("toBlob returned null")),
            "image/jpeg",
            QUALITY,
          );
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image load failed")); };
        img.src = url;
      });
    }

    const baseName = file.name.replace(/\.[^.]+$/, "");
    return new File([blob], `${baseName}.${ext}`, { type: outputType });
  } catch {
    return file;
  }
}
