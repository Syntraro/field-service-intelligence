/**
 * Cloudflare R2 storage provider.
 *
 * R2 exposes an S3-compatible API, so the official @aws-sdk/client-s3
 * package works as-is. The only deviations from vanilla S3 are the
 * endpoint URL, the required "auto" region, and the absence of true
 * server-side ACLs (we rely on the bucket being private + signed URLs).
 *
 * This module is the ONLY place in the server that may import the AWS SDK.
 */

import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  CreatePresignedDownloadInput,
  CreatePresignedUploadInput,
  HeadObjectResult,
  PresignedDownload,
  PresignedUpload,
  StorageProvider,
} from "./StorageProvider";

// Signed-URL TTL policy is centralized here so every caller gets the same
// bounds. Callers MAY request a shorter expiry; they cannot exceed the cap.
export const MAX_UPLOAD_EXPIRY_SECONDS = 60 * 5; // 5 minutes
export const MAX_DOWNLOAD_EXPIRY_SECONDS = 60 * 15; // 15 minutes
const DEFAULT_UPLOAD_EXPIRY_SECONDS = MAX_UPLOAD_EXPIRY_SECONDS;
const DEFAULT_DOWNLOAD_EXPIRY_SECONDS = 60 * 10; // 10 minutes (within cap)

function clamp(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return max;
  return Math.min(value, max);
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  defaultBucket: string;
}

export class R2StorageProvider implements StorageProvider {
  readonly providerId = "r2" as const;
  private readonly client: S3Client;

  constructor(private readonly config: R2Config) {
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // R2 compatibility: @aws-sdk/client-s3 >= 3.729 defaults
      // `requestChecksumCalculation` to `"WHEN_SUPPORTED"`, which injects
      // `x-amz-sdk-checksum-algorithm` + `x-amz-checksum-crc32` as SIGNED
      // headers on presigned PUTs. Browsers can't compute those on a raw
      // PUT, so the signature check fails with 403. We only need checksums
      // when explicitly required, so opt back to "WHEN_REQUIRED".
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  async createPresignedUpload(input: CreatePresignedUploadInput): Promise<PresignedUpload> {
    const expiresInSeconds = clamp(
      input.expiresInSeconds ?? DEFAULT_UPLOAD_EXPIRY_SECONDS,
      MAX_UPLOAD_EXPIRY_SECONDS,
    );
    const cmd = new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.objectKey,
      ContentType: input.mimeType,
      ContentLength: input.maxSizeBytes,
    });
    const url = await getSignedUrl(this.client, cmd, { expiresIn: expiresInSeconds });
    return {
      url,
      requiredHeaders: {
        "Content-Type": input.mimeType,
      },
      expiresInSeconds,
    };
  }

  async createPresignedDownload(input: CreatePresignedDownloadInput): Promise<PresignedDownload> {
    const expiresInSeconds = clamp(
      input.expiresInSeconds ?? DEFAULT_DOWNLOAD_EXPIRY_SECONDS,
      MAX_DOWNLOAD_EXPIRY_SECONDS,
    );
    const cmd = new GetObjectCommand({
      Bucket: input.bucket,
      Key: input.objectKey,
      ResponseContentDisposition: input.filename
        ? `inline; filename="${sanitizeContentDispositionFilename(input.filename)}"`
        : undefined,
    });
    const url = await getSignedUrl(this.client, cmd, { expiresIn: expiresInSeconds });
    return { url, expiresInSeconds };
  }

  async headObject(bucket: string, objectKey: string): Promise<HeadObjectResult> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: objectKey }),
      );
      return {
        exists: true,
        sizeBytes: typeof res.ContentLength === "number" ? res.ContentLength : undefined,
        contentType: res.ContentType,
        etag: res.ETag,
      };
    } catch (err: any) {
      if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") {
        return { exists: false };
      }
      throw err;
    }
  }

  async deleteObject(bucket: string, objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
  }

  async getObjectBuffer(bucket: string, objectKey: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
    );
    const body = res.Body as any;
    if (!body) {
      throw new Error(`R2 object ${objectKey} returned empty body`);
    }
    // AWS SDK v3 returns a Node.js Readable for S3 — collect it into a Buffer.
    if (typeof body.transformToByteArray === "function") {
      const bytes = await body.transformToByteArray();
      return Buffer.from(bytes);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer | Uint8Array>) {
      chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  get defaultBucket(): string {
    return this.config.defaultBucket;
  }
}

/** Strip characters that would break an HTTP Content-Disposition header. */
function sanitizeContentDispositionFilename(name: string): string {
  return name.replace(/[\r\n"\\]/g, "_").slice(0, 200);
}

// ---------------------------------------------------------------------------
// Singleton resolver
// ---------------------------------------------------------------------------

let cached: R2StorageProvider | null = null;

/**
 * Resolve the R2 provider from env. Throws if any required variable is
 * missing — callers should catch and return a clear 503 so ops knows the
 * binding is misconfigured rather than silently falling back.
 */
export function getR2Provider(): R2StorageProvider {
  if (cached) return cached;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const defaultBucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !defaultBucket) {
    throw new Error(
      "R2 is not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET",
    );
  }
  cached = new R2StorageProvider({ accountId, accessKeyId, secretAccessKey, defaultBucket });
  return cached;
}

/** True when the env is fully populated. Used for health checks + UI gating. */
export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
  );
}
