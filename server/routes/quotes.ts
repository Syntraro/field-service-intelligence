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
import { storage } from "../storage";
import { generateQuotePdf } from "../services/quotePdfService";
import type { QuoteStatus } from "@shared/schema";

const router = Router();

// Feature gate: require quotesEnabled for all quotes routes
router.use(requireFeature("quotesEnabled"));

// ========================================
// VALIDATION SCHEMAS
// ========================================

const createQuoteSchema = z.object({
  locationId: z.string().min(1),
  customerCompanyId: z.string().nullable().optional(),
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
}).strict();

const createQuoteLineSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().default("1"),
  unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().default("0.00"),
  lineSubtotal: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().default("0.00"),
  taxRate: z.string().regex(/^\d+(\.\d{1,4})?$/).optional().default("0.0000"),
  taxAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().default("0.00"),
  lineTotal: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().default("0.00"),
  lineItemType: z.enum(["service", "material", "fee", "discount"]).optional().default("service"),
  productId: z.string().nullable().optional(),
}).strict();

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

  // Get customer company from location if not provided
  const customerCompanyId = validated.customerCompanyId ?? location.parentCompanyId;

  const { lines = [], ...quoteData } = validated;

  const quote = await quoteRepository.createQuote(
    companyId,
    {
      ...quoteData,
      customerCompanyId,
      status: "draft" as const,
    },
    lines.map((line, index) => ({
      ...line,
      lineNumber: index + 1,
    }))
  );

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
  if (existing.status !== "draft") {
    throw createError(409, "Only draft quotes can be edited");
  }

  const validated = validateSchema(updateQuoteSchema, req.body);
  const updated = await quoteRepository.updateQuote(companyId, quoteId, validated);

  if (!updated) {
    throw createError(404, "Quote not found");
  }

  res.json(updated);
}));

// DELETE /api/quotes/:id - Delete a quote (draft only)
router.delete("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const quoteId = req.params.id;

  const quote = await quoteRepository.getQuote(companyId, quoteId);
  if (!quote) {
    throw createError(404, "Quote not found");
  }

  // Only allow deleting draft quotes
  if (quote.status !== "draft") {
    throw createError(409, "Only draft quotes can be deleted");
  }

  await quoteRepository.deleteQuote(companyId, quoteId);
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
  if (quote.status !== "draft") {
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
  if (quote.status !== "draft") {
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
  if (quote.status !== "draft") {
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
      companyName: details.location.companyName,
      address: details.location.address,
      city: details.location.city,
      provinceState: details.location.province,
      postalCode: details.location.postalCode,
      phone: details.location.phone,
      email: details.location.email,
    },
    customerCompany: details.customerCompany,
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
      companyName: details.location.companyName,
      address: details.location.address,
      city: details.location.city,
      provinceState: details.location.province,
      postalCode: details.location.postalCode,
      phone: details.location.phone,
      email: details.location.email,
    },
    customerCompany: details.customerCompany,
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

const sendQuoteSchema = z.object({
  recipients: z.array(z.string().email()).min(1).max(10).optional(),
  subject: z.string().max(200).optional(),
  message: z.string().max(2000).optional(),
}).strict();

// POST /api/quotes/:id/send - Send quote (draft -> sent)
router.post("/:id/send", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const quoteId = req.params.id;
  const validated = validateSchema(sendQuoteSchema, req.body);

  const quote = await quoteRepository.getQuote(companyId, quoteId);
  if (!quote) {
    throw createError(404, "Quote not found");
  }

  if (quote.status !== "draft") {
    throw createError(400, "Only draft quotes can be sent");
  }

  // Update quote status to sent
  const updated = await quoteRepository.updateQuote(companyId, quoteId, {
    status: "sent",
    sentAt: new Date(),
  });

  // TODO: If recipients provided, send email with PDF attachment
  // For now, we just record the metadata
  const sendInfo = {
    recipients: validated.recipients,
    subject: validated.subject,
    message: validated.message,
    sentBy: req.user?.id,
  };

  res.json({ quote: updated, sendInfo });
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

  if (quote.status !== "sent") {
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

  if (quote.status !== "sent") {
    throw createError(400, "Only sent quotes can be declined");
  }

  const updated = await quoteRepository.updateQuote(companyId, quoteId, {
    status: "declined",
    declinedAt: new Date(),
  });

  // Emit notification for quote decline
  const customerName = quoteDetails.customerCompany?.name || quoteDetails.location?.companyName || "Customer";
  notificationService.emitQuoteStatusChange({
    companyId,
    quoteId,
    quoteNumber: quote.quoteNumber || "N/A",
    customerName,
    action: "declined",
  }).catch((err) => console.error("Failed to emit quote declined notification:", err));

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
  const quoteId = req.params.id;
  const validated = validateSchema(convertToJobSchema, req.body);

  // Get quote with details
  const quoteDetails = await quoteRepository.getQuoteDetails(companyId, quoteId);
  if (!quoteDetails) {
    throw createError(404, "Quote not found");
  }

  const { quote, lines, location } = quoteDetails;

  // Only approved quotes can be converted
  if (quote.status !== "approved") {
    throw createError(400, "Only approved quotes can be converted to jobs");
  }

  // Create the job (status is "open" - scheduling is derived from scheduledStart)
  const job = await jobRepository.createJob(companyId, {
    locationId: quote.locationId,
    jobType: validated.jobType || "maintenance",
    status: "open",  // Lifecycle status; "scheduled" is derived from scheduledStart
    priority: "medium",
    scheduledStart: validated.scheduledDate || null,
    summary: `Created from Quote ${quote.quoteNumber}`,
    description: validated.notes || null,
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

  // Update quote status to converted
  await quoteRepository.updateQuote(companyId, quoteId, {
    status: "converted",
    convertedAt: new Date(),
    convertedToJobId: job.id,
  });

  // Return job with basic info
  res.status(201).json({
    job,
    message: `Quote ${quote.quoteNumber} converted to Job #${job.jobNumber}`,
  });
}));

export default router;
