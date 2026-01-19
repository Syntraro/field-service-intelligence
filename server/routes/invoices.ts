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
import {
  isBillingLocked,
  isQboSynced,
  checkQboBillingLock,
  checkQboLineItemLock,
  requireQboOverrideReason,
  buildOutOfSyncUpdate,
  logQboLockOverride,
  getQboLockInfo,
  isBillingImpactingPatch,
} from "../utils/qboInvoiceLock";

const router = Router();

// ========================================
// VALIDATION SCHEMAS
// ========================================

// Phase 10A: QBO override options schema (reusable)
const qboOverrideSchema = z.object({
  overrideQboLock: z.boolean().optional(),
  overrideReason: z.string().min(10).max(500).optional(),
}).strict();

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
  // QBO override options
  overrideQboLock: z.boolean().optional(),
  overrideReason: z.string().min(10).max(500).optional(),
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
  // Phase 11: Discount fields
  discountType: z.enum(["PERCENT", "AMOUNT"]).nullable().optional(),
  discountPercent: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).nullable().optional(), // 0-100 with 2 decimal places
  discountAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(), // Currency amount
  discountNotes: z.string().max(500).nullable().optional(),
  // Phase 10A: QBO override options
  overrideQboLock: z.boolean().optional(),
  overrideReason: z.string().min(10).max(500).optional(),
}).strict();

// ========================================
// MIDDLEWARE
// ========================================

/**
 * Middleware: Invoice must be in an editable status (not paid/voided)
 * Phase 11: Removed hard-lock on "sent" status - billing edits are now allowed with warning
 * Use for: adding/removing lines, refresh from job, billing edits
 *
 * Real locks that remain:
 * - QBO-synced invoices require override + reason (handled by checkQboBillingLock)
 * - Paid/voided invoices are truly terminal
 */
function requireEditableStatus() {
  return asyncHandler(async (req: AuthedRequest, res: Response, next: any) => {
    const invoice = await storage.getInvoice(req.companyId!, req.params.id);

    if (!invoice) {
      throw createError(404, "Invoice not found");
    }

    const terminalStates = ["paid", "voided"];
    if (terminalStates.includes(invoice.status)) {
      throw createError(409, `Invoice is ${invoice.status} and cannot be modified`);
    }

    // Attach invoice to request for downstream use (avoids re-fetch)
    (req as any).invoice = invoice;
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

// GET /api/invoices/by-job/:jobId - Get invoice for a specific job (if exists)
// Phase 11: Fix job/invoice cross-linking
router.get("/by-job/:jobId", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const invoice = await storage.getInvoiceByJobId(req.companyId!, req.params.jobId);

  if (!invoice) {
    // Return null instead of 404 - it's valid for a job to not have an invoice
    res.json(null);
    return;
  }

  res.json(invoice);
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

// POST /api/invoices/:id/lines - Add line to invoice (draft only, with QBO lock check)
router.post("/:id/lines", requireRole(MANAGER_ROLES), requireEditableStatus(), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const validated = validateSchema(createInvoiceLineSchema, req.body);
  const { overrideQboLock, overrideReason, ...lineData } = validated;

  // Phase 10A: Check QBO billing lock
  const invoice = await storage.getInvoice(req.companyId!, req.params.id);
  if (!invoice) throw createError(404, "Invoice not found");

  // Validate override if provided
  if (overrideQboLock) {
    requireQboOverrideReason(overrideQboLock, overrideReason);
  }

  // Check lock (throws 409 if locked without override)
  checkQboLineItemLock(invoice, 'add', { overrideQboLock, overrideReason });

  // Create the line item
  const created = await storage.createInvoiceLine(req.companyId!, req.params.id, lineData);

  // If this was a QBO-synced invoice with override, mark as out-of-sync
  let warning: string | undefined;
  if (isQboSynced(invoice) && overrideQboLock && overrideReason) {
    const outOfSyncUpdate = buildOutOfSyncUpdate(overrideReason, req.user?.id);
    await storage.updateInvoice(req.companyId!, req.params.id, undefined, outOfSyncUpdate);
    logQboLockOverride(req.companyId!, req.params.id, req.user?.id ?? 'unknown', 'add_line', overrideReason, invoice.qboInvoiceId);
    warning = "Invoice is now out of sync with QuickBooks. Manual reconciliation required.";
  }

  res.json({ ...created, _qboWarning: warning });
}));

// DELETE /api/invoices/:id/lines/:lineId - Remove line from invoice (draft only, with QBO lock check)
router.delete("/:id/lines/:lineId", requireRole(MANAGER_ROLES), requireEditableStatus(), asyncHandler(async (req: AuthedRequest, res: Response) => {
  // Parse QBO override from query params (DELETE requests can't have body)
  const overrideQboLock = req.query.overrideQboLock === 'true';
  const overrideReason = typeof req.query.overrideReason === 'string' ? req.query.overrideReason : undefined;

  // Phase 10A: Check QBO billing lock
  const invoice = await storage.getInvoice(req.companyId!, req.params.id);
  if (!invoice) throw createError(404, "Invoice not found");

  // Validate override if provided
  if (overrideQboLock) {
    requireQboOverrideReason(overrideQboLock, overrideReason);
  }

  // Check lock (throws 409 if locked without override)
  checkQboLineItemLock(invoice, 'delete', { overrideQboLock, overrideReason });

  // Delete the line item
  const result = await storage.deleteInvoiceLine(req.companyId!, req.params.id, req.params.lineId);

  // If this was a QBO-synced invoice with override, mark as out-of-sync
  let warning: string | undefined;
  if (isQboSynced(invoice) && overrideQboLock && overrideReason) {
    const outOfSyncUpdate = buildOutOfSyncUpdate(overrideReason, req.user?.id);
    await storage.updateInvoice(req.companyId!, req.params.id, undefined, outOfSyncUpdate);
    logQboLockOverride(req.companyId!, req.params.id, req.user?.id ?? 'unknown', 'delete_line', overrideReason, invoice.qboInvoiceId);
    warning = "Invoice is now out of sync with QuickBooks. Manual reconciliation required.";
  }

  res.json({ ...result, _qboWarning: warning });
}));

// POST /api/invoices/:id/refresh-from-job - Refresh invoice lines from job (draft only, with QBO lock check)
router.post("/:id/refresh-from-job", requireRole(MANAGER_ROLES), requireEditableStatus(), asyncHandler(async (req: AuthedRequest, res: Response) => {
  // Parse QBO override from body
  const overrideQboLock = req.body?.overrideQboLock === true;
  const overrideReason = typeof req.body?.overrideReason === 'string' ? req.body.overrideReason : undefined;

  // Phase 10A: Check QBO billing lock
  const invoice = await storage.getInvoice(req.companyId!, req.params.id);
  if (!invoice) throw createError(404, "Invoice not found");

  // Validate override if provided
  if (overrideQboLock) {
    requireQboOverrideReason(overrideQboLock, overrideReason);
  }

  // Check lock (throws 409 if locked without override)
  checkQboLineItemLock(invoice, 'refresh', { overrideQboLock, overrideReason });

  // Refresh the invoice from job
  const result = await storage.refreshInvoiceFromJob(req.companyId!, req.params.id);

  // If this was a QBO-synced invoice with override, mark as out-of-sync
  let warning: string | undefined;
  if (isQboSynced(invoice) && overrideQboLock && overrideReason) {
    const outOfSyncUpdate = buildOutOfSyncUpdate(overrideReason, req.user?.id);
    await storage.updateInvoice(req.companyId!, req.params.id, undefined, outOfSyncUpdate);
    logQboLockOverride(req.companyId!, req.params.id, req.user?.id ?? 'unknown', 'refresh_from_job', overrideReason, invoice.qboInvoiceId);
    warning = "Invoice is now out of sync with QuickBooks. Manual reconciliation required.";
  }

  res.json({ ...result, _qboWarning: warning });
}));

/**
 * POST /api/invoices/from-job/:jobId - Create invoice from job (idempotent)
 *
 * PHASE A.1: This route uses createInvoiceFromJob() which provides:
 * - SELECT FOR UPDATE locking to prevent race conditions
 * - Idempotency guarantees (calling twice returns same invoice)
 * - Atomic invoice number assignment
 */
router.post("/from-job/:jobId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const validated = validateSchema(createInvoiceFromJobSchema, req.body);

  try {
    // PHASE A.1: Pass creation source to satisfy invoice creation guard
    const result = await storage.createInvoiceFromJob(
      req.companyId!,
      req.params.jobId,
      { markJobCompleted: validated.markJobCompleted },
      "INVOICE_ROUTE"
    );

    // Only refresh invoice lines if newly created (skip for idempotent return)
    if (result.created) {
      await storage.refreshInvoiceFromJob(req.companyId!, result.invoice.id);
    }

    // Include created flag to inform caller if this was new or existing
    res.json({ ...result.invoice, _created: result.created });
  } catch (error: any) {
    if (error.message?.includes("not found")) {
      throw createError(404, error.message);
    }
    throw error;
  }
}));

// PATCH /api/invoices/:id - Update invoice with optimistic locking
// Phase 11: Sent invoices can now have billing edited (with warning)
// Paid/voided invoices: blocked by middleware
// Phase 10A: QBO-synced invoices require override for billing-impacting changes
router.patch("/:id", requireRole(MANAGER_ROLES), requireInvoiceEditable(), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const invoice = await storage.getInvoice(req.companyId!, req.params.id);
  if (!invoice) {
    throw createError(404, "Invoice not found");
  }

  const validated = validateSchema(updateInvoiceSchema, req.body);
  const { version, overrideQboLock, overrideReason, ...patch } = validated;

  // Phase 11: Track if editing a sent invoice (for warning in response)
  const isSentInvoice = invoice.status === "sent" || invoice.status === "partial_paid";
  const hasBillingChanges = isBillingImpactingPatch(patch);

  if (hasBillingChanges) {
    // Validate override if provided
    if (overrideQboLock) {
      requireQboOverrideReason(overrideQboLock, overrideReason);
    }

    // Check lock (throws 409 if locked without override)
    checkQboBillingLock(invoice, patch, { overrideQboLock, overrideReason });
  }

  try {
    // If overriding a QBO-synced invoice, merge out-of-sync flags into the update
    let finalPatch = { ...patch };
    let warning: string | undefined;

    if (hasBillingChanges && isQboSynced(invoice) && overrideQboLock && overrideReason) {
      const outOfSyncUpdate = buildOutOfSyncUpdate(overrideReason, req.user?.id);
      finalPatch = { ...finalPatch, ...outOfSyncUpdate };
      logQboLockOverride(req.companyId!, req.params.id, req.user?.id ?? 'unknown', 'update_invoice', overrideReason, invoice.qboInvoiceId);
      warning = "Invoice is now out of sync with QuickBooks. Manual reconciliation required.";
    }

    // Version is optional for backward compatibility
    const updated = await storage.updateInvoice(
      req.companyId!,
      req.params.id,
      version, // Can be undefined
      finalPatch
    );

    if (!updated) {
      throw createError(404, "Invoice not found");
    }

    // Include QBO lock info and warnings in response
    const response: Record<string, unknown> = { ...updated };
    if (warning) {
      response._qboWarning = warning;
    }
    // Phase 11: Warn about editing sent invoice (not a hard error)
    if (isSentInvoice && hasBillingChanges) {
      response._sentInvoiceWarning = "This invoice has been sent to the client. You should re-send an updated invoice.";
    }
    response._qboLockInfo = getQboLockInfo(updated);

    res.json(response);
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
// Phase 10A: Status changes on QBO-synced invoices require override
router.post("/:id/send", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const invoice = await storage.getInvoice(req.companyId!, req.params.id);
  if (!invoice) {
    throw createError(404, "Invoice not found");
  }

  // Parse QBO override from body
  const overrideQboLock = req.body?.overrideQboLock === true;
  const overrideReason = typeof req.body?.overrideReason === 'string' ? req.body.overrideReason : undefined;

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

  // Phase 10A: Check QBO billing lock (status change is billing-impacting)
  if (overrideQboLock) {
    requireQboOverrideReason(overrideQboLock, overrideReason);
  }
  checkQboBillingLock(invoice, { status: 'sent' }, { overrideQboLock, overrideReason });

  // Build update payload
  let updatePayload: Record<string, unknown> = { status: "sent", sentAt: new Date() };
  let warning: string | undefined;

  if (isQboSynced(invoice) && overrideQboLock && overrideReason) {
    const outOfSyncUpdate = buildOutOfSyncUpdate(overrideReason, req.user?.id);
    updatePayload = { ...updatePayload, ...outOfSyncUpdate };
    logQboLockOverride(req.companyId!, req.params.id, req.user?.id ?? 'unknown', 'send_invoice', overrideReason, invoice.qboInvoiceId);
    warning = "Invoice is now out of sync with QuickBooks. Manual reconciliation required.";
  }

  const updated = await storage.updateInvoice(
    req.companyId!,
    req.params.id,
    undefined,
    updatePayload
  );

  const response: Record<string, unknown> = { ...updated };
  if (warning) {
    response._qboWarning = warning;
  }
  res.json(response);
}));

// POST /api/invoices/:id/void - Void invoice
// Phase 10A: Status changes on QBO-synced invoices require override
router.post("/:id/void", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const invoice = await storage.getInvoice(req.companyId!, req.params.id);
  if (!invoice) {
    throw createError(404, "Invoice not found");
  }

  // Parse QBO override from body
  const overrideQboLock = req.body?.overrideQboLock === true;
  const overrideReason = typeof req.body?.overrideReason === 'string' ? req.body.overrideReason : undefined;

  // Validate transition (can void from draft, sent, or partial_paid)
  try {
    assertInvoiceStatusTransition(invoice.status as InvoiceStatus, "voided");
  } catch (error: any) {
    throw createError(400, error.message);
  }

  // Phase 10A: Check QBO billing lock (voiding is billing-impacting)
  if (overrideQboLock) {
    requireQboOverrideReason(overrideQboLock, overrideReason);
  }
  checkQboBillingLock(invoice, { status: 'voided' }, { overrideQboLock, overrideReason });

  // Build update payload
  let updatePayload: Record<string, unknown> = { status: "voided" };
  let warning: string | undefined;

  if (isQboSynced(invoice) && overrideQboLock && overrideReason) {
    const outOfSyncUpdate = buildOutOfSyncUpdate(overrideReason, req.user?.id);
    updatePayload = { ...updatePayload, ...outOfSyncUpdate };
    logQboLockOverride(req.companyId!, req.params.id, req.user?.id ?? 'unknown', 'void_invoice', overrideReason, invoice.qboInvoiceId);
    warning = "Invoice is now out of sync with QuickBooks. Manual reconciliation required.";
  }

  const updated = await storage.updateInvoice(
    req.companyId!,
    req.params.id,
    undefined,
    updatePayload
  );

  const response: Record<string, unknown> = { ...updated };
  if (warning) {
    response._qboWarning = warning;
  }
  res.json(response);
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
