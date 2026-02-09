import { Router, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";
import { filesRepository } from "../storage/files";

const router = Router();

// Ensure base uploads dir exists
const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

/**
 * Multer disk storage — saves to uploads/<companyId>/<fileId><ext>
 * File ID is generated before save so the DB row and disk path are consistent.
 */
const storage = multer.diskStorage({
  destination(req, _file, cb) {
    const companyId = (req as AuthedRequest).companyId;
    const dir = path.join(UPLOADS_ROOT, companyId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    const fileId = randomUUID();
    const ext = path.extname(file.originalname);
    // Stash fileId on the file object for later retrieval
    (file as any)._fileId = fileId;
    cb(null, `${fileId}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 10 }, // 10 MB per file, max 10 files
});

/**
 * POST /api/uploads
 * Multipart upload — accepts field name "files" with multiple files.
 * Returns array of file metadata objects.
 */
router.post(
  "/",
  requireRole(MANAGER_ROLES),
  upload.array("files", 10),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const uploaded = req.files as Express.Multer.File[];
    if (!uploaded || uploaded.length === 0) {
      throw createError(400, "No files uploaded");
    }

    const companyId = req.companyId;
    const userId = req.user!.id;

    const results = await Promise.all(
      uploaded.map(async (f) => {
        const fileId = (f as any)._fileId as string;
        // storageKey is the relative path from project root
        const storageKey = path.relative(process.cwd(), f.path);
        const row = await filesRepository.createFile(companyId, userId, {
          storageKey,
          originalName: f.originalname,
          mimeType: f.mimetype,
          size: f.size,
        });
        return {
          fileId: row.id,
          originalName: row.originalName,
          mimeType: row.mimeType,
          size: row.size,
          downloadUrl: `/api/files/${row.id}`,
        };
      })
    );

    res.status(201).json(results);
  })
);

export default router;
