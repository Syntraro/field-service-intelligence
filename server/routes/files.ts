import { Router, Response } from "express";
import fs from "fs";
import path from "path";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";
import { filesRepository } from "../storage/files";

const router = Router();

/**
 * GET /api/files/:fileId
 * Securely stream a file from disk — tenant-scoped.
 * Sets Content-Type and Content-Disposition headers.
 */
router.get(
  "/:fileId",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    const { fileId } = req.params;

    const file = await filesRepository.getFile(companyId, fileId);
    if (!file) throw createError(404, "File not found");

    const fullPath = path.resolve(process.cwd(), file.storageKey);
    if (!fs.existsSync(fullPath)) {
      throw createError(404, "File not found on disk");
    }

    // Prevent path traversal — resolved path must still be under uploads/
    const uploadsRoot = path.resolve(process.cwd(), "uploads");
    if (!fullPath.startsWith(uploadsRoot)) {
      throw createError(403, "Access denied");
    }

    res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${(file.originalName || "download").replace(/"/g, '\\"')}"`
    );
    if (file.size) res.setHeader("Content-Length", file.size);

    fs.createReadStream(fullPath).pipe(res);
  })
);

export default router;
