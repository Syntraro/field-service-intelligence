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
import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import { users, clientLocations } from "@shared/schema";

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
 * GET /api/leads/:id — Get lead detail with joined user names + location
 */
router.get(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const lead = await leadRepository.getLead(companyId, req.params.id);
    if (!lead) throw createError(404, "Lead not found");

    // Enrich with user names + location info for detail page
    const [createdBy] = lead.createdByUserId
      ? await db.select({ fullName: users.fullName, firstName: users.firstName }).from(users).where(eq(users.id, lead.createdByUserId)).limit(1)
      : [null];
    const [originTech] = lead.originTechnicianId
      ? await db.select({ fullName: users.fullName, firstName: users.firstName }).from(users).where(eq(users.id, lead.originTechnicianId)).limit(1)
      : [null];
    const [assignedTo] = lead.assignedToUserId
      ? await db.select({ fullName: users.fullName, firstName: users.firstName }).from(users).where(eq(users.id, lead.assignedToUserId)).limit(1)
      : [null];
    const [location] = lead.locationId
      ? await db.select({
          companyName: clientLocations.companyName, address: clientLocations.address,
          city: clientLocations.city, province: clientLocations.province,
          postalCode: clientLocations.postalCode,
          contactName: clientLocations.contactName, email: clientLocations.email, phone: clientLocations.phone,
        }).from(clientLocations).where(eq(clientLocations.id, lead.locationId)).limit(1)
      : [null];

    // Customer company name if available
    let customerCompanyName: string | null = null;
    if (lead.customerCompanyId) {
      const { customerCompanies } = await import("@shared/schema");
      const [cc] = await db.select({ name: customerCompanies.name }).from(customerCompanies).where(eq(customerCompanies.id, lead.customerCompanyId)).limit(1);
      customerCompanyName = cc?.name ?? null;
    }

    res.json({
      ...lead,
      createdByName: createdBy?.fullName ?? createdBy?.firstName ?? null,
      originTechnicianName: originTech?.fullName ?? originTech?.firstName ?? null,
      assignedToName: assignedTo?.fullName ?? assignedTo?.firstName ?? null,
      location: location ?? null,
      customerCompanyName,
    });
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

// ============================================================================
// DELETE /api/leads/:id — Archive lead (soft-delete via isActive=false)
// ============================================================================

router.delete(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const lead = await leadRepository.getLead(companyId, req.params.id);
    if (!lead) throw createError(404, "Lead not found");

    await leadRepository.archiveLead(companyId, req.params.id);

    res.json({ success: true });
  })
);

// ============================================================================
// POST /api/leads/:id/restore — Restore archived lead
// ============================================================================

router.post(
  "/:id/restore",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const restored = await leadRepository.restoreLead(companyId, req.params.id);

    if (!restored) throw createError(404, "Lead not found or not archived");
    res.json(restored);
  })
);

// ============================================================================
// DELETE /api/leads/:id/hard — Hard-delete lead (irreversible)
// Permanently removes the lead row + cascade-deletes lead notes.
// Use DELETE /api/leads/:id for reversible archive instead.
// ============================================================================

router.delete(
  "/:id/hard",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    // hardDeleteLead is companyId-scoped and works on active or archived leads.
    const deleted = await leadRepository.hardDeleteLead(companyId, req.params.id);
    if (!deleted) throw createError(404, "Lead not found");
    res.json({ success: true });
  })
);

// ============================================================================
// Lead Notes — CRUD for internal lead notes
// ============================================================================

import { leadNotes } from "@shared/schema";

/** GET /api/leads/:id/notes */
router.get(
  "/:id/notes",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const rows = await db
      .select({
        id: leadNotes.id,
        userId: leadNotes.userId,
        noteText: leadNotes.noteText,
        createdAt: leadNotes.createdAt,
        updatedAt: leadNotes.updatedAt,
        userName: users.fullName,
        userFirstName: users.firstName,
      })
      .from(leadNotes)
      .leftJoin(users, eq(leadNotes.userId, users.id))
      .where(and(eq(leadNotes.companyId, companyId), eq(leadNotes.leadId, req.params.id)))
      .orderBy(desc(leadNotes.createdAt));

    res.json(rows.map(r => ({
      id: r.id,
      userId: r.userId,
      text: r.noteText,
      author: r.userName ?? r.userFirstName ?? "Unknown",
      createdAt: r.createdAt?.toISOString() ?? null,
      updatedAt: r.updatedAt?.toISOString() ?? null,
    })));
  })
);

/** POST /api/leads/:id/notes */
router.post(
  "/:id/notes",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;
    const { noteText } = req.body;

    if (!noteText || typeof noteText !== "string" || !noteText.trim()) {
      throw createError(400, "noteText is required");
    }

    const lead = await leadRepository.getLead(companyId, req.params.id);
    if (!lead) throw createError(404, "Lead not found");

    const note = await leadRepository.createNote(companyId, req.params.id, userId, noteText.trim());

    res.status(201).json(note);
  })
);

/** PATCH /api/leads/:id/notes/:noteId — Update note text (author only) */
router.patch(
  "/:id/notes/:noteId",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const userId = req.user!.id;
    const { noteId } = req.params;
    const { noteText } = req.body;

    if (!noteText || typeof noteText !== "string" || !noteText.trim()) {
      throw createError(400, "noteText is required");
    }

    const existing = await leadRepository.getNote(companyId, noteId);
    if (!existing) throw createError(404, "Note not found");
    // Authorship check — only the original author may edit
    if (existing.userId !== userId) {
      throw createError(403, "Only the note author can edit this note");
    }

    const updated = await leadRepository.updateNote(companyId, noteId, noteText.trim());
    if (!updated) throw createError(404, "Note not found");
    res.json(updated);
  })
);

/** DELETE /api/leads/:id/notes/:noteId */
router.delete(
  "/:id/notes/:noteId",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { noteId } = req.params;

    const deleted = await leadRepository.deleteNote(companyId, noteId);

    if (!deleted) throw createError(404, "Note not found");
    res.json({ success: true });
  })
);

export default router;
