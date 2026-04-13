/**
 * Canonical file upload routes.
 *
 * Thin controllers — all policy + blob I/O lives in
 * server/services/fileUploadService.ts. This module only parses input,
 * enforces auth, and maps service results to JSON.
 *
 * Mounted at / (see server/routes/index.ts):
 *   POST   /api/files/upload-request
 *   POST   /api/files/:fileId/finalize
 *   POST   /api/files/:fileId/access-url
 *   DELETE /api/files/:fileId
 *   GET    /api/notes/:noteId/files
 */

import { Router, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";
import { validateSchema } from "../utils/validationHelpers";
import {
  deleteFile,
  finalizeUpload,
  getFileAccessUrl,
  listClientFiles,
  listClientNoteFiles,
  listContractFiles,
  listJobNoteFiles,
  listTechnicianFiles,
  requestUpload,
} from "../services/fileUploadService";

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

// 2026-04-12 Phase 2: entityType now covers every file-owning entity. Each
// value maps to an adapter inside fileUploadService; routes stay thin.
const ENTITY_TYPES = [
  "job_note",
  "client_note",
  "client_document",
  "contract_document",
  "technician_document",
] as const;

const uploadRequestSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string().min(1),
  filename: z.string().min(1).max(255),
  mimeType: z.enum(ALLOWED_MIME),
  sizeBytes: z.number().int().positive(),
});

const finalizeSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string().min(1),
});

export const fileUploadsRouter = Router();

fileUploadsRouter.post(
  "/files/upload-request",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const data = validateSchema(uploadRequestSchema, req.body);
    const result = await requestUpload({
      companyId: req.companyId!,
      userId: req.user!.id,
      entityType: data.entityType,
      entityId: data.entityId,
      filename: data.filename,
      mimeType: data.mimeType,
      sizeBytes: data.sizeBytes,
    });
    res.status(201).json(result);
  }),
);

fileUploadsRouter.post(
  "/files/:fileId/finalize",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const data = validateSchema(finalizeSchema, req.body);
    const dto = await finalizeUpload({
      companyId: req.companyId!,
      userId: req.user!.id,
      fileId: req.params.fileId,
      entityType: data.entityType,
      entityId: data.entityId,
    });
    res.status(200).json(dto);
  }),
);

fileUploadsRouter.post(
  "/files/:fileId/access-url",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const result = await getFileAccessUrl(req.companyId!, req.params.fileId);
    res.json(result);
  }),
);

fileUploadsRouter.delete(
  "/files/:fileId",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    await deleteFile(req.companyId!, req.params.fileId);
    res.json({ success: true });
  }),
);

export const jobNoteFilesRouter = Router();

// Job-note files are still listed at /api/notes/:noteId/files to preserve
// the Phase 1 URL. Client-note files live at /api/client-notes/:id/files
// so the two note types don't collide on a single path.
jobNoteFilesRouter.get(
  "/notes/:noteId/files",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const dtos = await listJobNoteFiles(req.companyId!, req.params.noteId);
    res.json(dtos);
  }),
);

jobNoteFilesRouter.get(
  "/client-notes/:noteId/files",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const dtos = await listClientNoteFiles(req.companyId!, req.params.noteId);
    res.json(dtos);
  }),
);

jobNoteFilesRouter.get(
  "/clients/:clientId/files",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const dtos = await listClientFiles(req.companyId!, req.params.clientId);
    res.json(dtos);
  }),
);

jobNoteFilesRouter.get(
  "/contracts/:contractId/files",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const dtos = await listContractFiles(req.companyId!, req.params.contractId);
    res.json(dtos);
  }),
);

jobNoteFilesRouter.get(
  "/technicians/:technicianId/files",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const dtos = await listTechnicianFiles(req.companyId!, req.params.technicianId);
    res.json(dtos);
  }),
);
