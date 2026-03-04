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
import { taxRepository } from "../storage/tax";
import { invoiceTaxLines } from "@shared/schema";
import { db as invoiceDb } from "../db";
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
import { generateInvoicePdf } from "../services/invoicePdfService";
// Phase 1 Architecture: Event Log
import { logEventAsync } from "../lib/events";
// Phase 5 Step A4: canonical invoice feed builders
import { getQueryCtx } from "../lib/queryCtx";
import { getInvoicesFeed, getInvoiceStats as getCanonicalInvoiceStats } from "../storage/invoicesFeed";

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
  dueDate: z.string().optional().nullable(), // Accepts date string or null (for custom terms)
  // Payment terms - when changed, dueDate is recalculated; null = custom terms
  paymentTermsDays: z.number().int().min(0).max(365).optional().nullable(),
  // Invoice number editing (uniqueness enforced per tenant)
  invoiceNumber: z.string().min(1).max(100).optional(),
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

// Phase 5 Step A4: GET /api/invoices/list — canonical invoice feed
router.get("/list", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const ctx = getQueryCtx(req);
  const pagination = parsePagination(req.query);
  const { items } = await getInvoicesFeed(ctx, {
    limit: pagination.limit,
    offset: pagination.offset ?? 0,
  });
  // Preserve existing response shape for backward compatibility
  res.json(paginated(items, { limit: pagination.limit, hasMore: items.length >= pagination.limit }));
}));

// Phase 5 Step A4: GET /api/invoices/stats — canonical stats
router.get("/stats", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const ctx = getQueryCtx(req);
  const stats = await getCanonicalInvoiceStats(ctx);
  // Return byStatus array for backward compatibility with existing consumers
  res.json(stats.byStatus);
}));

// Phase 5 Step A4: GET /api/invoices/dashboard — canonical feed with dashboard preset
router.get("/dashboard", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const ctx = getQueryCtx(req);
  const { items } = await getInvoicesFeed(ctx, {
    statuses: ["awaiting_payment", "sent", "partial_paid"],
    unpaidOnly: true,
    limit: 20,
    sortBy: "dueDate",
    sortOrder: "asc",
  });
  // Sort: past due first, then awaiting payment (matching old behavior)
  const pastDue = items.filter(i => i.isPastDue);
  const notPastDue = items.filter(i => !i.isPastDue);
  const combined = [...pastDue, ...notPastDue].slice(0, 10);
  res.json({ data: combined });
}));

// Phase 5 Step A4: GET /api/invoices/by-job/:jobId — canonical feed with jobId filter
router.get("/by-job/:jobId", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const ctx = getQueryCtx(req);
  const { items } = await getInvoicesFeed(ctx, { jobId: req.params.jobId, limit: 1 });

  if (items.length === 0) {
    // Return null instead of 404 — it's valid for a job to not have an invoice
    res.json(null);
    return;
  }

  res.json(items[0]);
}));

// GET /api/invoices/:id - Get single invoice
router.get("/:id", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const invoice = await storage.getInvoice(req.companyId!, req.params.id);
  if (!invoice) {
    // Diagnostic log for debugging 404s (no PII, just IDs)
    console.warn(
      `[invoices/:id] 404 Not Found - companyId=${req.companyId}, invoiceId=${req.params.id}`
    );
    throw createError(404, "Invoice not found");
  }

  res.json(invoice);
}));

// GET /api/invoices/:id/details - Get full invoice details (composite endpoint)
router.get("/:id/details", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const invoiceId = req.params.id;

  // 1. Get the invoice with basic client data
  const invoice = await storage.getInvoice(companyId, invoiceId);
  if (!invoice) {
    // Diagnostic log for debugging 404s (no PII, just IDs)
    console.warn(
      `[invoices/:id/details] 404 Not Found - companyId=${companyId}, invoiceId=${invoiceId}`
    );
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

  // 6. Build structured address + contact fields for Jobber-style header
  // Billing address: prefer customerCompany billing address, fall back to location
  const billingAddress = customerCompany?.billingStreet
    ? {
        street: customerCompany.billingStreet,
        city: customerCompany.billingCity || "",
        province: customerCompany.billingProvince || "",
        postalCode: customerCompany.billingPostalCode || "",
        country: customerCompany.billingCountry || "",
      }
    : location.address
      ? {
          street: location.address,
          city: location.city || "",
          province: location.province || "",
          postalCode: location.postalCode || "",
          country: "",
        }
      : null;

  // Service address: prefer job's location address; fallback to invoice location
  const serviceAddress = location.address
    ? {
        street: location.address,
        city: location.city || "",
        province: location.province || "",
        postalCode: location.postalCode || "",
        locationName: location.location || "",
      }
    : null;

  // Primary contact from the service location
  const primaryContact = {
    name: location.contactName || "",
    email: location.email || "",
    phone: location.phone || "",
  };

  res.json({
    invoice,
    lines,
    location,
    customerCompany,
    job,
    billingAddress,
    serviceAddress,
    primaryContact,
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

      // v1 Tax Integration: Apply default tax group to new invoices
      // Also snapshot the group composition into invoice_tax_lines so later
      // edits to rates/groups do NOT affect this invoice.
      const defaultGroup = await taxRepository.getDefaultTaxGroup(req.companyId!);
      if (defaultGroup && defaultGroup.rates.length > 0) {
        const combinedRate = defaultGroup.rates.reduce(
          (sum, r) => sum + parseFloat(r.rate || "0"), 0
        );
        // Set taxGroupId on the invoice
        await storage.updateInvoice(req.companyId!, result.invoice.id, undefined, {
          taxGroupId: defaultGroup.id,
        });
        // Apply combined rate to each line item's taxRate
        const lines = await storage.getInvoiceLines(req.companyId!, result.invoice.id);
        let invoiceSubtotal = 0;
        for (const line of lines) {
          const lineSubtotal = parseFloat(line.lineSubtotal || "0");
          invoiceSubtotal += lineSubtotal;
          const taxAmount = lineSubtotal * (combinedRate / 100);
          const lineTotal = lineSubtotal + taxAmount;
          await storage.updateInvoiceLine(req.companyId!, result.invoice.id, line.id, {
            taxRate: String(combinedRate / 100), // Decimal format (e.g., 0.13 for 13%)
            taxAmount: String(taxAmount.toFixed(2)),
            lineTotal: String(lineTotal.toFixed(2)),
          });
        }

        // Snapshot: write one invoice_tax_lines row per component rate
        const snapshotRows = defaultGroup.rates.map((r) => {
          const pct = parseFloat(r.rate || "0");
          const taxAmt = invoiceSubtotal * (pct / 100);
          return {
            companyId: req.companyId!,
            invoiceId: result.invoice.id,
            taxRateId: r.id,
            taxRateName: r.name,
            ratePercent: r.rate,
            taxableAmount: String(invoiceSubtotal.toFixed(2)),
            taxAmount: String(taxAmt.toFixed(2)),
            taxGroupId: defaultGroup.id,
            taxGroupName: defaultGroup.name,
          };
        });
        if (snapshotRows.length > 0) {
          await invoiceDb.insert(invoiceTaxLines).values(snapshotRows);
        }
      }
    }

    // Phase 1: Log invoice creation event
    if (result.created) {
      logEventAsync(getQueryCtx(req), {
        eventType: "invoice.created",
        entityType: "invoice",
        entityId: result.invoice.id,
        summary: `Invoice #${result.invoice.invoiceNumber} created from job`,
        meta: { invoiceNumber: result.invoice.invoiceNumber, jobId: req.params.jobId },
      });
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

    // Invoice number uniqueness check (enforced per tenant via DB unique index)
    // The DB index invoices_company_invoice_number_uq handles this, but we catch
    // the constraint violation and return a clear 409 error.

    // When paymentTermsDays is a number (standard terms), recalculate dueDate
    if (patch.paymentTermsDays !== undefined && patch.paymentTermsDays !== null && !patch.dueDate) {
      const issuedAt = invoice.issuedAt
        ? new Date(invoice.issuedAt)
        : invoice.issueDate
          ? new Date(invoice.issueDate)
          : new Date();
      const dueDate = new Date(issuedAt.getTime() + patch.paymentTermsDays * 24 * 60 * 60 * 1000);
      finalPatch.dueDate = dueDate.toISOString().split("T")[0];
    }
    // When paymentTermsDays is null (custom terms), dueDate must be provided directly
    if (patch.paymentTermsDays === null && patch.dueDate) {
      finalPatch.dueDate = patch.dueDate;
    }

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
    // Invoice number uniqueness violation (DB constraint: invoices_company_invoice_number_uq)
    if (error.code === '23505' && error.constraint?.includes('invoice_number')) {
      return res.status(409).json({
        error: 'Invoice number is already in use. Please choose a different number.',
        code: 'DUPLICATE_INVOICE_NUMBER'
      });
    }
    throw error;
  }
}));

// ========================================
// STATUS TRANSITION ENDPOINTS
// ========================================

// POST /api/invoices/:id/send - Send invoice (draft -> awaiting_payment)
// Phase 10A: Status changes on QBO-synced invoices require override
router.post("/:id/send", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const invoice = await storage.getInvoice(req.companyId!, req.params.id);
  if (!invoice) {
    throw createError(404, "Invoice not found");
  }

  // Parse QBO override from body
  const overrideQboLock = req.body?.overrideQboLock === true;
  const overrideReason = typeof req.body?.overrideReason === 'string' ? req.body.overrideReason : undefined;

  // Validate transition - now transitions to awaiting_payment
  try {
    assertInvoiceStatusTransition(invoice.status as InvoiceStatus, "awaiting_payment");
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
  checkQboBillingLock(invoice, { status: 'awaiting_payment' }, { overrideQboLock, overrideReason });

  // Build update payload - transition to awaiting_payment with sent tracking
  const now = new Date();
  let updatePayload: Record<string, unknown> = {
    status: "awaiting_payment",
    sentAt: now,
    sentByUserId: req.user?.id,
  };

  // Set issuedAt if not already set
  if (!invoice.issuedAt) {
    updatePayload.issuedAt = now;
  }

  // Ensure dueDate is set (compute from issuedAt + paymentTermsDays if missing)
  if (!invoice.dueDate) {
    const issuedAt = invoice.issuedAt ? new Date(invoice.issuedAt) : now;
    const paymentTermsDays = invoice.paymentTermsDays ?? 30;
    const dueDate = new Date(issuedAt.getTime() + paymentTermsDays * 24 * 60 * 60 * 1000);
    updatePayload.dueDate = dueDate.toISOString().split("T")[0];
  }

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

  // Phase 1: Log invoice sent event
  logEventAsync(getQueryCtx(req), {
    eventType: "invoice.sent",
    entityType: "invoice",
    entityId: req.params.id,
    summary: `Invoice #${invoice.invoiceNumber} sent`,
    meta: { invoiceNumber: invoice.invoiceNumber },
  });

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

// GET /api/invoices/:id/pdf - Download invoice PDF
router.get("/:id/pdf", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const invoiceId = req.params.id;

  // Get invoice details
  const invoice = await storage.getInvoice(companyId, invoiceId);
  if (!invoice) {
    throw createError(404, "Invoice not found");
  }

  // Get invoice lines
  const lines = await storage.getInvoiceLines(companyId, invoiceId);

  // Get location
  const location = await storage.getClient(companyId, invoice.locationId);
  if (!location) {
    throw createError(400, "Invoice has invalid location reference");
  }

  // Get customer company (if exists)
  let customerCompany = null;
  const customerCompanyId = invoice.customerCompanyId || location.parentCompanyId;
  if (customerCompanyId) {
    customerCompany = await storage.getCustomerCompany(companyId, customerCompanyId);
  }

  // Get company info for branding
  const company = await storage.getCompanyById(companyId);
  if (!company) {
    throw createError(500, "Company not found");
  }

  // Generate PDF
  const pdfBuffer = await generateInvoicePdf({
    invoice: invoice as any,
    lines,
    company,
    location: {
      companyName: location.companyName,
      address: location.address,
      city: location.city,
      provinceState: location.province,
      postalCode: location.postalCode,
      phone: location.phone,
      email: location.email,
    },
    customerCompany: customerCompany ? { name: customerCompany.name } : null,
  });

  const filename = `Invoice-${invoice.invoiceNumber || invoice.id.slice(0, 8)}.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", pdfBuffer.length);
  res.send(pdfBuffer);
}));

// PATCH /api/invoices/:id/sent - Toggle sent status (mark as sent / undo sent)
router.patch("/:id/sent", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const invoice = await storage.getInvoice(req.companyId!, req.params.id);
  if (!invoice) {
    throw createError(404, "Invoice not found");
  }

  // Parse request body
  const isSent = req.body?.isSent === true;

  // Terminal states cannot be modified
  if (invoice.status === "paid" || invoice.status === "voided") {
    throw createError(409, `Cannot modify sent status on ${invoice.status} invoice`);
  }

  const now = new Date();
  let updatePayload: Record<string, unknown>;

  if (isSent) {
    // Mark as sent: draft -> awaiting_payment
    if (invoice.status !== "draft") {
      throw createError(400, "Only draft invoices can be marked as sent");
    }

    updatePayload = {
      status: "awaiting_payment",
      sentAt: now,
      sentByUserId: req.user?.id,
    };

    // Set issuedAt if not already set
    if (!invoice.issuedAt) {
      updatePayload.issuedAt = now;
    }

    // Ensure dueDate is set
    if (!invoice.dueDate) {
      const issuedAt = invoice.issuedAt ? new Date(invoice.issuedAt) : now;
      const paymentTermsDays = invoice.paymentTermsDays ?? 30;
      const dueDate = new Date(issuedAt.getTime() + paymentTermsDays * 24 * 60 * 60 * 1000);
      updatePayload.dueDate = dueDate.toISOString().split("T")[0];
    }
  } else {
    // Undo sent: awaiting_payment -> draft (only if no payments)
    if (invoice.status !== "awaiting_payment" && invoice.status !== "sent") {
      throw createError(400, "Can only undo sent on invoices with sent/awaiting_payment status");
    }

    const amountPaid = parseFloat(invoice.amountPaid || "0");
    if (amountPaid > 0) {
      throw createError(409, "Cannot undo sent on invoice with payments. Void the invoice instead.");
    }

    updatePayload = {
      status: "draft",
      sentAt: null,
      sentByUserId: null,
    };
  }

  await storage.updateInvoice(
    req.companyId!,
    req.params.id,
    undefined,
    updatePayload
  );

  // Re-fetch to include derived fields like isPastDue
  const updated = await storage.getInvoice(req.companyId!, req.params.id);
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
