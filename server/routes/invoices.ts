import { Router, Response } from "express";
import { storage } from "../storage/index";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { parsePagination } from "../utils/pagination";
import { paginated } from "../utils/paginatedResponse";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import { assertInvoiceStatusTransition } from "../statusRules";
import type { InvoiceStatus } from "@shared/schema";

const router = Router();

// ========================================
// VALIDATION SCHEMAS
// ========================================

const createInvoiceLineSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().default("1"),
  unitPrice: z.number().min(0).max(999999.99),
  lineSubtotal: z.number().min(0).max(999999.99),
  taxRate: z.number().min(0).max(1).optional().default(0),
  taxAmount: z.number().min(0).max(999999.99).optional().default(0),
  lineTotal: z.number().min(0).max(999999.99),
  lineNumber: z.number().int().positive().optional(),
  source: z.enum(["manual", "job"]).optional().default("manual"),
}).strict();

const createInvoiceFromJobSchema = z.object({
  markJobCompleted: z.boolean().optional().default(false),
}).strict();

const updateInvoiceSchema = z.object({
  // Status changes should use dedicated endpoints (send, void) - this allows notes-only updates
  status: z.enum(["draft", "sent", "partial_paid", "paid", "voided"]).optional(),
  issueDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().optional(),
  notesInternal: z.string().max(2000).optional(),
  notesCustomer: z.string().max(2000).optional(),
  workDescription: z.string().max(2000).optional(),
  clientMessage: z.string().max(2000).optional(),
  showQuantity: z.boolean().optional(),
  showUnitPrice: z.boolean().optional(),
  showLineTotals: z.boolean().optional(),
  showLineItems: z.boolean().optional(),
  showBalance: z.boolean().optional(),
  amountPaid: z.number().min(0).max(999999.99).optional(),
  version: z.number().int().nonnegative().optional(),
}).strict();

// ========================================
// MIDDLEWARE
// ========================================

/**
 * Middleware: Invoice must be in draft status for full editing
 * Use for: adding/removing lines, refresh from job, general edits
 */
function requireDraftStatus() {
  return asyncHandler(async (req: AuthedRequest, res: Response, next: any) => {
    const invoice = await storage.getInvoice(req.companyId!, req.params.id);

    if (!invoice) {
      throw createError(404, "Invoice not found");
    }

    if (invoice.status !== "draft") {
      throw createError(409, "Invoice cannot be edited after sending. Only notes can be updated.");
    }

    next();
  });
}

/**
 * Middleware: Invoice must exist and not be in terminal state
 * Use for: notes-only updates on sent invoices
 */
function requireInvoiceEditable() {
  return asyncHandler(async (req: AuthedRequest, res: Response, next: any) => {
    const invoice = await storage.getInvoice(req.companyId!, req.params.id);

    if (!invoice) {
      throw createError(404, "Invoice not found");
    }

    const terminalStates = ["paid", "voided"];
    if (terminalStates.includes(invoice.status)) {
      throw createError(409, `Invoice is ${invoice.status} and cannot be modified`);
    }

    next();
  });
}

/**
 * Validate that invoice has required fields for sending
 */
function validateSendRequirements(invoice: any): string[] {
  const errors: string[] = [];
  if (!invoice.invoiceNumber) {
    errors.push("Invoice number is required");
  }
  if (!invoice.locationId) {
    errors.push("Location is required");
  }
  // customerCompanyId is optional - invoice can be billed to location directly
  return errors;
}

// ========================================
// ROUTES
// ========================================

// GET /api/invoices/list - List all invoices with pagination
router.get("/list", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const pagination = parsePagination(req.query);
  const result = await storage.getInvoices(req.companyId!, pagination);

  res.json(paginated(result.items, result.meta));
}));

// GET /api/invoices/stats - Get invoice statistics
router.get("/stats", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rows = await storage.getInvoiceStats(req.companyId!);
  res.json(rows);
}));

// GET /api/invoices/:id - Get single invoice
router.get("/:id", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const invoice = await storage.getInvoice(req.companyId!, req.params.id);
  if (!invoice) throw createError(404, "Invoice not found");

  res.json(invoice);
}));

// GET /api/invoices/:id/details - Get full invoice details (composite endpoint)
router.get("/:id/details", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const invoiceId = req.params.id;

  // 1. Get the invoice with basic client data
  const invoice = await storage.getInvoice(companyId, invoiceId);
  if (!invoice) {
    throw createError(404, "Invoice not found");
  }

  // 2. Get invoice lines
  const lines = await storage.getInvoiceLines(companyId, invoiceId);

  // 3. Get the client location (via invoice.locationId)
  const location = await storage.getClient(companyId, invoice.locationId);
  if (!location) {
    throw createError(400, "Invoice has invalid location reference");
  }

  // 4. Get the customer company (via location.parentCompanyId or invoice.customerCompanyId)
  let customerCompany = null;
  const customerCompanyId = invoice.customerCompanyId || location.parentCompanyId;
  if (customerCompanyId) {
    customerCompany = await storage.getCustomerCompany(companyId, customerCompanyId);
  }

  // 5. Get the job (if invoice.jobId exists)
  let job = null;
  if (invoice.jobId) {
    job = await storage.getJob(companyId, invoice.jobId);
  }

  res.json({
    invoice,
    lines,
    location,
    customerCompany,
    job,
  });
}));

// GET /api/invoices/:id/lines - Get invoice lines
router.get("/:id/lines", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const lines = await storage.getInvoiceLines(req.companyId!, req.params.id);
  res.json(lines);
}));

// POST /api/invoices/:id/lines - Add line to invoice (draft only)
router.post("/:id/lines", requireRole(MANAGER_ROLES), requireDraftStatus(), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const validated = validateSchema(createInvoiceLineSchema, req.body);
  const created = await storage.createInvoiceLine(req.companyId!, req.params.id, validated);

  res.json(created);
}));

// DELETE /api/invoices/:id/lines/:lineId - Remove line from invoice (draft only)
router.delete("/:id/lines/:lineId", requireRole(MANAGER_ROLES), requireDraftStatus(), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const result = await storage.deleteInvoiceLine(req.companyId!, req.params.id, req.params.lineId);
  res.json(result);
}));

// POST /api/invoices/:id/refresh-from-job - Refresh invoice lines from job (draft only)
router.post("/:id/refresh-from-job", requireRole(MANAGER_ROLES), requireDraftStatus(), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const result = await storage.refreshInvoiceFromJob(req.companyId!, req.params.id);
  res.json(result);
}));

// POST /api/invoices/from-job/:jobId - Create invoice from job
router.post("/from-job/:jobId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const validated = validateSchema(createInvoiceFromJobSchema, req.body);

  try {
    const invoice = await storage.createInvoiceFromJob(
      req.companyId!,
      req.params.jobId,
      { markJobCompleted: validated.markJobCompleted }
    );

    // Refresh invoice lines from job parts
    await storage.refreshInvoiceFromJob(req.companyId!, invoice.id);

    res.json(invoice);
  } catch (error: any) {
    if (error.message?.includes("not found")) {
      throw createError(404, error.message);
    }
    if (error.message?.includes("already has an invoice")) {
      throw createError(400, error.message);
    }
    throw error;
  }
}));

// PATCH /api/invoices/:id - Update invoice with optimistic locking
// Draft invoices: all fields editable
// Sent/partial_paid invoices: only notes fields editable
// Paid/voided invoices: blocked by middleware
router.patch("/:id", requireRole(MANAGER_ROLES), requireInvoiceEditable(), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const invoice = await storage.getInvoice(req.companyId!, req.params.id);
  if (!invoice) {
    throw createError(404, "Invoice not found");
  }

  const validated = validateSchema(updateInvoiceSchema, req.body);
  const { version, ...patch } = validated;

  // If invoice is not draft, only allow notes updates
  if (invoice.status !== "draft") {
    const allowedFields = ["notesInternal", "notesCustomer", "clientMessage", "version"];
    const attemptedFields = Object.keys(patch);
    const disallowedFields = attemptedFields.filter(f => !allowedFields.includes(f));

    if (disallowedFields.length > 0) {
      throw createError(409, `Invoice is ${invoice.status}. Only notes can be updated. Cannot change: ${disallowedFields.join(", ")}`);
    }
  }

  try {
    // Version is optional for backward compatibility
    const updated = await storage.updateInvoice(
      req.companyId!,
      req.params.id,
      version, // Can be undefined
      patch
    );

    if (!updated) {
      throw createError(404, "Invoice not found");
    }

    res.json(updated);
  } catch (error: any) {
    // Check for version mismatch error
    if (error.message?.includes('modified by another user')) {
      return res.status(409).json({
        error: error.message,
        code: 'VERSION_MISMATCH'
      });
    }
    throw error;
  }
}));

// ========================================
// STATUS TRANSITION ENDPOINTS
// ========================================

// POST /api/invoices/:id/send - Send invoice (draft -> sent)
router.post("/:id/send", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const invoice = await storage.getInvoice(req.companyId!, req.params.id);
  if (!invoice) {
    throw createError(404, "Invoice not found");
  }

  // Validate transition
  try {
    assertInvoiceStatusTransition(invoice.status as InvoiceStatus, "sent");
  } catch (error: any) {
    throw createError(400, error.message);
  }

  // Validate send requirements
  const errors = validateSendRequirements(invoice);
  if (errors.length > 0) {
    throw createError(400, `Cannot send invoice: ${errors.join(", ")}`);
  }

  const updated = await storage.updateInvoice(
    req.companyId!,
    req.params.id,
    undefined,
    { status: "sent", sentAt: new Date() }
  );

  res.json(updated);
}));

// POST /api/invoices/:id/void - Void invoice
router.post("/:id/void", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const invoice = await storage.getInvoice(req.companyId!, req.params.id);
  if (!invoice) {
    throw createError(404, "Invoice not found");
  }

  // Validate transition (can void from draft, sent, or partial_paid)
  try {
    assertInvoiceStatusTransition(invoice.status as InvoiceStatus, "voided");
  } catch (error: any) {
    throw createError(400, error.message);
  }

  const updated = await storage.updateInvoice(
    req.companyId!,
    req.params.id,
    undefined,
    { status: "voided" }
  );

  res.json(updated);
}));

// DELETE /api/invoices/:id - Delete invoice (draft only)
router.delete("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const invoice = await storage.getInvoice(req.companyId!, req.params.id);
  if (!invoice) {
    throw createError(404, "Invoice not found");
  }

  if (invoice.status !== "draft") {
    throw createError(409, "Only draft invoices can be deleted. Void the invoice instead.");
  }

  // Soft delete via isActive flag
  await storage.updateInvoice(
    req.companyId!,
    req.params.id,
    undefined,
    { isActive: false, deletedAt: new Date() }
  );

  res.json({ success: true });
}));

export default router;
