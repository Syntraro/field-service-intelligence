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
import { requireFeature } from "../auth/requireFeature";
import { assertInvoiceStatusTransition } from "../domain/jobLifecycle";
import { invoiceStatusEnum } from "@shared/schema";
import type { InvoiceStatus } from "@shared/schema";
import { createInvoiceFromJob as createInvoiceFromJobService, calculateDueDate, applyTaxGroupToInvoice } from "../services/invoiceCreationService";
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
import {
  isInvoiceTerminal, isInvoiceDraft, canMarkInvoiceSent, canUndoInvoiceSent,
  isInvoiceAwaitingPayment, isInvoicePartialPaid,
} from "../lib/invoicePredicates";
// Phase 1 Architecture: Event Log
import { logEventAsync } from "../lib/events";
import * as lifecycle from "../services/jobLifecycleOrchestrator";
// Phase 5 Step A4: canonical invoice feed builders
import { getQueryCtx } from "../lib/queryCtx";
import { getInvoicesFeed, getInvoiceStats as getCanonicalInvoiceStats, UNPAID_INVOICE_STATUSES } from "../storage/invoicesFeed";
// 2026-04-08: P7 — Canonical line-item input schema (shared with quotes/jobs)
// 2026-04-08: Stabilization pass — canonical money helpers for tax math
import { canonicalLineItemInput, moneyString, parseMoney, formatMoney } from "@shared/lineItem";

const router = Router();

// Gate all invoice endpoints behind feature flag
router.use(requireFeature("invoicesEnabled"));

// ========================================
// VALIDATION SCHEMAS
// ========================================

// Phase 10A: QBO override options schema (reusable)
const qboOverrideSchema = z.object({
  overrideQboLock: z.boolean().optional(),
  overrideReason: z.string().min(10).max(500).optional(),
}).strict();

// 2026-04-08: P7 — Migrated to canonical line-item input.
// All money fields are now strings post-validation (canonicalLineItemInput
// transforms number → string for transitional clients still sending numbers).
// The route's tax-application math at the POST handler below now uses
// parseFloat()/String() to coerce in/out of the canonical string shape.
const createInvoiceLineSchema = canonicalLineItemInput.extend({
  lineNumber: z.number().int().positive().optional(),
  overrideQboLock: z.boolean().optional(),
  overrideReason: z.string().min(10).max(500).optional(),
}).strict();

const createInvoiceFromJobSchema = z.object({
  markJobCompleted: z.boolean().optional().default(false),
}).strict();

const updateInvoiceSchema = z.object({
  // 2026-03-18: Uses canonical invoiceStatusEnum from shared/schema.ts (was hardcoded, missing awaiting_payment)
  status: z.enum(invoiceStatusEnum).optional(),
  issueDate: z.string().min(1).max(50).optional(), // Accepts YYYY-MM-DD (date column) or ISO datetime
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

    if (isInvoiceTerminal(invoice.status)) {
      throw createError(409, `Invoice is ${invoice.status} and cannot be modified`);
    }

    // Attach invoice to request for downstream use (avoids re-fetch)
    (req as any).invoice = invoice;
    next();
  });
}

/**
 * Middleware: Invoice must exist and not be in terminal state
 * Use for: notes-only updates on issued invoices
 */
function requireInvoiceEditable() {
  return asyncHandler(async (req: AuthedRequest, res: Response, next: any) => {
    const invoice = await storage.getInvoice(req.companyId!, req.params.id);

    if (!invoice) {
      throw createError(404, "Invoice not found");
    }

    if (isInvoiceTerminal(invoice.status)) {
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

// Standalone invoice creation schema
const createStandaloneInvoiceSchema = z.object({
  locationId: z.string().uuid(),
  workDescription: z.string().max(2000).optional(),
}).strict();

/**
 * POST /api/invoices - Create standalone draft invoice (no job/PM dependency)
 * Returns a draft invoice shell with no lines. Lines are added separately.
 * 2026-03-29: First-class standalone invoice creation path.
 */
router.post("/", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const validated = validateSchema(createStandaloneInvoiceSchema, req.body);
  const companyId = req.companyId!;

  if (!companyId) {
    throw createError(401, "Company context required. Ensure you are logged in with a valid company.");
  }

  // Resolve location and customerCompanyId (same pattern as job/PM paths)
  const location = await storage.getClient(companyId, validated.locationId);
  if (!location) {
    // Precise error for diagnosability — location may not exist or may belong to another tenant
    console.warn(
      `[POST /api/invoices] Location lookup failed: locationId=${validated.locationId}, companyId=${companyId}`
    );
    throw createError(404, `Location not found for this company. Verify the location ID (${validated.locationId}) belongs to your account.`);
  }

  const result = await storage.createStandaloneInvoice(
    companyId,
    {
      locationId: validated.locationId,
      customerCompanyId: location.parentCompanyId ?? null,
      workDescription: validated.workDescription,
    },
    "STANDALONE_ROUTE"
  );

  // Apply default tax group to new invoice (sets taxGroupId; no lines yet so batch-apply is no-op)
  const { taxRepository } = await import("../storage/tax");
  const defaultTaxGroup = await taxRepository.getDefaultTaxGroup(companyId);
  if (defaultTaxGroup && defaultTaxGroup.rates.length > 0) {
    await storage.updateInvoice(companyId, result.invoice.id, undefined, {
      taxGroupId: defaultTaxGroup.id,
    });
  }

  logEventAsync(getQueryCtx(req), {
    eventType: "invoice.created",
    entityType: "invoice",
    entityId: result.invoice.id,
    summary: `Invoice #${result.invoiceNumber} created (standalone)`,
    meta: { invoiceNumber: result.invoiceNumber },
  });

  res.status(201).json(result.invoice);
}));

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
    statuses: UNPAID_INVOICE_STATUSES,
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

// 2026-04-09: DELETE /api/invoices/:id — canonical permanent invoice delete.
//
// Eligibility: only draft, never QBO-synced, zero payments. The storage method
// enforces all three rules under SELECT FOR UPDATE and throws structured 404/409
// errors. Cleanup of invoice_lines, payments, invoice_tax_lines, and time_entries
// lock state happens inside one transaction. Job linkage is auto-detached via
// the FK SET NULL on jobs.invoice_id — the job remains valid as a standalone
// record (locked product decision: deleting an invoice must NOT break the job).
router.delete("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  try {
    await storage.deleteInvoice(req.companyId!, req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    // Map storage layer errors to HTTP. notFoundError → 404, conflictError → 409.
    if (err?.statusCode) throw err;
    if (err?.message?.startsWith("Cannot delete")) {
      throw createError(409, err.message);
    }
    throw err;
  }
}));

// GET /api/invoices/:id/details - Get full invoice details (composite endpoint)
router.get("/:id/details", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const invoiceId = req.params.id;

  // P3-03: Phase 1 — getInvoice must complete first (404 guard + extract IDs)
  const invoice = await storage.getInvoice(companyId, invoiceId);
  if (!invoice) {
    console.warn(
      `[invoices/:id/details] 404 Not Found - companyId=${companyId}, invoiceId=${invoiceId}`
    );
    throw createError(404, "Invoice not found");
  }

  // P3-03: Phase 2 — lines, location, job are independent reads (parallel)
  const [lines, location, job] = await Promise.all([
    storage.getInvoiceLines(companyId, invoiceId),
    storage.getClient(companyId, invoice.locationId),
    invoice.jobId ? storage.getJob(companyId, invoice.jobId) : Promise.resolve(null),
  ]);

  if (!location) {
    throw createError(400, "Invoice has invalid location reference");
  }

  // P3-03: Phase 3 — customerCompany depends on location.parentCompanyId (sequential)
  let customerCompany = null;
  const customerCompanyId = invoice.customerCompanyId || location.parentCompanyId;
  if (customerCompanyId) {
    customerCompany = await storage.getCustomerCompany(companyId, customerCompanyId);
  }

  // 6. Build structured address + contact fields for Jobber-style header
  // Billing address: prefer customerCompany billing address, fall back to location
  const billingAddress = customerCompany?.billingStreet
    ? {
        street: customerCompany.billingStreet,
        street2: customerCompany.billingStreet2 || "",
        city: customerCompany.billingCity || "",
        province: customerCompany.billingProvince || "",
        postalCode: customerCompany.billingPostalCode || "",
        country: customerCompany.billingCountry || "",
      }
    : location.address
      ? {
          street: location.address,
          street2: location.address2 || "",
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
        street2: location.address2 || "",
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

  // If the invoice has an active tax group and the incoming line has no
  // explicit tax rate, apply the group's rate.
  //
  // Money discipline (2026-04-08 stabilization pass):
  //   - Canonical schema delivers `lineData.taxRate` / `lineData.lineSubtotal`
  //     as canonical money strings. Both are guaranteed present (the schema
  //     applies defaults), so the previous `?? "0"` defensive coalescing was
  //     dead code and is removed here.
  //   - Math is performed in JS numbers via `parseMoney`. Never operate on
  //     the strings directly; never use `+` between mixed types.
  //   - Results are written back via `formatMoney`. `taxRate` uses 4 decimal
  //     places to match the canonical schema regex; amounts use 2.
  //   - `Math.round(x * 100) / 100` rounds to cents; `Number.isFinite` and
  //     the helpers' built-in fallback to "0.00" / "0.0000" guarantee no
  //     `NaN` / `undefined` / empty-string can leak into the line item.
  if (invoice.taxGroupId && parseMoney(lineData.taxRate) === 0) {
    const { taxRepository } = await import("../storage/tax");
    const group = await taxRepository.getTaxGroup(req.companyId!, invoice.taxGroupId);
    if (group && group.rates.length > 0) {
      const combinedRatePct = group.rates.reduce(
        (sum: number, r: any) => sum + parseMoney(r.rate),
        0,
      );
      const taxRateDecimal = combinedRatePct / 100;
      const subtotal = parseMoney(lineData.lineSubtotal);
      const taxAmount = Math.round(subtotal * taxRateDecimal * 100) / 100;
      const lineTotal = Math.round((subtotal + taxAmount) * 100) / 100;

      lineData.taxRate = formatMoney(taxRateDecimal, 4);
      lineData.taxAmount = formatMoney(taxAmount, 2);
      lineData.lineTotal = formatMoney(lineTotal, 2);
    }
  }

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

// PATCH /api/invoices/:id/lines/reorder - Reorder line items
// NOTE: Must be registered BEFORE /:id/lines/:lineId to avoid "reorder" matching as :lineId
const reorderInvoiceLinesSchema = z.array(z.object({
  id: z.string().uuid(),
  lineNumber: z.number().int().positive(),
})).min(1).max(200);

router.patch("/:id/lines/reorder", requireRole(MANAGER_ROLES), requireEditableStatus(), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const ordering = validateSchema(reorderInvoiceLinesSchema, req.body);
  try {
    await storage.reorderInvoiceLines(req.companyId!, req.params.id, ordering);
  } catch (error: any) {
    // Validation errors from reorderInvoiceLines are user-facing (bad payload)
    if (error.message?.includes("duplicate") || error.message?.includes("does not belong") || error.message?.includes("Full reorder required")) {
      throw createError(400, error.message);
    }
    throw error;
  }
  res.json({ success: true });
}));

// PATCH /api/invoices/:id/lines/:lineId - Update a single line item (with QBO lock check)
// 2026-04-09: Money fields use canonical `moneyString` (string-on-the-wire, with
// `z.coerce.string()` so legacy number-sending callers still work) instead of
// inline `z.number()`. This closes the PATCH schema drift identified in the
// payment-system audit and aligns this route with `createInvoiceLineSchema`
// (which already extends `canonicalLineItemInput`). Behavior is unchanged for
// existing callers; this is a contract-cleanup pass.
const updateInvoiceLineSchema = z.object({
  description: z.string().min(1).max(500).optional(),
  quantity: moneyString.optional(),
  unitPrice: moneyString.optional(),
  unitCost: moneyString.optional(),
  lineSubtotal: moneyString.optional(),
  taxRate: moneyString.optional(),
  taxAmount: moneyString.optional(),
  lineTotal: moneyString.optional(),
  productId: z.string().uuid().nullable().optional(),
  overrideQboLock: z.boolean().optional(),
  overrideReason: z.string().min(10).max(500).optional(),
}).strict();

router.patch("/:id/lines/:lineId", requireRole(MANAGER_ROLES), requireEditableStatus(), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const validated = validateSchema(updateInvoiceLineSchema, req.body);
  const { overrideQboLock, overrideReason, ...lineData } = validated;

  const invoice = (req as any).invoice;

  if (overrideQboLock) {
    requireQboOverrideReason(overrideQboLock, overrideReason);
  }
  checkQboLineItemLock(invoice, 'update', { overrideQboLock, overrideReason });

  const updated = await storage.updateInvoiceLine(req.companyId!, req.params.id, req.params.lineId, lineData);
  if (!updated) {
    throw createError(404, "Line item not found");
  }

  let warning: string | undefined;
  if (isQboSynced(invoice) && overrideQboLock && overrideReason) {
    const outOfSyncUpdate = buildOutOfSyncUpdate(overrideReason, req.user?.id);
    await storage.updateInvoice(req.companyId!, req.params.id, undefined, outOfSyncUpdate);
    logQboLockOverride(req.companyId!, req.params.id, req.user?.id ?? 'unknown', 'edit_line', overrideReason, invoice.qboInvoiceId);
    warning = "Invoice is now out of sync with QuickBooks. Manual reconciliation required.";
  }

  res.json({ ...updated, _qboWarning: warning });
}));

// POST /api/invoices/:id/refresh-from-job - Refresh invoice lines from job (draft only, with QBO lock check)
// POST /api/invoices/:id/apply-tax - Apply tax group or remove tax from invoice
// Reuses canonical batchApplyLineTax() + tax snapshot — does NOT mutate company settings
// Accepts { taxGroupId: "uuid" } to apply a group, or { taxGroupId: null } for no tax
const applyTaxSchema = z.object({
  taxGroupId: z.string().uuid().nullable(),
}).strict();

router.post("/:id/apply-tax", requireRole(MANAGER_ROLES), requireEditableStatus(), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const validated = validateSchema(applyTaxSchema, req.body);
  const companyId = req.companyId!;
  const invoiceId = req.params.id;

  // Validate tax group exists before applying (null = no tax, always valid)
  if (validated.taxGroupId !== null) {
    const { taxRepository } = await import("../storage/tax");
    const group = await taxRepository.getTaxGroup(companyId, validated.taxGroupId);
    if (!group) throw createError(404, "Tax group not found");
    if (!group.rates || group.rates.length === 0) throw createError(400, "Tax group has no rates configured");
  }

  // Delegate to canonical shared function (same logic as invoice creation)
  await applyTaxGroupToInvoice(companyId, invoiceId, validated.taxGroupId);

  // Re-fetch to return updated invoice with recalculated totals
  const updated = await storage.getInvoice(companyId, invoiceId);
  res.json(updated);
}));

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
    // 2026-03-19: Canonical create-from-job workflow (F-05 hardening).
    // Service owns: create → refresh → tax → snapshot, all inside a transaction.
    const result = await createInvoiceFromJobService(
      req.companyId!,
      req.params.jobId,
      { markJobCompleted: validated.markJobCompleted },
      "INVOICE_ROUTE"
    );

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

    // 2026-03-18: Canonical MARK_INVOICED lifecycle transition.
    // Invoice creation is separate from lifecycle — callers opt in explicitly.
    if (result.created && validated.markJobCompleted) {
      const job = await storage.getJob(req.companyId!, req.params.jobId);
      if (job) {
        const actor = { userId: req.user?.id || "unknown", role: req.user?.role || "unknown" };
        await lifecycle.markInvoiced({
          type: "MARK_INVOICED",
          companyId: req.companyId!,
          jobId: req.params.jobId,
          version: job.version ?? 0,
          actor,
          invoiceId: result.invoice.id,
        });
      }
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

  // 2026-04-08: Enforce canonical lifecycle transition rules when patch body
  // contains a status field. Prevents illegal jumps (e.g. draft → paid via PATCH).
  // Routes /send, /void, /sent toggle remain the canonical transition entry points;
  // status in PATCH /:id is allowed only as a no-op (same status) or a legal transition.
  if (patch.status !== undefined && patch.status !== invoice.status) {
    try {
      assertInvoiceStatusTransition(invoice.status as any, patch.status as any);
    } catch (err: any) {
      throw createError(409, err?.message || `Invalid status transition: ${invoice.status} → ${patch.status}`);
    }
  }

  // Phase 11: Track if editing an issued invoice (for warning in response).
  // Treats canonical "awaiting_payment" and legacy "sent" equivalently.
  const isIssuedInvoice = isInvoiceAwaitingPayment(invoice.status) || isInvoicePartialPaid(invoice.status);
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

    // Counter-drift guard: if manual invoice number is numeric and exceeds
    // companyCounters.nextInvoiceNumber, bump the counter to prevent future collisions.
    if (patch.invoiceNumber) {
      const numericVal = parseInt(patch.invoiceNumber, 10);
      if (!isNaN(numericVal) && String(numericVal) === patch.invoiceNumber.trim()) {
        await storage.bumpInvoiceCounterIfNeeded(req.companyId!, numericVal + 1);
      }
    }

    // When paymentTermsDays is a number (standard terms), recalculate dueDate
    // 2026-03-19: Uses canonical calculateDueDate (F-06 hardening)
    if (patch.paymentTermsDays !== undefined && patch.paymentTermsDays !== null && !patch.dueDate) {
      const issuedAt = invoice.issuedAt
        ? new Date(invoice.issuedAt)
        : invoice.issueDate
          ? new Date(invoice.issueDate)
          : new Date();
      finalPatch.dueDate = calculateDueDate(issuedAt, patch.paymentTermsDays);
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
    // Phase 11: Warn about editing an issued invoice (not a hard error)
    if (isIssuedInvoice && hasBillingChanges) {
      response._sentInvoiceWarning = "This invoice has been issued to the client. You should re-send an updated invoice.";
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
  // 2026-03-19: Uses canonical calculateDueDate (F-06 hardening)
  if (!invoice.dueDate) {
    const issuedAt = invoice.issuedAt ? new Date(invoice.issuedAt) : now;
    const paymentTermsDays = invoice.paymentTermsDays ?? 30;
    updatePayload.dueDate = calculateDueDate(issuedAt, paymentTermsDays);
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

  // 2026-03-20 Phase 4A: Log invoice voided event
  logEventAsync(getQueryCtx(req), {
    eventType: "invoice.voided",
    entityType: "invoice",
    entityId: req.params.id,
    summary: `Invoice #${invoice.invoiceNumber} voided`,
    meta: { invoiceNumber: invoice.invoiceNumber, fromStatus: invoice.status },
  });

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

  // Get invoice details first (needed to resolve dependent fetches)
  const invoice = await storage.getInvoice(companyId, invoiceId);
  if (!invoice) {
    throw createError(404, "Invoice not found");
  }

  // 2026-04-08: Parallelize independent reads — invoice lines, location, and
  // company branding don't depend on each other. Reduces PDF latency by waiting
  // only for the slowest of the three instead of summing all three.
  const [lines, location, company] = await Promise.all([
    storage.getInvoiceLines(companyId, invoiceId),
    storage.getClient(companyId, invoice.locationId),
    storage.getCompanyById(companyId),
  ]);

  if (!location) {
    throw createError(400, "Invoice has invalid location reference");
  }
  if (!company) {
    throw createError(500, "Company not found");
  }

  // Get customer company (if exists) — depends on location.parentCompanyId,
  // so must run after location resolves.
  let customerCompany = null;
  const customerCompanyId = invoice.customerCompanyId || location.parentCompanyId;
  if (customerCompanyId) {
    customerCompany = await storage.getCustomerCompany(companyId, customerCompanyId);
  }

  // Generate PDF
  const pdfBuffer = await generateInvoicePdf({
    invoice: invoice as any,
    lines,
    company,
    location: {
      companyName: location.companyName,
      address: location.address,
      address2: location.address2,
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
  if (isInvoiceTerminal(invoice.status)) {
    throw createError(409, `Cannot modify sent status on ${invoice.status} invoice`);
  }

  const now = new Date();
  let updatePayload: Record<string, unknown>;

  if (isSent) {
    // Mark as sent: draft -> awaiting_payment
    if (!canMarkInvoiceSent(invoice.status)) {
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
    // 2026-03-19: Uses canonical calculateDueDate (F-06 hardening)
    if (!invoice.dueDate) {
      const issuedAt = invoice.issuedAt ? new Date(invoice.issuedAt) : now;
      const paymentTermsDays = invoice.paymentTermsDays ?? 30;
      updatePayload.dueDate = calculateDueDate(issuedAt, paymentTermsDays);
    }
  } else {
    // Undo sent: awaiting_payment -> draft (only if no payments)
    if (!canUndoInvoiceSent(invoice.status)) {
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

// DELETE /api/invoices/:id - Delete invoice (draft only, with safety guards)
router.delete("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const invoice = await storage.getInvoice(req.companyId!, req.params.id);
  if (!invoice) {
    throw createError(404, "Invoice not found");
  }

  if (!isInvoiceDraft(invoice.status)) {
    throw createError(409, "Only draft invoices can be deleted. Void the invoice instead.");
  }

  // Guard: cannot delete if synced/exported to QuickBooks
  if (invoice.qboInvoiceId) {
    throw createError(409, "Cannot delete an invoice that has been synced to QuickBooks. Void it instead.");
  }

  // Guard: cannot delete if any payments have been recorded
  if (parseFloat(invoice.amountPaid || "0") > 0) {
    throw createError(409, "Cannot delete an invoice with recorded payments. Void it instead.");
  }

  // Soft delete via isActive flag
  await storage.updateInvoice(
    req.companyId!,
    req.params.id,
    undefined,
    { isActive: false, deletedAt: new Date() }
  );

  // Log delete event
  logEventAsync(getQueryCtx(req), {
    eventType: "invoice.deleted",
    entityType: "invoice",
    entityId: req.params.id,
    summary: `Invoice #${invoice.invoiceNumber} deleted (draft)`,
    meta: { invoiceNumber: invoice.invoiceNumber },
  });

  res.json({ success: true });
}));

export default router;
