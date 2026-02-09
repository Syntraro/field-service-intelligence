/**
 * CUSTOMER COMPANY NOTES
 * Notes scoped to a customer company (not a specific location).
 *
 * GET    /api/customer-companies/:customerCompanyId/notes
 * POST   /api/customer-companies/:customerCompanyId/notes
 * PATCH  /api/customer-companies/:customerCompanyId/notes/:noteId
 * DELETE /api/customer-companies/:customerCompanyId/notes/:noteId
 *
 * Tenant isolation: req.companyId (tenant) must own the customer company.
 */
import { Router, Response } from "express";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { parsePaginationLenient } from "../utils/pagination";
import { paginatedCompat } from "../utils/paginatedResponse";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import { clientNotesRepository } from "../storage/clientNotes";
import { noteAttachmentRepository } from "../storage/noteAttachments";

const router = Router();

const noteBodySchema = z.object({
  noteText: z.string().min(1, "Note text is required"),
  showOnJobs: z.boolean().optional(),
  showOnInvoices: z.boolean().optional(),
  showOnQuotes: z.boolean().optional(),
  attachmentFileIds: z.array(z.string()).optional(),
});

const noteUpdateSchema = z.object({
  noteText: z.string().min(1, "Note text is required"),
  showOnJobs: z.boolean().optional(),
  showOnInvoices: z.boolean().optional(),
  showOnQuotes: z.boolean().optional(),
});

// GET /api/customer-companies/:customerCompanyId/notes
router.get(
  "/:customerCompanyId/notes",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    const { customerCompanyId } = req.params;

    await clientNotesRepository.assertCustomerCompanyOwned(companyId, customerCompanyId);

    const { params, explicit } = parsePaginationLenient(req.query);
    const result = await clientNotesRepository.listCustomerCompanyNotes(companyId, customerCompanyId, {
      limit: params.limit,
      offset: params.offset ?? 0,
    });

    // Enrich each note with attachments
    const enriched = await Promise.all(
      result.items.map(async (note: any) => ({
        ...note,
        attachments: await noteAttachmentRepository.listByNote(companyId, note.id),
      }))
    );

    const meta = { limit: params.limit, hasMore: result.hasMore, nextOffset: result.nextOffset };
    res.json(paginatedCompat(enriched, meta, explicit));
  })
);

// POST /api/customer-companies/:customerCompanyId/notes
router.post(
  "/:customerCompanyId/notes",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId, user } = req;
    const { customerCompanyId } = req.params;

    const body = validateSchema(noteBodySchema, req.body);
    await clientNotesRepository.assertCustomerCompanyOwned(companyId, customerCompanyId);

    // Dedupe within 5-second window
    const dup = await clientNotesRepository.findRecentDuplicateForCustomerCompany(
      companyId, user!.id, customerCompanyId, body.noteText
    );
    if (dup) return res.status(200).json(dup);

    const created = await clientNotesRepository.createCustomerCompanyNote(
      companyId, user!.id, customerCompanyId, body.noteText, {
        showOnJobs: body.showOnJobs,
        showOnInvoices: body.showOnInvoices,
        showOnQuotes: body.showOnQuotes,
      }
    );

    // Attach uploaded files if provided
    if (body.attachmentFileIds?.length) {
      await Promise.all(
        body.attachmentFileIds.map((fid) => noteAttachmentRepository.attach(companyId, user!.id, created.id, fid))
      );
    }

    const attachments = await noteAttachmentRepository.listByNote(companyId, created.id);
    res.status(201).json({ ...created, attachments });
  })
);

// PATCH /api/customer-companies/:customerCompanyId/notes/:noteId
router.patch(
  "/:customerCompanyId/notes/:noteId",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    const { customerCompanyId, noteId } = req.params;

    const body = validateSchema(noteUpdateSchema, req.body);
    await clientNotesRepository.assertCustomerCompanyOwned(companyId, customerCompanyId);

    const updated = await clientNotesRepository.updateCustomerCompanyNote(
      companyId, customerCompanyId, noteId, body.noteText, {
        showOnJobs: body.showOnJobs,
        showOnInvoices: body.showOnInvoices,
        showOnQuotes: body.showOnQuotes,
      }
    );
    if (!updated) throw createError(404, "Note not found");

    const attachments = await noteAttachmentRepository.listByNote(companyId, updated.id);
    res.json({ ...updated, attachments });
  })
);

// DELETE /api/customer-companies/:customerCompanyId/notes/:noteId
router.delete(
  "/:customerCompanyId/notes/:noteId",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req;
    const { customerCompanyId, noteId } = req.params;

    await clientNotesRepository.assertCustomerCompanyOwned(companyId, customerCompanyId);
    const deleted = await clientNotesRepository.deleteCustomerCompanyNote(companyId, customerCompanyId, noteId);
    if (!deleted) throw createError(404, "Note not found");
    // note_attachments cascade-deleted by FK constraint
    res.json({ success: true });
  })
);

export default router;
