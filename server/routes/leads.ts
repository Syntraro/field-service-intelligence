/**
 * Leads Routes — Pre-quote pipeline + attribution tracking.
 *
 * Endpoints:
 *   GET    /api/leads          — List leads (filterable by status)
 *   GET    /api/leads/:id      — Get lead detail
 *   POST   /api/leads          — Create lead
 *   PATCH  /api/leads/:id      — Update lead (status, assignment, details)
 *
 * Status ownership:
 *   'new'       — set by POST /api/leads
 *   'contacted' — set by PATCH /api/leads/:id
 *   'lost'      — set by PATCH /api/leads/:id
 *   'quoted'    — set by POST /api/quotes (when leadId present) — NOT here
 *   'won'       — set by POST /api/quotes/:id/convert-to-job — NOT here
 */
import { Router, type Response } from "express";
import { z } from "zod";
import { asyncHandler, createError } from "../middleware/errorHandler";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { leadRepository } from "../storage/leads";
import { leadStatusEnum, leadSourceTypeEnum, jobPriorityEnum, insertLeadSchema, updateLeadSchema } from "@shared/schema";

const router = Router();

// Valid manual status transitions (from PATCH only)
const MANUAL_TRANSITIONS: Record<string, string[]> = {
  new: ["contacted", "lost"],
  contacted: ["lost"],
  // 'quoted' and 'won' are set by quote/job routes, not manually
  // 'lost' is terminal for manual transitions
};

const createLeadBodySchema = z.object({
  locationId: z.string().min(1),
  customerCompanyId: z.string().nullable().optional(),
  originTechnicianId: z.string().nullable().optional(),
  assignedToUserId: z.string().nullable().optional(),
  sourceType: z.enum(leadSourceTypeEnum).default("office"),
  sourceRefType: z.string().nullable().optional(),
  sourceRefId: z.string().nullable().optional(),
  priority: z.enum(jobPriorityEnum).nullable().default("medium"),
  title: z.string().min(1).max(500),
  description: z.string().max(2000).nullable().optional(),
  estimatedValue: z.string().nullable().optional(),
});

/**
 * GET /api/leads — List leads with optional status filter
 */
router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const leads = await leadRepository.listLeads(companyId, { status });
    res.json({ data: leads });
  })
);

/**
 * GET /api/leads/:id — Get lead detail
 */
router.get(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const lead = await leadRepository.getLead(companyId, req.params.id);
    if (!lead) throw createError(404, "Lead not found");
    res.json(lead);
  })
);

/**
 * POST /api/leads — Create a new lead
 */
router.post(
  "/",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;
    const body = createLeadBodySchema.parse(req.body);

    const lead = await leadRepository.createLead(companyId, {
      ...body,
      createdByUserId: userId,
      status: "new",
    });

    res.status(201).json(lead);
  })
);

/**
 * PATCH /api/leads/:id — Update lead details or status
 *
 * Rules:
 * - originTechnicianId is IMMUTABLE after creation
 * - Status transitions: only manual transitions allowed (new→contacted, new→lost, contacted→lost)
 * - 'quoted' and 'won' are set by quote/job routes, not here
 */
router.patch(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const leadId = req.params.id;

    const lead = await leadRepository.getLead(companyId, leadId);
    if (!lead) throw createError(404, "Lead not found");

    // Reject originTechnicianId mutation
    if ("originTechnicianId" in req.body) {
      throw createError(400, "originTechnicianId is immutable after creation");
    }

    const body = updateLeadSchema.parse(req.body);

    // Validate status transition if status is being changed
    if (body.status && body.status !== lead.status) {
      const allowed = MANUAL_TRANSITIONS[lead.status];
      if (!allowed || !allowed.includes(body.status)) {
        throw createError(400, `Cannot transition lead from '${lead.status}' to '${body.status}'`);
      }
    }

    const updated = await leadRepository.updateLead(companyId, leadId, body);
    if (!updated) throw createError(404, "Lead not found");

    res.json(updated);
  })
);

export default router;
