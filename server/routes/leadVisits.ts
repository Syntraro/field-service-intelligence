/**
 * Lead Visits Routes — pre-sales scheduling (2026-05-05).
 *
 * Office endpoints (this file):
 *   GET    /api/leads/:leadId/visits
 *   POST   /api/leads/:leadId/visits
 *   PATCH  /api/leads/:leadId/visits/:visitId
 *   POST   /api/leads/:leadId/visits/:visitId/cancel
 *   DELETE /api/leads/:leadId/visits/:visitId
 *
 * Tech endpoints live in `routes/leadVisitsTech.ts` (mounted at
 * `/api/tech`). Kept in two files because the tech surface has
 * different middleware (`requireSchedulable` + assignment scoping)
 * and a strict allowlist DTO, while the office surface uses
 * `requireRole(MANAGER_ROLES)` and returns the full row.
 *
 * Auth: every office route gates on `requireRole(MANAGER_ROLES)`.
 * No `requirePermission(...)` is added — the matrix doc reserves
 * lead/visit creation for the existing manager-tier role gate, and
 * a fine `dispatch.manage` permission has not been seeded yet
 * (Phase 2 PR 4 deferred it).
 */

import { Router, type Response } from "express";
import { z } from "zod";
import { asyncHandler, createError } from "../middleware/errorHandler";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import {
  createLeadVisit,
  updateLeadVisit,
  getLeadVisit,
  listLeadVisitsForLead,
  archiveLeadVisit,
  cancelLeadVisit,
} from "../storage/leadVisits";
import { leadRepository } from "../storage/leads";
import { leadVisitStatusEnum } from "@shared/schema";

const router = Router();

// ── Validation schemas ──────────────────────────────────────────────

const isoDateSchema = z.union([z.string(), z.date(), z.null()]);

const createBodySchema = z.object({
  scheduledStart: isoDateSchema.optional(),
  scheduledEnd: isoDateSchema.optional(),
  estimatedDurationMinutes: z.number().int().positive().nullable().optional(),
  isAllDay: z.boolean().optional(),
  assignedTechnicianIds: z.array(z.string()).nullable().optional(),
  status: z.enum(leadVisitStatusEnum).optional(),
  visitNotes: z.string().max(5000).nullable().optional(),
});

const updateBodySchema = z.object({
  scheduledStart: isoDateSchema.optional(),
  scheduledEnd: isoDateSchema.optional(),
  estimatedDurationMinutes: z.number().int().positive().nullable().optional(),
  isAllDay: z.boolean().optional(),
  assignedTechnicianIds: z.array(z.string()).nullable().optional(),
  status: z.enum(leadVisitStatusEnum).optional(),
  visitNotes: z.string().max(5000).nullable().optional(),
  outcomeNote: z.string().max(5000).nullable().optional(),
});

// ── Helpers ─────────────────────────────────────────────────────────

/** Tenant gate: lead must exist in caller's company. Throws 404 on miss. */
async function assertLeadInTenant(companyId: string, leadId: string) {
  const lead = await leadRepository.getLead(companyId, leadId);
  if (!lead) throw createError(404, "Lead not found");
  return lead;
}

/** Tenant gate: visit must exist on this lead in this tenant. */
async function assertVisitInTenantOnLead(
  companyId: string,
  leadId: string,
  visitId: string,
) {
  const visit = await getLeadVisit(companyId, visitId);
  if (!visit || visit.leadId !== leadId) {
    throw createError(404, "Lead visit not found");
  }
  return visit;
}

// ── Routes ──────────────────────────────────────────────────────────

/** GET /api/leads/:leadId/visits — list all active visits on the lead. */
router.get(
  "/:leadId/visits",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { leadId } = req.params;
    await assertLeadInTenant(companyId, leadId);
    const visits = await listLeadVisitsForLead(companyId, leadId);
    res.json({ data: visits });
  }),
);

/**
 * POST /api/leads/:leadId/visits — create a scheduled visit.
 *
 * Body: any subset of (scheduledStart, scheduledEnd, durationMinutes,
 * isAllDay, assignedTechnicianIds, visitNotes). Schedule fields run
 * through `normalizeVisitSchedule` inside the storage layer so the
 * row never holds an illegal state.
 */
router.post(
  "/:leadId/visits",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const actorId = req.user!.id;
    const { leadId } = req.params;
    await assertLeadInTenant(companyId, leadId);

    const body = createBodySchema.parse(req.body ?? {});
    const visit = await createLeadVisit(companyId, {
      leadId,
      scheduledStart: body.scheduledStart ?? null,
      scheduledEnd: body.scheduledEnd ?? null,
      estimatedDurationMinutes: body.estimatedDurationMinutes ?? null,
      isAllDay: body.isAllDay,
      assignedTechnicianIds: body.assignedTechnicianIds,
      status: body.status,
      visitNotes: body.visitNotes,
      createdByUserId: actorId,
    });
    res.status(201).json(visit);
  }),
);

/** PATCH /api/leads/:leadId/visits/:visitId — reschedule / reassign / status. */
router.patch(
  "/:leadId/visits/:visitId",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { leadId, visitId } = req.params;
    await assertVisitInTenantOnLead(companyId, leadId, visitId);

    const body = updateBodySchema.parse(req.body ?? {});
    const updated = await updateLeadVisit(companyId, visitId, body);
    if (!updated) throw createError(404, "Lead visit not found");
    res.json(updated);
  }),
);

/**
 * POST /api/leads/:leadId/visits/:visitId/cancel — set status =
 * cancelled. Row stays active (history); use DELETE to archive.
 */
router.post(
  "/:leadId/visits/:visitId/cancel",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { leadId, visitId } = req.params;
    await assertVisitInTenantOnLead(companyId, leadId, visitId);

    const cancelled = await cancelLeadVisit(companyId, visitId);
    if (!cancelled) throw createError(404, "Lead visit not found");
    res.json(cancelled);
  }),
);

/** DELETE /api/leads/:leadId/visits/:visitId — soft-delete (archive). */
router.delete(
  "/:leadId/visits/:visitId",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const actorId = req.user!.id;
    const { leadId, visitId } = req.params;
    await assertVisitInTenantOnLead(companyId, leadId, visitId);

    const archived = await archiveLeadVisit(companyId, visitId, actorId);
    if (!archived) throw createError(404, "Lead visit not found");
    res.json({ id: archived.id, archivedAt: archived.archivedAt });
  }),
);

export default router;
