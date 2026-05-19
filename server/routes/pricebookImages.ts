/**
 * Pricebook image upload/remove routes.
 *
 * Unlike the existing presigned-URL file pipeline, images are received
 * server-side (multipart) so sharp can resize + compress before storage.
 * Originals are NEVER written to R2 permanently.
 *
 * Routes:
 *   POST   /api/items/:id/image                — attach/replace image on a catalog item
 *   DELETE /api/items/:id/image                — remove image from a catalog item
 *   POST   /api/service-templates/:id/image    — attach/replace on a flat-rate template
 *   DELETE /api/service-templates/:id/image    — remove image from a flat-rate template
 *
 * Auth: MANAGER_ROLES + pricing.edit on all four.
 */

import { Router, Response } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { items, serviceTemplates, files } from "@shared/schema";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { requirePermission } from "../permissions";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";
import { getR2Provider, isR2Configured } from "../services/storage/R2StorageProvider";
import {
  processItemImage,
  validatePricebookImageMime,
  validatePricebookImageSize,
  PRICEBOOK_IMAGE_MAX_RAW_BYTES,
} from "../services/imageProcessor";
import {
  queueFileCleanupInTx,
  triggerCleanupAsync,
} from "../services/fileCleanupService";

const router = Router();

// Accept images only, buffer in memory (max 5 MB raw).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PRICEBOOK_IMAGE_MAX_RAW_BYTES },
  fileFilter: (_req, file, cb) => {
    try {
      validatePricebookImageMime(file.mimetype);
      cb(null, true);
    } catch {
      cb(new Error(`Unsupported image type: ${file.mimetype}`));
    }
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function pricebookImageKey(tenantId: string, entityType: "item" | "template", entityId: string, fileId: string): string {
  return `tenants/${tenantId}/pricebook/${entityType}s/${entityId}/image/${fileId}.webp`;
}

function pricebookThumbKey(tenantId: string, entityType: "item" | "template", entityId: string, fileId: string): string {
  return `tenants/${tenantId}/pricebook/${entityType}s/${entityId}/thumb/${fileId}.webp`;
}

interface UploadedImageMeta {
  imageFileId: string;
  imageStorageKey: string;
  thumbnailStorageKey: string;
  imageMimeType: string;
  imageFileName: string;
}

async function storeProcessedImage(
  companyId: string,
  userId: string,
  entityType: "item" | "template",
  entityId: string,
  rawBuffer: Buffer,
  originalFilename: string,
  mimeType: string,
): Promise<UploadedImageMeta> {
  if (!isR2Configured()) {
    throw createError(503, "File storage is not configured");
  }

  validatePricebookImageSize(rawBuffer.byteLength);
  const processed = await processItemImage(rawBuffer, mimeType);

  const provider = getR2Provider();
  const bucket = provider.defaultBucket;
  const fileId = randomUUID();
  const imageKey = pricebookImageKey(companyId, entityType, entityId, fileId);
  const thumbKey = pricebookThumbKey(companyId, entityType, entityId, fileId);

  // Upload both versions to R2 in parallel.
  await Promise.all([
    provider.putObjectBuffer(bucket, imageKey, processed.optimizedBuffer, "image/webp"),
    provider.putObjectBuffer(bucket, thumbKey, processed.thumbnailBuffer, "image/webp"),
  ]);

  // Create a files metadata row for the optimized image (status=uploaded directly).
  const [fileRow] = await db
    .insert(files)
    .values({
      id: fileId,
      companyId,
      storageProvider: "r2",
      bucket,
      storageKey: imageKey,
      originalName: originalFilename,
      mimeType: "image/webp",
      size: processed.optimizedBytes,
      status: "uploaded",
      category: "other",
      createdBy: userId,
    })
    .returning({ id: files.id });

  return {
    imageFileId: fileRow.id,
    imageStorageKey: imageKey,
    thumbnailStorageKey: thumbKey,
    imageMimeType: "image/webp",
    imageFileName: originalFilename,
  };
}

async function enqueueOldImageCleanup(
  companyId: string,
  bucket: string,
  old: { imageFileId: string | null; imageStorageKey: string | null; thumbnailStorageKey: string | null },
  sourceRef: string,
): Promise<void> {
  const entries: Parameters<typeof queueFileCleanupInTx>[2] = [];
  if (old.imageStorageKey) {
    entries.push({
      fileId: old.imageFileId ?? `pbi_${randomUUID()}`,
      bucket,
      storageKey: old.imageStorageKey,
      storageProvider: "r2",
    });
  }
  if (old.thumbnailStorageKey) {
    entries.push({
      fileId: `pbi_thumb_${old.imageFileId ?? randomUUID()}`,
      bucket,
      storageKey: old.thumbnailStorageKey,
      storageProvider: "r2",
    });
  }
  if (entries.length > 0) {
    await queueFileCleanupInTx(db, companyId, entries, sourceRef);
    triggerCleanupAsync(sourceRef, companyId);
  }
}

// ── Items: POST /api/items/:id/image ─────────────────────────────────────────

router.post(
  "/items/:id/image",
  requireRole(MANAGER_ROLES),
  requirePermission("pricing.edit"),
  upload.single("image"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const userId = req.user?.id;
    if (!companyId || !userId) throw createError(401, "Unauthorized");
    if (!req.file) throw createError(400, "No image file provided");

    const [existing] = await db
      .select({
        id: items.id,
        imageFileId: items.imageFileId,
        imageStorageKey: items.imageStorageKey,
        thumbnailStorageKey: items.thumbnailStorageKey,
      })
      .from(items)
      .where(and(eq(items.id, req.params.id), eq(items.companyId, companyId)))
      .limit(1);
    if (!existing) throw createError(404, "Item not found");

    const meta = await storeProcessedImage(
      companyId,
      userId,
      "item",
      existing.id,
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
    );

    const [updated] = await db
      .update(items)
      .set({ ...meta, imageAltText: req.body.altText ?? null, updatedAt: new Date() })
      .where(and(eq(items.id, existing.id), eq(items.companyId, companyId)))
      .returning();

    // Queue old image for cleanup after the new one is committed.
    if (existing.imageStorageKey || existing.thumbnailStorageKey) {
      const provider = getR2Provider();
      await enqueueOldImageCleanup(
        companyId,
        provider.defaultBucket,
        existing,
        "item_image_replace",
      );
    }

    res.json(updated);
  }),
);

// ── Items: DELETE /api/items/:id/image ───────────────────────────────────────

router.delete(
  "/items/:id/image",
  requireRole(MANAGER_ROLES),
  requirePermission("pricing.edit"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) throw createError(401, "Unauthorized");

    const [existing] = await db
      .select({
        id: items.id,
        imageFileId: items.imageFileId,
        imageStorageKey: items.imageStorageKey,
        thumbnailStorageKey: items.thumbnailStorageKey,
      })
      .from(items)
      .where(and(eq(items.id, req.params.id), eq(items.companyId, companyId)))
      .limit(1);
    if (!existing) throw createError(404, "Item not found");

    const [updated] = await db
      .update(items)
      .set({
        imageFileId: null,
        imageStorageKey: null,
        imageMimeType: null,
        imageFileName: null,
        imageAltText: null,
        thumbnailStorageKey: null,
        updatedAt: new Date(),
      })
      .where(and(eq(items.id, existing.id), eq(items.companyId, companyId)))
      .returning();

    if (existing.imageStorageKey || existing.thumbnailStorageKey) {
      const provider = getR2Provider();
      await enqueueOldImageCleanup(
        companyId,
        provider.defaultBucket,
        existing,
        "item_image_remove",
      );
    }

    res.json(updated);
  }),
);

// ── Service Templates: POST /api/service-templates/:id/image ─────────────────

router.post(
  "/service-templates/:id/image",
  requireRole(MANAGER_ROLES),
  requirePermission("pricing.edit"),
  upload.single("image"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    const userId = req.user?.id;
    if (!companyId || !userId) throw createError(401, "Unauthorized");
    if (!req.file) throw createError(400, "No image file provided");

    const [existing] = await db
      .select({
        id: serviceTemplates.id,
        imageFileId: serviceTemplates.imageFileId,
        imageStorageKey: serviceTemplates.imageStorageKey,
        thumbnailStorageKey: serviceTemplates.thumbnailStorageKey,
      })
      .from(serviceTemplates)
      .where(
        and(
          eq(serviceTemplates.id, req.params.id),
          eq(serviceTemplates.companyId, companyId),
        ),
      )
      .limit(1);
    if (!existing) throw createError(404, "Service template not found");

    const meta = await storeProcessedImage(
      companyId,
      userId,
      "template",
      existing.id,
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
    );

    const [updated] = await db
      .update(serviceTemplates)
      .set({ ...meta, imageAltText: req.body.altText ?? null, updatedAt: new Date() })
      .where(
        and(eq(serviceTemplates.id, existing.id), eq(serviceTemplates.companyId, companyId)),
      )
      .returning();

    if (existing.imageStorageKey || existing.thumbnailStorageKey) {
      const provider = getR2Provider();
      await enqueueOldImageCleanup(
        companyId,
        provider.defaultBucket,
        existing,
        "template_image_replace",
      );
    }

    res.json(updated);
  }),
);

// ── Service Templates: DELETE /api/service-templates/:id/image ───────────────

router.delete(
  "/service-templates/:id/image",
  requireRole(MANAGER_ROLES),
  requirePermission("pricing.edit"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) throw createError(401, "Unauthorized");

    const [existing] = await db
      .select({
        id: serviceTemplates.id,
        imageFileId: serviceTemplates.imageFileId,
        imageStorageKey: serviceTemplates.imageStorageKey,
        thumbnailStorageKey: serviceTemplates.thumbnailStorageKey,
      })
      .from(serviceTemplates)
      .where(
        and(
          eq(serviceTemplates.id, req.params.id),
          eq(serviceTemplates.companyId, companyId),
        ),
      )
      .limit(1);
    if (!existing) throw createError(404, "Service template not found");

    const [updated] = await db
      .update(serviceTemplates)
      .set({
        imageFileId: null,
        imageStorageKey: null,
        imageMimeType: null,
        imageFileName: null,
        imageAltText: null,
        thumbnailStorageKey: null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(serviceTemplates.id, existing.id), eq(serviceTemplates.companyId, companyId)),
      )
      .returning();

    if (existing.imageStorageKey || existing.thumbnailStorageKey) {
      const provider = getR2Provider();
      await enqueueOldImageCleanup(
        companyId,
        provider.defaultBucket,
        existing,
        "template_image_remove",
      );
    }

    res.json(updated);
  }),
);

// ── Signed URL endpoints (reads — no permission gate beyond auth) ─────────────

router.get(
  "/items/:id/image-url",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) throw createError(401, "Unauthorized");
    if (!isR2Configured()) return res.json({ imageUrl: null, thumbnailUrl: null });

    const [row] = await db
      .select({
        imageStorageKey: items.imageStorageKey,
        thumbnailStorageKey: items.thumbnailStorageKey,
        imageFileName: items.imageFileName,
      })
      .from(items)
      .where(and(eq(items.id, req.params.id), eq(items.companyId, companyId)))
      .limit(1);
    if (!row) throw createError(404, "Item not found");

    if (!row.imageStorageKey) return res.json({ imageUrl: null, thumbnailUrl: null });

    const provider = getR2Provider();
    const bucket = provider.defaultBucket;
    const [imageSigned, thumbSigned] = await Promise.all([
      provider.createPresignedDownload({ bucket, objectKey: row.imageStorageKey, filename: row.imageFileName ?? undefined }),
      row.thumbnailStorageKey
        ? provider.createPresignedDownload({ bucket, objectKey: row.thumbnailStorageKey })
        : Promise.resolve(null),
    ]);

    res.json({
      imageUrl: imageSigned.url,
      thumbnailUrl: thumbSigned?.url ?? null,
      expiresInSeconds: imageSigned.expiresInSeconds,
    });
  }),
);

router.get(
  "/service-templates/:id/image-url",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) throw createError(401, "Unauthorized");
    if (!isR2Configured()) return res.json({ imageUrl: null, thumbnailUrl: null });

    const [row] = await db
      .select({
        imageStorageKey: serviceTemplates.imageStorageKey,
        thumbnailStorageKey: serviceTemplates.thumbnailStorageKey,
        imageFileName: serviceTemplates.imageFileName,
      })
      .from(serviceTemplates)
      .where(
        and(
          eq(serviceTemplates.id, req.params.id),
          eq(serviceTemplates.companyId, companyId),
        ),
      )
      .limit(1);
    if (!row) throw createError(404, "Service template not found");

    if (!row.imageStorageKey) return res.json({ imageUrl: null, thumbnailUrl: null });

    const provider = getR2Provider();
    const bucket = provider.defaultBucket;
    const [imageSigned, thumbSigned] = await Promise.all([
      provider.createPresignedDownload({ bucket, objectKey: row.imageStorageKey, filename: row.imageFileName ?? undefined }),
      row.thumbnailStorageKey
        ? provider.createPresignedDownload({ bucket, objectKey: row.thumbnailStorageKey })
        : Promise.resolve(null),
    ]);

    res.json({
      imageUrl: imageSigned.url,
      thumbnailUrl: thumbSigned?.url ?? null,
      expiresInSeconds: imageSigned.expiresInSeconds,
    });
  }),
);

export default router;
