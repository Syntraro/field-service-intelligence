import { Router, Response } from "express";
import * as service from "../services/jobVisits.service";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { parsePaginationLenient } from "../utils/pagination";
import { paginatedCompat } from "../utils/paginatedResponse";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import { jobVisitStatusEnum } from "../../shared/schema";

const router = Router();

// ========================================
// VALIDATION SCHEMAS
// ========================================

const createVisitSchema = z.object({
  scheduledDate: z.string().datetime(),
  estimatedDurationMinutes: z.number().int().positive().default(60),
  assignedTechnicianId: z.string().uuid().optional(),
  visitNotes: z.string().max(2000).optional(),
}).strict();

const updateVisitSchema = z.object({
  scheduledDate: z.string().datetime().optional(),
  estimatedDurationMinutes: z.number().int().positive().optional(),
  assignedTechnicianId: z.string().uuid().nullable().optional(),
  visitNotes: z.string().max(2000).nullable().optional(),
}).strict();

const updateStatusSchema = z.object({
  status: z.enum(jobVisitStatusEnum),
}).strict();

// ========================================
// ROUTES
// ========================================

/* GET /api/jobs/:jobId/visits - List visits for a job */
router.get(
  "/:jobId/visits",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { params, explicit } = parsePaginationLenient(req.query);

    const offset = params.offset ?? 0;
    const limit = params.limit;

    const result = await service.listJobVisits({
      companyId,
      jobId: req.params.jobId,
      status: req.query.status as string | undefined,
      assignedTechnicianId: req.query.assignedTechnicianId as string | undefined,
      offset,
      limit,
    });

    const meta = {
      limit,
      hasMore: result.hasMore,
      nextOffset: result.hasMore ? offset + limit : undefined,
    };

    res.json(paginatedCompat(result.items, meta, explicit));
  })
);

/* POST /api/jobs/:jobId/visits - Create new visit */
router.post(
  "/:jobId/visits",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;

    const validated = validateSchema(createVisitSchema, req.body);

    const visit = await service.createJobVisit(
      companyId,
      req.params.jobId,
      validated
    );

    res.status(201).json(visit);
  })
);

/* GET /api/jobs/:jobId/visits/:visitId - Get single visit */
router.get(
  "/:jobId/visits/:visitId",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;

    const visit = await service.getJobVisit(companyId, req.params.visitId);
    if (!visit) {
      throw createError(404, "Visit not found");
    }

    res.json(visit);
  })
);

/* PATCH /api/jobs/:jobId/visits/:visitId - Update visit */
router.patch(
  "/:jobId/visits/:visitId",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;

    const { version, ...data } = req.body;
    const validated = validateSchema(updateVisitSchema, data);

    try {
      const updated = await service.updateJobVisit(
        companyId,
        req.params.visitId,
        version,
        validated
      );

      if (!updated) {
        throw createError(404, "Visit not found");
      }

      res.json(updated);
    } catch (error: any) {
      if (error.message?.includes("modified by another user")) {
        return res.status(409).json({
          error: error.message,
          code: "VERSION_MISMATCH",
        });
      }
      throw error;
    }
  })
);

/* DELETE /api/jobs/:jobId/visits/:visitId - Delete visit (soft delete) */
router.delete(
  "/:jobId/visits/:visitId",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;

    const result = await service.deleteJobVisit(companyId, req.params.visitId);
    res.json(result);
  })
);

/* POST /api/jobs/:jobId/visits/:visitId/status - Update visit status */
router.post(
  "/:jobId/visits/:visitId/status",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;

    const { status } = validateSchema(updateStatusSchema, req.body);

    const updated = await service.updateJobVisitStatus(
      companyId,
      req.params.visitId,
      status
    );

    res.json(updated);
  })
);

/* POST /api/jobs/:jobId/visits/:visitId/check-in - Check in to visit */
router.post(
  "/:jobId/visits/:visitId/check-in",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;

    const visit = await service.checkInJobVisit(companyId, req.params.visitId);
    res.json(visit);
  })
);

/* POST /api/jobs/:jobId/visits/:visitId/check-out - Check out from visit */
router.post(
  "/:jobId/visits/:visitId/check-out",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;

    const visit = await service.checkOutJobVisit(companyId, req.params.visitId);
    res.json(visit);
  })
);

export default router;
