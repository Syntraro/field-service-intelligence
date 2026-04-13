/**
 * Canonical storage provider interface.
 *
 * Every provider (Cloudflare R2, AWS S3, GCS, local disk shim) implements
 * the same surface. No other layer in the app may speak directly to a
 * vendor SDK — all blob I/O flows through this interface.
 *
 * Phase 1 (2026-04-12): only R2 is implemented. Legacy local-disk rows are
 * read by the file service directly from the old path; the local provider
 * is intentionally NOT registered here because new uploads should never
 * target the disk.
 */

export interface PresignedUpload {
  /** URL the client PUTs the file body to. */
  url: string;
  /** Headers that MUST be sent with the PUT (e.g. Content-Type). */
  requiredHeaders: Record<string, string>;
  /** TTL in seconds after which the URL stops working. */
  expiresInSeconds: number;
}

export interface PresignedDownload {
  url: string;
  expiresInSeconds: number;
}

export interface HeadObjectResult {
  exists: boolean;
  sizeBytes?: number;
  contentType?: string;
  etag?: string;
}

export interface CreatePresignedUploadInput {
  bucket: string;
  objectKey: string;
  mimeType: string;
  /** Max allowed size in bytes. The signed URL is constrained to this limit. */
  maxSizeBytes: number;
  expiresInSeconds?: number;
}

export interface CreatePresignedDownloadInput {
  bucket: string;
  objectKey: string;
  /** Optional filename hint for Content-Disposition. */
  filename?: string;
  expiresInSeconds?: number;
}

export interface StorageProvider {
  readonly providerId: "r2";
  createPresignedUpload(input: CreatePresignedUploadInput): Promise<PresignedUpload>;
  createPresignedDownload(input: CreatePresignedDownloadInput): Promise<PresignedDownload>;
  headObject(bucket: string, objectKey: string): Promise<HeadObjectResult>;
  deleteObject(bucket: string, objectKey: string): Promise<void>;
}
