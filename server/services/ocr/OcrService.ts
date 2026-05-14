/**
 * OcrService — orchestrates nameplate extraction for equipment photos.
 *
 * Responsibilities:
 *   1. Validate the file record (tenant-scoped, status=uploaded, image mime,
 *      size ≤ 10 MB, R2-backed).
 *   2. Fetch the image buffer from R2 server-side — the signed URL is never
 *      exposed to the client or to external services via a URL parameter.
 *   3. Select the active provider via OCR_PROVIDER env var (default: tesseract).
 *   4. Delegate to the provider's extractNameplate().
 *   5. Return the normalized OcrNameplateResult.
 *
 * This service NEVER writes to location_equipment. Scan persistence is the
 * caller's responsibility (see server/storage/equipmentOcrScans.ts).
 *
 * Supported OCR_PROVIDER values: tesseract | google_vision | azure_cv
 */

import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { files } from "@shared/schema";
import { createError } from "../../middleware/errorHandler";
import { getR2Provider, isR2Configured } from "../storage/R2StorageProvider";
import type { OcrProvider, OcrNameplateResult } from "./OcrProvider";
import { TesseractProvider } from "./providers/TesseractProvider";
import { GoogleVisionProvider } from "./providers/GoogleVisionProvider";

// ── File validation constants ────────────────────────────────────────────────

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

// ── Provider selection ───────────────────────────────────────────────────────

function buildProvider(): OcrProvider {
  const name = (process.env.OCR_PROVIDER ?? "tesseract").toLowerCase();
  switch (name) {
    case "tesseract":
      return new TesseractProvider();
    case "google_vision":
      return new GoogleVisionProvider();
    case "azure_cv":
      throw new Error(
        "AzureCvProvider is not yet implemented. " +
        "Set OCR_PROVIDER=tesseract for local development.",
      );
    default:
      throw new Error(
        `Unknown OCR_PROVIDER="${name}". ` +
        "Valid values: tesseract, google_vision, azure_cv",
      );
  }
}

let _cachedProvider: OcrProvider | null = null;

function getProvider(): OcrProvider {
  if (!_cachedProvider) {
    _cachedProvider = buildProvider();
  }
  return _cachedProvider;
}

/**
 * Reset the cached provider singleton.
 * Exported for tests only — allows swapping the provider between test cases
 * by manipulating process.env.OCR_PROVIDER + calling this.
 */
export function _resetProviderCache(): void {
  _cachedProvider = null;
}

/**
 * Inject a provider directly — for unit tests that don't want to touch
 * environment variables.
 */
export function _injectProvider(provider: OcrProvider): void {
  _cachedProvider = provider;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract nameplate fields from an already-uploaded image file.
 *
 * @param companyId  Tenant context — enforces ownership of the file.
 * @param fileId     ID of an uploaded image file in the files table.
 * @returns Normalized OCR result with field suggestions and confidence scores.
 * @throws 404 if file not found for tenant
 * @throws 409 if file status is not "uploaded"
 * @throws 400 if file is not an image, or is a PDF, or is local-storage-backed
 * @throws 413 if image exceeds 10 MB
 * @throws 503 if R2 is not configured
 */
export async function extractNameplateFromFile(
  companyId: string,
  fileId: string,
): Promise<OcrNameplateResult> {
  // 1. Load file record — tenant-scoped.
  const [fileRow] = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.companyId, companyId)))
    .limit(1);

  if (!fileRow) {
    throw createError(404, "File not found");
  }
  if (fileRow.status !== "uploaded") {
    throw createError(409, `File is not ready for OCR (status=${fileRow.status})`);
  }
  if (!IMAGE_MIME_TYPES.has(fileRow.mimeType ?? "")) {
    throw createError(
      400,
      `OCR requires a jpeg, png, or webp image. Got: ${fileRow.mimeType ?? "unknown"}`,
    );
  }
  if (fileRow.size !== null && fileRow.size > MAX_IMAGE_BYTES) {
    throw createError(413, "Image exceeds the 10 MB limit for OCR processing");
  }
  if (fileRow.storageProvider !== "r2" || !fileRow.bucket) {
    throw createError(400, "Only R2-backed files can be processed by OCR");
  }

  // 2. Fetch image buffer server-side — never expose a signed URL to external services.
  if (!isR2Configured()) {
    throw createError(503, "File storage is not configured");
  }
  const buffer = await getR2Provider().getObjectBuffer(fileRow.bucket, fileRow.storageKey);

  // 3. Delegate to provider.
  const provider = getProvider();
  return provider.extractNameplate(buffer, fileRow.mimeType ?? "image/jpeg");
}
