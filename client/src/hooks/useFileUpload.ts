import { useCallback, useState } from "react";
import { apiRequest } from "@/lib/queryClient";

/**
 * Canonical file upload hook — implements the 3-step R2 lifecycle.
 *
 *   1. POST /api/files/upload-request  → { fileId, uploadUrl, requiredHeaders }
 *   2. PUT  uploadUrl with the raw file body (direct to R2)
 *   3. POST /api/files/:fileId/finalize
 *
 * The server is the only party that knows which storage provider is in
 * play — this hook speaks the shared API and never imports the SDK.
 *
 * Designed so later entity types (client_note, contract, invoice, quote)
 * can reuse the same hook without change: only the `entityType` +
 * `entityId` vary.
 */

export type SupportedMimeType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "application/pdf";

export const SUPPORTED_MIME_TYPES: SupportedMimeType[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

export const FILE_SIZE_LIMITS: Record<SupportedMimeType, number> = {
  "image/jpeg": 10 * 1024 * 1024,
  "image/png": 10 * 1024 * 1024,
  "image/webp": 10 * 1024 * 1024,
  "application/pdf": 20 * 1024 * 1024,
};

export type FileEntityType =
  | "job_note"
  | "client_note"
  | "client_document"
  | "contract_document"
  | "technician_document";

export interface UploadTarget {
  entityType: FileEntityType;
  entityId: string;
}

export interface UploadedFile {
  id: string;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  status: string;
  storageProvider: string;
  createdAt: string;
}

interface UploadRequestResponse {
  fileId: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  objectKey: string;
  expiresInSeconds: number;
}

export function isSupportedMime(mime: string): mime is SupportedMimeType {
  return (SUPPORTED_MIME_TYPES as string[]).includes(mime);
}

export function validateFileClientSide(file: File): string | null {
  if (!isSupportedMime(file.type)) {
    return `Unsupported file type: ${file.type || "unknown"}`;
  }
  const limit = FILE_SIZE_LIMITS[file.type];
  if (file.size > limit) {
    const limitMb = Math.round(limit / (1024 * 1024));
    return `${file.name} exceeds the ${limitMb} MB limit for ${file.type}.`;
  }
  return null;
}

export interface UseFileUploadResult {
  /** Upload a single file end-to-end and return the finalized DTO. */
  upload: (file: File, target: UploadTarget) => Promise<UploadedFile>;
  /** Progress 0..1 for the most recent active upload. Resets between uploads. */
  progress: number;
  isUploading: boolean;
  error: string | null;
}

export function useFileUpload(): UseFileUploadResult {
  const [progress, setProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File, target: UploadTarget): Promise<UploadedFile> => {
      const validationError = validateFileClientSide(file);
      if (validationError) {
        setError(validationError);
        throw new Error(validationError);
      }
      setError(null);
      setProgress(0);
      setIsUploading(true);

      try {
        // Step 1 — request upload URL
        const requestRes = await apiRequest<UploadRequestResponse>(
          "/api/files/upload-request",
          {
            method: "POST",
            body: JSON.stringify({
              entityType: target.entityType,
              entityId: target.entityId,
              filename: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
            }),
          },
        );

        // Step 2 — PUT direct to R2 with progress via XHR
        await putWithProgress(
          requestRes.uploadUrl,
          file,
          requestRes.requiredHeaders,
          (pct) => setProgress(pct),
        );

        // Step 3 — finalize
        const dto = await apiRequest<UploadedFile>(
          `/api/files/${requestRes.fileId}/finalize`,
          {
            method: "POST",
            body: JSON.stringify({
              entityType: target.entityType,
              entityId: target.entityId,
            }),
          },
        );

        setProgress(1);
        return dto;
      } catch (err: any) {
        const message = err?.message || "Upload failed";
        setError(message);
        throw err;
      } finally {
        setIsUploading(false);
      }
    },
    [],
  );

  return { upload, progress, isUploading, error };
}

function putWithProgress(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v);
    }
    xhr.upload.addEventListener("progress", (evt) => {
      if (evt.lengthComputable) {
        onProgress(evt.loaded / evt.total);
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));
    xhr.send(file);
  });
}

/**
 * Resolve a short-lived read URL for a file id. For R2 rows this returns
 * a signed GET URL; for legacy local rows it returns the in-process
 * `/api/files/:fileId` path. Callers treat both the same way.
 */
export async function resolveFileAccessUrl(fileId: string): Promise<string> {
  const res = await apiRequest<{ url: string }>(`/api/files/${fileId}/access-url`, {
    method: "POST",
  });
  return res.url;
}
