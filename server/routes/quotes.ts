import { Router, Response } from "express";
import { z } from "zod";
import { parseISO, isPast, isValid } from "date-fns";
import { requireRole } from "../auth/requireRole";
import { requireFeature } from "../auth/requireFeature";
import { MANAGER_ROLES } from "../auth/roles";
import { notificationService } from "../services/notificationService";
import { parsePagination } from "../utils/pagination";
import { paginated } from "../utils/paginatedResponse";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import { quoteRepository } from "../storage/quotes";
import { jobRepository } from "../storage/jobs";
import { clientRepository } from "../storage/clients";
import { customerCompanyRepository } from "../storage/customerCompanies";
import { leadRepository } from "../storage/leads";
import { jobNotesRepository } from "../storage/jobNotes";
import { storage } from "../storage";
import { generateQuotePdf } from "../services/quotePdfService";
import { resolveCustomerCompanyForLocation } from "../services/customerCompanyResolver";
// 2026-04-12 Phase 7: canonical email pipeline for quote sends.
import { emailDispatchService } from "../services/emailDispatchService";
import { templateDataBuilder } from "../services/templateDataBuilder";
import { communicationTemplatesService } from "../services/communicationTemplatesService";
import { recipientResolverService } from "../services/recipientResolverService";
import type { QuoteStatus } from "@shared/schema";
import { tasks } from "@shared/schema";
import { eq, and, notInArray } from "drizzle-orm";
import { db } from "../db";
import { taskRepository } from "../storage/tasks";
import { quoteNotes, users, quotes, insertQuoteNoteSchema, clientLocations } from "@shared/schema";
import { clientNotesRepository } from "../storage/clientNotes";
import { isQuoteDraft, isQuoteSent, isQuoteApproved } from "../lib/quotePredicates";
// Phase 1 Architecture: Event Log
import { logEventAsync } from "../lib/events";
import { getQueryCtx } from "../lib/queryCtx";
// 2026-04-08: P7 — Canonical line-item input schema (shared with invoices/jobs)
import { canonicalLineItemInput } from "@shared/lineItem";

const router = Router();

// Feature gate: require the canonical `quotes` entitlement for all quotes routes.
router.use(requireFeature("quotes"));

// ========================================
// VALIDATION SCHEMAS
// ========================================

const createQuoteSchema = z.object({
  locationId: z.string().min(1),
  customerCompanyId: z.string().nullable().optional(),
  // Lead attribution — optional link to originating lead
  leadId: z.string().nullable().optional(),
  // Phase 2: Quote ownership
  salesOwnerUserId: z.string().nullable().optional(),
  title: z.string().max(200).optional(),
  issueDate: z.string(),
  expiryDate: z.string().nullable().optional(),
  notesInternal: z.string().max(2000).nullable().optional(),
  notesCustomer: z.string().max(2000).nullable().optional(),
  lines: z.array(z.object({
    description: z.string().min(1).max(500),
    quantity: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().default("1"),
    unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().default("0.00"),
    lineSubtotal: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().default("0.00"),
    taxRate: z.string().regex(/^\d+(\.\d{1,4})?$/).optional().default("0.0000"),
    taxAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().default("0.00"),
    lineTotal: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().default("0.00"),
    lineItemType: z.enum(["service", "material", "fee", "discount"]).optional().default("service"),
    productId: z.string().nullable().optional(),
  })).optional().default([]),
}).strict();

const updateQuoteSchema = z.object({
  locationId: z.string().optional(),
  customerCompanyId: z.string().nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  issueDate: z.string().optional(),
  expiryDate: z.string().nullable().optional(),
  notesInternal: z.string().max(2000).nullable().optional(),
  notesCustomer: z.string().max(2000).nullable().optional(),
  // Phase 2: Quote ownership
  salesOwnerUserId: z.string().nullable().optional(),
  // Phase 2: Assessment requirement — only 'required' or null can be set directly by update
  // 'scheduled' and 'completed' are set by assessment orchestration routes only
  assessmentStatus: z.enum(["required"]).nullable().optional(),
}).strict();

// 2026-04-08: P7 — Migrated to canonical line-item input. The previous schema
// was already string-based and matches canonical 1:1; the migration reduces it
// to a single shared base. No route-specific extension fields needed for quotes.
const createQuoteLineSchema = canonicalLineItemInput.strict();

// ========================================
// ROUTES
// ========================================

// GET /api/quotes/list - List all quotes with pagination
// Supports optional locationId and customerCompanyId query params for scoped views
router.get("/list", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const pagination = parsePagination(req.query);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const locationId = typeof req.query.locationId === "string" ? req.query.locationId : undefined;
  const customerCompanyId = typeof req.query.customerCompanyId === "string" ? req.query.customerCompanyId : undefined;

  const result = await quoteRepository.getQuotes(req.companyId!, {
    ...pagination,
    status,
    locationId,
    customerCompanyId,
  });

  res.json(paginated(result.items, result.meta));
}));

// GET /api/quotes/stats - Get quote statistics
router.get("/stats", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const stats = await quoteRepository.getQuoteStats(req.companyId!);
  res.json(stats);
}));

// GET /api/quotes/:id - Get single quote
router.get("/:id", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const quote = await quoteRepository.getQuote(req.companyId!, req.params.id);
  if (!quote) throw createError(404, "Quote not found");
  res.json(quote);
}));

// GET /api/quotes/:id/details - Get quote with all related data
router.get("/:id/details", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const details = await quoteRepository.getQuoteDetails(req.companyId!, req.params.id);
  if (!details) throw createError(404, "Quote not found");

  // Add computed expiry status
  const expired = isQuoteExpired(details.quote);

  res.json({
    ...details,
    isExpired: expired,
  });
}));

// GET /api/quotes/:id/lines - Get quote line items
router.get("/:id/lines", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const lines = await quoteRepository.getQuoteLines(req.companyId!, req.params.id);
  res.json(lines);
}));

// POST /api/quotes - Create a new quote
router.post("/", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const validated = validateSchema(createQuoteSchema, req.body);

  // Verify location exists
  const location = await clientRepository.getClient(companyId, validated.locationId);
  if (!location) {
    throw createError(400, "Location not found");
  }

  // Deterministically resolve customerCompanyId — never null.
  // If the request includes it, use it; otherwise resolve from the location
  // (find-or-create the parent customer company if location.parentCompanyId is null).
  const customerCompanyId = validated.customerCompanyId
    ?? await resolveCustomerCompanyForLocation(companyId, { ...location, companyName: location.companyName ?? "" });

  const { lines = [], leadId, ...quoteData } = validated;

  // Lead attribution: validate lead exists and is eligible for conversion.
  // MVP rule: one lead → one quote. Enforced by checking BOTH status AND convertedQuoteId
  // to prevent corruption if status was manually reverted.
  if (leadId) {
    const lead = await leadRepository.getLead(companyId, leadId);
    if (!lead) throw createError(400, "Lead not found");
    if (lead.status === "quoted" || lead.status === "won") {
      throw createError(400, `Lead is already '${lead.status}' — one lead can only produce one quote`);
    }
    if (lead.convertedQuoteId) {
      throw createError(400, "Lead already has a linked quote — revise the existing quote instead of creating a new one");
    }
  }

  const quote = await quoteRepository.createQuote(
    companyId,
    {
      ...quoteData,
      leadId: leadId || undefined,
      customerCompanyId,
      status: "draft" as const,
    },
    lines.map((line, index) => ({
      ...line,
      lineNumber: index + 1,
    }))
  );

  // Lead attribution: update lead status to 'quoted' and set conversion reference
  if (leadId) {
    await leadRepository.updateLead(companyId, leadId, {
      status: "quoted",
      convertedQuoteId: quote.id,
      convertedAt: new Date(),
    });
  }

  // Phase 1: Log quote creation event
  logEventAsync(getQueryCtx(req), {
    eventType: "quote.created",
    entityType: "quote",
    entityId: quote.id,
    summary: `Created Quote #${quote.quoteNumber}`,
    meta: { quoteNumber: quote.quoteNumber, customerCompanyId, leadId: leadId || undefined },
  });

  res.status(201).json(quote);
}));

// PATCH /api/quotes/:id - Update a quote
router.patch("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const quoteId = req.params.id;

  // Verify quote exists and is editable
  const existing = await quoteRepository.getQuote(companyId, quoteId);
  if (!existing) {
    throw createError(404, "Quote not found");
  }

  // Only allow editing draft quotes
  if (!isQuoteDraft(existing.status)) {
    throw createError(409, "Only draft quotes can be edited");
  }

  const validated = validateSchema(updateQuoteSchema, req.body);

  // Phase 2: If assessment requirement is being cleared while active assessment exists, cancel it
  if (validated.assessmentStatus === null && existing.assessmentStatus === "scheduled") {
    await cancelActiveAssessmentTask(companyId, quoteId);
  }

  const updated = await quoteRepository.updateQuote(companyId, quoteId, validated);

  if (!updated) {
    throw createError(404, "Quote not found");
  }

  res.json(updated);
}));

// DELETE /api/quotes/:id - Permanent-delete a quote (draft + non-converted only)
//
// 2026-04-26: switched to permanent-delete (matches invoice baseline 2026-04-09).
// quote_lines + quote_notes cascade-delete via their FK on quotes.id.
//
// LEAD HARDENING: Deleting a quote does NOT auto-revert lead.status.
// This is intentional — lead attribution is forward-only. If a draft quote linked to a lead
// is deleted, the lead retains its 'quoted' status and convertedQuoteId. An admin must
// manually update the lead status if they want to re-open it. This prevents silent data
// loss from accidental deletions and keeps the attribution chain auditable.
router.delete("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const quoteId = req.params.id;

  const quote = await quoteRepository.getQuote(companyId, quoteId);
  if (!quote) {
    throw createError(404, "Quote not found");
  }

  // Permanent-delete precondition: only draft, non-converted quotes are deletable.
  if (!isQuoteDraft(quote.status) || quote.convertedToJobId) {
    throw createError(
      409,
      "Only draft, non-converted quotes can be deleted",
      "QUOTE_NOT_DELETABLE",
    );
  }

  const deleted = await quoteRepository.deleteQuote(companyId, quoteId);
  if (!deleted) {
    // Storage WHERE clause re-checks the precondition; reaching here means a
    // concurrent status change won the race. Same 409 mapping.
    throw createError(409, "Only draft, non-converted quotes can be deleted", "QUOTE_NOT_DELETABLE");
  }

  res.json({ success: true });
}));

// ========================================
// LINE ITEM ROUTES
// ========================================

// POST /api/quotes/:id/lines - Add line to quote
router.post("/:id/lines", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const quoteId = req.params.id;

  // Verify quote is draft
  const quote = await quoteRepository.getQuote(companyId, quoteId);
  if (!quote) {
    throw createError(404, "Quote not found");
  }
  if (!isQuoteDraft(quote.status)) {
    throw createError(409, "Cannot add lines to non-draft quotes");
  }

  const validated = validateSchema(createQuoteLineSchema, req.body);
  const line = await quoteRepository.createQuoteLine(companyId, quoteId, validated);

  res.status(201).json(line);
}));

// PATCH /api/quotes/:id/lines/:lineId - Update line item
router.patch("/:id/lines/:lineId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const { id: quoteId, lineId } = req.params;

  // Verify quote is draft
  const quote = await quoteRepository.getQuote(companyId, quoteId);
  if (!quote) {
    throw createError(404, "Quote not found");
  }
  if (!isQuoteDraft(quote.status)) {
    throw createError(409, "Cannot edit lines on non-draft quotes");
  }

  const validated = validateSchema(createQuoteLineSchema.partial(), req.body);
  const updated = await quoteRepository.updateQuoteLine(companyId, quoteId, lineId, validated);

  if (!updated) {
    throw createError(404, "Line not found");
  }

  res.json(updated);
}));

// DELETE /api/quotes/:id/lines/:lineId - Remove line from quote
router.delete("/:id/lines/:lineId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const { id: quoteId, lineId } = req.params;

  // Verify quote is draft
  const quote = await quoteRepository.getQuote(companyId, quoteId);
  if (!quote) {
    throw createError(404, "Quote not found");
  }
  if (!isQuoteDraft(quote.status)) {
    throw createError(409, "Cannot remove lines from non-draft quotes");
  }

  const deleted = await quoteRepository.deleteQuoteLine(companyId, quoteId, lineId);
  if (!deleted) {
    throw createError(404, "Line not found");
  }

  res.json({ success: true });
}));

// ========================================
// HELPER: Check if quote is expired
// ========================================

function isQuoteExpired(quote: { expiryDate?: string | Date | null; status: string }): boolean {
  // Only sent quotes can expire
  if (quote.status !== "sent") return false;
  if (!quote.expiryDate) return false;

  const expiryDate = typeof quote.expiryDate === "string"
    ? parseISO(quote.expiryDate)
    : quote.expiryDate;

  if (!isValid(expiryDate)) return false;
  return isPast(expiryDate);
}

// ========================================
// QUOTE NOTES (Phase 3D — canonical interactive notes)
// ========================================
// Mirrors the jobNotes shape (server/storage/jobNotes.ts). Tenant-scoped;
// only the quote's company can read/write. Author-only edit/delete is
// enforced by matching `userId` on the note.

const createNoteSchema = z.object({ text: z.string().min(1).max(4000) }).strict();
const updateNoteSchema = z.object({ text: z.string().min(1).max(4000) }).strict();

async function assertQuoteExists(companyId: string, quoteId: string) {
  const [q] = await db
    .select({ id: quotes.id })
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.companyId, companyId)))
    .limit(1);
  if (!q) throw createError(404, "Quote not found");
}

// GET /api/quotes/:id/notes — list entity-owned quote notes + inherited
// client notes (showOnQuotes). 2026-04-18: dynamic read-time inheritance;
// merged feed sorted newest first.
router.get("/:id/notes", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const quoteId = req.params.id;
  await assertQuoteExists(companyId, quoteId);

  // 1) Entity-owned quote notes. Sort DESC (parity with jobs/invoices — was
  //    ASC previously; flipped as part of the 2026-04-18 inheritance rollout).
  const ownedRows = await db
    .select({
      id: quoteNotes.id,
      quoteId: quoteNotes.quoteId,
      noteText: quoteNotes.noteText,
      createdAt: quoteNotes.createdAt,
      updatedAt: quoteNotes.updatedAt,
      user: {
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        firstName: users.firstName,
        lastName: users.lastName,
      },
    })
    .from(quoteNotes)
    .leftJoin(users, eq(quoteNotes.userId, users.id))
    .where(and(eq(quoteNotes.quoteId, quoteId), eq(quoteNotes.companyId, companyId)))
    .orderBy(quoteNotes.createdAt);

  const owned = ownedRows.map((r) => ({
    ...r,
    userName:
      r.user?.fullName
        ?? [r.user?.firstName, r.user?.lastName].filter(Boolean).join(" ")
        ?? r.user?.email
        ?? "Unknown",
    origin: "quote" as const,
    editable: true,
  }));

  // 2) Inherited client notes — resolve quote's location + customer company.
  const [quoteScope] = await db
    .select({
      locationId: quotes.locationId,
      customerCompanyId: quotes.customerCompanyId,
    })
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.companyId, companyId)))
    .limit(1);

  let inherited: any[] = [];
  if (quoteScope?.locationId) {
    const rows = await clientNotesRepository.listInheritedForEntity(companyId, {
      locationId: quoteScope.locationId,
      customerCompanyId: quoteScope.customerCompanyId ?? null,
      surface: "quotes",
    });
    inherited = rows.map((r) => ({
      id: r.id,
      quoteId: null,
      noteText: r.noteText,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      user: null,
      userName: r.createdByName,
      attachments: r.attachments,
      origin: r.origin,
      editable: false,
    }));
  }

  const merged = [...owned, ...inherited].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  res.json(merged);
}));

// POST /api/quotes/:id/notes — create a note
router.post("/:id/notes", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const userId = req.user!.id;
  const quoteId = req.params.id;
  const { text } = validateSchema(createNoteSchema, req.body);
  await assertQuoteExists(companyId, quoteId);

  const [note] = await db
    .insert(quoteNotes)
    .values({ companyId, quoteId, userId, noteText: text.trim() })
    .returning();
  res.status(201).json(note);
}));

// PUT /api/quotes/:id/notes/:noteId — edit own note
router.put("/:id/notes/:noteId", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const userId = req.user!.id;
  const { id: quoteId, noteId } = req.params;
  const { text } = validateSchema(updateNoteSchema, req.body);

  const [existing] = await db
    .select({ id: quoteNotes.id })
    .from(quoteNotes)
    .where(and(
      eq(quoteNotes.id, noteId),
      eq(quoteNotes.quoteId, quoteId),
      eq(quoteNotes.companyId, companyId),
      eq(quoteNotes.userId, userId),
    ))
    .limit(1);
  if (!existing) throw createError(404, "Note not found");

  const [updated] = await db
    .update(quoteNotes)
    .set({ noteText: text.trim(), updatedAt: new Date() })
    .where(eq(quoteNotes.id, noteId))
    .returning();
  res.json(updated);
}));

// DELETE /api/quotes/:id/notes/:noteId — delete own note
router.delete("/:id/notes/:noteId", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const userId = req.user!.id;
  const { id: quoteId, noteId } = req.params;

  const [existing] = await db
    .select({ id: quoteNotes.id })
    .from(quoteNotes)
    .where(and(
      eq(quoteNotes.id, noteId),
      eq(quoteNotes.quoteId, quoteId),
      eq(quoteNotes.companyId, companyId),
      eq(quoteNotes.userId, userId),
    ))
    .limit(1);
  if (!existing) throw createError(404, "Note not found");

  await db.delete(quoteNotes).where(eq(quoteNotes.id, noteId));
  res.json({ success: true });
}));

// ========================================
// PDF ROUTES
// ========================================

// GET /api/quotes/:id/pdf - Download PDF
router.get("/:id/pdf", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const quoteId = req.params.id;

  // Get quote details
  const details = await quoteRepository.getQuoteDetails(companyId, quoteId);
  if (!details) {
    throw createError(404, "Quote not found");
  }

  // Get company info for branding
  const company = await storage.getCompanyById(companyId);
  if (!company) {
    throw createError(500, "Company not found");
  }

  // Location is required for PDF generation
  if (!details.location) {
    throw createError(400, "Quote has no associated location");
  }

  // Generate PDF
  const pdfBuffer = await generateQuotePdf({
    quote: details.quote,
    lines: details.lines,
    company,
    location: {
      companyName: details.location.companyName ?? "",
      address: details.location.address,
      address2: details.location.address2,
      city: details.location.city,
      provinceState: details.location.province,
      postalCode: details.location.postalCode,
      phone: details.location.phone,
      email: details.location.email,
    },
    customerCompany: details.customerCompany ? { name: details.customerCompany.name ?? "" } : null,
  });

  const filename = `Quote-${details.quote.quoteNumber || details.quote.id.slice(0, 8)}.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", pdfBuffer.length);
  res.send(pdfBuffer);
}));

// GET /api/quotes/:id/pdf/preview - Preview PDF (inline)
router.get("/:id/pdf/preview", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const quoteId = req.params.id;

  // Get quote details
  const details = await quoteRepository.getQuoteDetails(companyId, quoteId);
  if (!details) {
    throw createError(404, "Quote not found");
  }

  // Get company info for branding
  const company = await storage.getCompanyById(companyId);
  if (!company) {
    throw createError(500, "Company not found");
  }

  // Location is required for PDF generation
  if (!details.location) {
    throw createError(400, "Quote has no associated location");
  }

  // Generate PDF
  const pdfBuffer = await generateQuotePdf({
    quote: details.quote,
    lines: details.lines,
    company,
    location: {
      companyName: details.location.companyName ?? "",
      address: details.location.address,
      address2: details.location.address2,
      city: details.location.city,
      provinceState: details.location.province,
      postalCode: details.location.postalCode,
      phone: details.location.phone,
      email: details.location.email,
    },
    customerCompany: details.customerCompany ? { name: details.customerCompany.name ?? "" } : null,
  });

  const filename = `Quote-${details.quote.quoteNumber || details.quote.id.slice(0, 8)}.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.setHeader("Content-Length", pdfBuffer.length);
  res.send(pdfBuffer);
}));

// ========================================
// STATUS TRANSITION ROUTES
// ========================================

// 2026-04-12 Phase 7: canonical quote-send contract.
// `subject` / `message` from the legacy shape are still accepted and map to
// the new `subjectOverride` / `bodyOverride` for back-compat; new callers
// should use the explicit override keys.
const sendQuoteSchema = z.object({
  recipients: z.array(z.string().email()).min(1, "At least one recipient required"),
  // 2026-04-13 follow-up: explicit CC parity with invoice send.
  cc: z.array(z.string().email()).max(20).optional(),
  subjectOverride: z
    .string()
    .optional()
    .refine((v) => v === undefined || v.trim().length > 0, { message: "subjectOverride cannot be blank" }),
  bodyOverride: z
    .string()
    .optional()
    .refine((v) => v === undefined || v.trim().length > 0, { message: "bodyOverride cannot be blank" }),
  // Legacy aliases (mapped to overrides below).
  subject: z.string().max(1000).optional(),
  message: z.string().max(20000).optional(),
}).passthrough();

const renderQuoteEmailSchema = z.object({
  recipients: z.array(z.string().email()).optional(),
}).passthrough();

// POST /api/quotes/:id/render-email — preview without sending.
router.post(
  "/:id/render-email",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId!;
    const quoteId = req.params.id;
    const { recipients } = validateSchema(renderQuoteEmailSchema, req.body ?? {});
    const data = await templateDataBuilder.buildQuoteTemplateData(tenantId, quoteId);
    const rendered = await communicationTemplatesService.renderTemplateForEntity(
      tenantId, "quote", "email", data,
    );
    if (!rendered) throw createError(500, "No template or default available for quote email");
    res.json({ subject: rendered.subject, body: rendered.body, recipients: recipients ?? [] });
  }),
);

// GET /api/quotes/:id/email-recipients
router.get(
  "/:id/email-recipients",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    res.json(
      await recipientResolverService.getDefaultRecipients({
        tenantId: req.companyId!, entityType: "quote", entityId: req.params.id,
      }),
    );
  }),
);

// POST /api/quotes/:id/send — Phase 7 canonical flow:
//   1. validate, 2. dispatch email (PDF attached), 3. on success transition status.
router.post("/:id/send", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const quoteId = req.params.id;
  const validated = validateSchema(sendQuoteSchema, req.body ?? {});

  // Legacy → canonical alias mapping.
  const subjectOverride = validated.subjectOverride ?? validated.subject;
  const bodyOverride = validated.bodyOverride ?? validated.message;

  // Trim-check legacy aliases (Zod refines only cover the canonical keys).
  if (typeof subjectOverride === "string" && subjectOverride.trim().length === 0) {
    throw createError(400, "subject cannot be blank");
  }
  if (typeof bodyOverride === "string" && bodyOverride.trim().length === 0) {
    throw createError(400, "message cannot be blank");
  }

  const quote = await quoteRepository.getQuote(companyId, quoteId);
  if (!quote) throw createError(404, "Quote not found");
  if (!isQuoteDraft(quote.status)) throw createError(400, "Only draft quotes can be sent");

  // 1. Dispatch email + atomically flip quote status.
  // 2026-04-14 Phase D atomicity: the updateQuote runs inside the same
  // DB transaction as markSent via the afterMarkSent callback. Either
  // both writes commit or neither does — no more orphan state where
  // the delivery was `sent` but the quote was still `draft`.
  let updated: Awaited<ReturnType<typeof quoteRepository.updateQuote>> = null;
  const dispatch = await emailDispatchService.sendQuoteEmail({
    tenantId: companyId,
    quoteId,
    recipients: validated.recipients,
    cc: validated.cc,
    subjectOverride,
    bodyOverride,
    createdByUserId: req.user?.id ?? null,
    afterMarkSent: async (tx) => {
      updated = await quoteRepository.updateQuote(
        companyId,
        quoteId,
        { status: "sent", sentAt: new Date() },
        tx,
      );
    },
  });

  logEventAsync(getQueryCtx(req), {
    eventType: "quote.sent",
    entityType: "quote",
    entityId: quoteId,
    summary: `Quote #${(quote as any).quoteNumber ?? quoteId} sent`,
    meta: {
      quoteNumber: (quote as any).quoteNumber,
      recipients: dispatch.recipients,
      resendId: dispatch.emailId,
    },
  });

  res.json({
    quote: updated,
    dispatch: {
      emailId: dispatch.emailId,
      recipients: dispatch.recipients,
      subject: dispatch.subject,
      attachmentFilename: dispatch.attachmentFilename,
    },
  });
}));

// POST /api/quotes/:id/approve - Approve quote
router.post("/:id/approve", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const quoteId = req.params.id;

  const quoteDetails = await quoteRepository.getQuoteDetails(companyId, quoteId);
  if (!quoteDetails) {
    throw createError(404, "Quote not found");
  }

  const quote = quoteDetails.quote;

  if (!isQuoteSent(quote.status)) {
    throw createError(400, "Only sent quotes can be approved");
  }

  // Check if quote has expired
  if (isQuoteExpired(quote)) {
    throw createError(400, "This quote has expired and cannot be approved");
  }

  const updated = await quoteRepository.updateQuote(companyId, quoteId, {
    status: "approved",
    approvedAt: new Date(),
  });

  // Emit notification for quote approval
  const customerName = quoteDetails.customerCompany?.name || quoteDetails.location?.companyName || "Customer";
  notificationService.emitQuoteStatusChange({
    companyId,
    quoteId,
    quoteNumber: quote.quoteNumber || "N/A",
    customerName,
    action: "approved",
  }).catch((err) => console.error("Failed to emit quote approved notification:", err));

  res.json(updated);
}));

// POST /api/quotes/:id/decline - Decline quote
router.post("/:id/decline", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const quoteId = req.params.id;

  const quoteDetails = await quoteRepository.getQuoteDetails(companyId, quoteId);
  if (!quoteDetails) {
    throw createError(404, "Quote not found");
  }

  const quote = quoteDetails.quote;

  if (!isQuoteSent(quote.status)) {
    throw createError(400, "Only sent quotes can be declined");
  }

  // Phase 2: Cancel active assessment on decline
  if (quote.assessmentStatus === "scheduled") {
    await cancelActiveAssessmentTask(companyId, quoteId);
  }

  const updated = await quoteRepository.updateQuote(companyId, quoteId, {
    status: "declined",
    declinedAt: new Date(),
    assessmentStatus: null,
  } as any);

  // Emit notification for quote decline. Best-effort: failure is logged
  // with structured context (matches the pattern used inside
  // notificationService.ts:333,345) but never propagates — the decline
  // write already succeeded and the response should not depend on
  // notification fan-out.
  const customerName = quoteDetails.customerCompany?.name || quoteDetails.location?.companyName || "Customer";
  notificationService.emitQuoteStatusChange({
    companyId,
    quoteId,
    quoteNumber: quote.quoteNumber || "N/A",
    customerName,
    action: "declined",
  }).catch((err) => {
    console.error("[quotes.decline] emitQuoteStatusChange failed", {
      companyId,
      quoteId,
      quoteNumber: quote.quoteNumber || null,
      action: "declined",
      err,
    });
  });

  res.json(updated);
}));

// ========================================
// CONVERT TO JOB
// ========================================

const convertToJobSchema = z.object({
  jobType: z.enum(["maintenance", "repair", "inspection", "installation", "emergency"]).optional().default("maintenance"),
  scheduledDate: z.string().optional(),
  notes: z.string().max(2000).optional(),
}).strict();

// POST /api/quotes/:id/convert-to-job - Convert approved quote to job
router.post("/:id/convert-to-job", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const userId = req.user!.id;
  const quoteId = req.params.id;
  const validated = validateSchema(convertToJobSchema, req.body);

  // Get quote with details
  const quoteDetails = await quoteRepository.getQuoteDetails(companyId, quoteId);
  if (!quoteDetails) {
    throw createError(404, "Quote not found");
  }

  const { quote, lines, location } = quoteDetails;

  // Only approved quotes can be converted
  if (!isQuoteApproved(quote.status)) {
    throw createError(400, "Only approved quotes can be converted to jobs");
  }

  // Phase 2: Cancel active assessment before conversion (do not block)
  if (quote.assessmentStatus === "scheduled") {
    await cancelActiveAssessmentTask(companyId, quoteId);
  }

  // Lead attribution: resolve leadId from quote before creating job.
  // Type-safe: quote object from getQuoteDetails may not expose leadId in its TS type
  // but the DB column exists — access via index signature.
  const quoteLeadId: string | null = (quote as Record<string, unknown>).leadId as string | null ?? null;

  // 2026-04-14 note carryover: the customer-facing Quote Description
  // (`notesCustomer`, same column repurposed by Phase 1) maps onto the
  // job's customer-facing scope column (`jobs.description`) when the
  // request body doesn't already override it. Internal notes are carried
  // over via the canonical `jobNotes` system below — this keeps Quote
  // Description feeding the single semantic job field it belongs in and
  // routes free-text internal content through the note system where it
  // gets author attribution + timestamps on Job Detail.
  const carryoverDescription = validated.notes || quote.notesCustomer || null;

  // Create the job (status is "open" - scheduling is derived from scheduledStart)
  const job = await jobRepository.createJob(companyId, {
    locationId: quote.locationId,
    jobType: validated.jobType || "maintenance",
    status: "open",  // Lifecycle status; "scheduled" is derived from scheduledStart
    priority: "medium",
    scheduledStart: validated.scheduledDate || null,
    summary: `Created from Quote ${quote.quoteNumber}`,
    description: carryoverDescription,
    // Lead attribution: propagate leadId from quote to job for downstream reporting
    leadId: quoteLeadId,
  });

  // Create job parts from quote lines
  for (const line of lines) {
    await jobRepository.createJobPart(companyId, job.id, {
      companyId,
      jobId: job.id,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice || null,
      productId: line.productId || null,
      sortOrder: line.lineNumber || 0,
    });
  }

  // 2026-04-14 note carryover: internal quote notes → canonical jobNotes row.
  // Author is the converting user; createdAt is now (there are no per-entry
  // timestamps on the quote's free-text note column to preserve). Retry
  // protection is inherited from the isQuoteApproved status guard above —
  // once the quote flips to "converted" below, a second POST 400s before
  // reaching this point. Failure to create the note is non-fatal so the
  // conversion itself remains authoritative.
  const internalNoteText = quote.notesInternal?.trim();
  if (internalNoteText) {
    try {
      await jobNotesRepository.createJobNote(
        companyId,
        job.id,
        userId,
        `From Quote ${quote.quoteNumber}:\n${internalNoteText}`,
        null,
      );
    } catch (err) {
      console.error("[quotes/convert-to-job] internal note carryover failed", {
        quoteId,
        jobId: job.id,
        message: (err as any)?.message ?? String(err),
      });
    }
  }

  // Update quote status to converted + clear assessment state
  await quoteRepository.updateQuote(companyId, quoteId, {
    status: "converted",
    convertedAt: new Date(),
    convertedToJobId: job.id,
    assessmentStatus: null,
  } as any);

  // Lead attribution: if quote originated from a lead, mark lead as 'won'.
  // Explicit null guard: only update lead if quoteLeadId is a real UUID string.
  // This prevents accidental lead status corruption from unrelated quote conversions.
  if (quoteLeadId) {
    await leadRepository.updateLead(companyId, quoteLeadId, {
      status: "won",
    });
  }

  // Return job with basic info
  res.status(201).json({
    job,
    message: `Quote ${quote.quoteNumber} converted to Job #${job.jobNumber}`,
  });
}));

// ========================================
// PHASE 2: QUOTE ASSESSMENT ORCHESTRATION
// ========================================

// Helper: find active (non-completed, non-cancelled) QUOTE_ASSESSMENT task for a quote
async function findActiveAssessmentTask(companyId: string, quoteId: string) {
  const [task] = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.companyId, companyId),
        eq(tasks.quoteId, quoteId),
        eq(tasks.type, "QUOTE_ASSESSMENT"),
        notInArray(tasks.status, ["completed", "cancelled"])
      )
    )
    .limit(1);
  return task ?? null;
}

// Helper: cancel active assessment task and update quote.assessmentStatus
// This is the SINGLE orchestration point for assessment cancellation.
async function cancelActiveAssessmentTask(companyId: string, quoteId: string) {
  const activeTask = await findActiveAssessmentTask(companyId, quoteId);
  if (activeTask) {
    await db
      .update(tasks)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(tasks.id, activeTask.id), eq(tasks.companyId, companyId)));
  }
}

// Validation schema for scheduling an assessment
const scheduleAssessmentSchema = z.object({
  assignedToUserId: z.string().uuid().optional(),
  scheduledStartAt: z.string().datetime(),
  scheduledEndAt: z.string().datetime().optional(),
  estimatedDurationMinutes: z.number().int().positive().optional(),
  notes: z.string().max(2000).optional(),
}).strict();

// POST /api/quotes/:id/assessment/schedule - Schedule a quote assessment
// Creates a QUOTE_ASSESSMENT task and sets assessmentStatus='scheduled'
router.post("/:id/assessment/schedule", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const quoteId = req.params.id;

  const quote = await quoteRepository.getQuote(companyId, quoteId);
  if (!quote) throw createError(404, "Quote not found");

  // Hard guard: one active assessment per quote
  const existing = await findActiveAssessmentTask(companyId, quoteId);
  if (existing) {
    throw createError(409, "This quote already has an active assessment. Cancel it before scheduling a new one.");
  }

  const validated = validateSchema(scheduleAssessmentSchema, req.body);

  // Create the QUOTE_ASSESSMENT task via canonical task service
  const task = await taskRepository.createTask(companyId, {
    createdByUserId: req.user!.id,
    type: "QUOTE_ASSESSMENT",
    title: `Quote Assessment — ${quote.quoteNumber || "Draft"}`,
    notes: validated.notes,
    assignedToUserId: validated.assignedToUserId,
    scheduledStartAt: validated.scheduledStartAt,
    scheduledEndAt: validated.scheduledEndAt,
    estimatedDurationMinutes: validated.estimatedDurationMinutes ?? 60,
    // Link to quote's location for calendar context
    clientId: quote.locationId,
    // Phase 2: quoteId link
    quoteId,
  });

  // Update quote assessment status — orchestration ownership stays here
  await quoteRepository.updateQuote(companyId, quoteId, {
    assessmentStatus: "scheduled",
  } as any);

  res.status(201).json({ task, assessmentStatus: "scheduled" });
}));

// POST /api/quotes/:id/assessment/complete - Complete the active assessment
router.post("/:id/assessment/complete", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const quoteId = req.params.id;

  const quote = await quoteRepository.getQuote(companyId, quoteId);
  if (!quote) throw createError(404, "Quote not found");

  const activeTask = await findActiveAssessmentTask(companyId, quoteId);
  if (!activeTask) {
    throw createError(404, "No active assessment found for this quote");
  }

  // Complete the task via canonical task service
  await taskRepository.closeTask(companyId, activeTask.id, req.user!.id);

  // Update quote assessment status — orchestration ownership stays here
  await quoteRepository.updateQuote(companyId, quoteId, {
    assessmentStatus: "completed",
  } as any);

  res.json({ assessmentStatus: "completed" });
}));

// DELETE /api/quotes/:id/assessment - Cancel the active assessment
router.delete("/:id/assessment", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const quoteId = req.params.id;

  const quote = await quoteRepository.getQuote(companyId, quoteId);
  if (!quote) throw createError(404, "Quote not found");

  await cancelActiveAssessmentTask(companyId, quoteId);

  // Set back to 'required' — assessment is still needed, just not scheduled
  await quoteRepository.updateQuote(companyId, quoteId, {
    assessmentStatus: "required",
  } as any);

  res.json({ assessmentStatus: "required" });
}));

export default router;
