/**
 * Pricebook image optimization pipeline.
 *
 * Processes raw uploads server-side before permanent storage:
 *   - Validates mime type and raw size at entry.
 *   - Normalizes EXIF orientation via rotate() before any resize (iPhone/Android fix).
 *   - Resizes to max 1600 px on the longest side (no upscaling).
 *   - Compresses to WebP at quality 80 (~150–450 KB typical output).
 *   - Generates a 160×160 contain-fit WebP thumbnail for list/table views.
 *     Tall/narrow equipment (furnaces, parts) is letterboxed on THUMB_BACKGROUND
 *     rather than cropped.
 *
 * Originals are NEVER stored permanently — only the optimized versions reach R2.
 */

import sharp from "sharp";
import { createError } from "../middleware/errorHandler";

export const PRICEBOOK_IMAGE_MAX_RAW_BYTES = 5 * 1024 * 1024; // 5 MB
export const PRICEBOOK_IMAGE_MAX_DIMENSION = 1600;
export const PRICEBOOK_THUMB_SIZE = 160;
const WEBP_QUALITY = 80;

// Neutral letterbox background for thumbnails — Tailwind slate-50 (#F9FAFB).
// Matches bg-muted/10 used in the upload drop zone.
export const THUMB_BACKGROUND = { r: 249, g: 250, b: 251, alpha: 1 } as const;

const ALLOWED_INPUT_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export interface ProcessedImage {
  optimizedBuffer: Buffer;
  thumbnailBuffer: Buffer;
  mimeType: "image/webp";
  width: number;
  height: number;
  optimizedBytes: number;
  thumbnailBytes: number;
}

export function validatePricebookImageMime(mimeType: string): void {
  if (!ALLOWED_INPUT_MIMES.has(mimeType.toLowerCase())) {
    throw createError(
      400,
      `Unsupported image type "${mimeType}". Accepted: jpg, jpeg, png, webp.`,
    );
  }
}

export function validatePricebookImageSize(sizeBytes: number): void {
  if (sizeBytes > PRICEBOOK_IMAGE_MAX_RAW_BYTES) {
    throw createError(
      413,
      `Image too large (${(sizeBytes / 1024 / 1024).toFixed(1)} MB). Maximum is 5 MB.`,
    );
  }
}

export async function processItemImage(
  rawBuffer: Buffer,
  mimeType: string,
): Promise<ProcessedImage> {
  validatePricebookImageMime(mimeType);

  const [optimizedBuffer, thumbnailBuffer] = await Promise.all([
    sharp(rawBuffer)
      .rotate()  // apply EXIF orientation and strip the tag — must precede resize
      .resize(PRICEBOOK_IMAGE_MAX_DIMENSION, PRICEBOOK_IMAGE_MAX_DIMENSION, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer(),
    sharp(rawBuffer)
      .rotate()  // apply EXIF orientation before thumbnail crop
      .resize(PRICEBOOK_THUMB_SIZE, PRICEBOOK_THUMB_SIZE, {
        fit: "contain",
        background: THUMB_BACKGROUND,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer(),
  ]);

  const meta = await sharp(optimizedBuffer).metadata();

  return {
    optimizedBuffer,
    thumbnailBuffer,
    mimeType: "image/webp",
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    optimizedBytes: optimizedBuffer.byteLength,
    thumbnailBytes: thumbnailBuffer.byteLength,
  };
}
