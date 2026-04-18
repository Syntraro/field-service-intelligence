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
import { invoiceReminderService, ReminderGateError } from "../services/invoiceReminderService";
import { invoiceRepository } from "../storage/invoices";
import { jobNotesRepository } from "../storage/jobNotes";
import { clientNotesRepository } from "../storage/clientNotes";
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
// 2026-04-12 Phase 4: canonical email dispatch for invoice send flow.
import { emailDispatchService } from "../services/emailDispatchService";
// 2026-04-12 Phase 5: preview + recipient defaults.
import { templateDataBuilder } from "../services/templateDataBuilder";
import { communicationTemplatesService } from "../services/communicationTemplatesService";
import { recipientResolverService } from "../services/recipientResolverService";
// Phase 14 (2026-04-12): batch send orchestrator (one email per invoice).
import { invoiceBatchSendService } from "../services/invoiceBatchSendService";
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

// Canonical invoice stats — single source of truth for both Dashboard and Invoices page.
// Returns shaped summary matching InvoiceStats client type.
router.get("/stats", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const ctx = getQueryCtx(req);
  const stats = await getCanonicalInvoiceStats(ctx);

  // Shape response for all consumers (Dashboard + Invoices page)
  const totalIssued = stats.byStatus
    .filter(s => s.status !== "draft")
    .reduce((sum, s) => sum + s.count, 0);
  const totalIssuedAmount = stats.byStatus
    .filter(s => s.status !== "draft")
    .reduce((sum, s) => sum + s.totalAmount, 0);
  const averageInvoice = totalIssued > 0 ? totalIssuedAmount / totalIssued : 0;

  res.json({
    outstanding: { amount: stats.totalOutstanding, count: stats.outstandingCount },
    overdue: { amount: stats.totalOutstanding, count: stats.overdueCount }, // overdue amount approximation — uses outstanding total
    issuedLast30Days: { count: totalIssued }, // simplified — full 30d filter would need date range
    averageInvoice: Math.round(averageInvoice * 100) / 100,
    draftCount: stats.draftCount,
    byStatus: stats.byStatus,
  });
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

// GET /api/invoices/:invoiceId/notes — canonical invoice notes feed.
// 2026-04-18: new endpoint. Invoice detail previously reused
// `/api/jobs/:jobId/notes` (via invoice.jobId), which had no way to consult
// `show_on_invoices`. This endpoint owns the invoice surface: merges the
// linked job's entity-owned notes (when invoice.jobId is set) with inherited
// client notes where show_on_invoices=true, scoped by the invoice's
// location + parent customer company.
router.get("/:invoiceId/notes", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId!;
  const invoiceId = req.params.invoiceId;

  const invoice = await storage.getInvoice(companyId, invoiceId);
  if (!invoice) throw createError(404, "Invoice not found");

  // 1) Entity-owned notes: invoice "owns" its linked job's notes today.
  //    When no job is linked, there are no entity-owned notes to show.
  let owned: any[] = [];
  if (invoice.jobId) {
    const ownedRaw = await jobNotesRepository.listJobNotes(companyId, invoice.jobId);
    owned = ownedRaw.map((n) => ({ ...n, origin: "job" as const, editable: true }));
  }

  // 2) Inherited client notes for this invoice's location + customer company.
  let inherited: any[] = [];
  if (invoice.locationId) {
    const rows = await clientNotesRepository.listInheritedForEntity(companyId, {
      locationId: invoice.locationId,
      customerCompanyId: invoice.customerCompanyId ?? null,
      surface: "invoices",
    });
    inherited = rows.map((r) => ({
      id: r.id,
      jobId: null,
      equipmentId: null,
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

// 2026-04-12 Phase 5: request shape for the invoice send endpoint.
// `subjectOverride` / `bodyOverride` are one-time overrides: never persisted
// to the template row; applied only to this single dispatch call.
const sendInvoiceBodySchema = z.object({
  recipients: z.array(z.string().email()).min(1, "At least one recipient required"),
  // 2026-04-13 (Commit C): optional CC list. Deduped server-side.
  cc: z.array(z.string().email()).max(20).optional(),
  subjectOverride: z
    .string()
    .optional()
    .refine((v) => v === undefined || v.trim().length > 0, {
      message: "subjectOverride cannot be blank",
    }),
  bodyOverride: z
    .string()
    .optional()
    .refine((v) => v === undefined || v.trim().length > 0, {
      message: "bodyOverride cannot be blank",
    }),
  // 2026-04-13 (Commit C): attach-invoice-PDF toggle (defaults to true
  // when omitted) and up to 5 uploaded image file ids.
  attachPdf: z.boolean().optional(),
  attachmentFileIds: z.array(z.string().min(1)).max(5).optional(),
  overrideQboLock: z.boolean().optional(),
  overrideReason: z.string().optional(),
}).passthrough();

// 2026-04-12 Phase 5: render-only request shape for the preview endpoint.
const renderInvoiceEmailSchema = z.object({
  recipients: z.array(z.string().email()).optional(),
}).passthrough();

// POST /api/invoices/:id/render-email — Preview rendered email WITHOUT sending.
// Phase 5: shares the exact same data-builder + template-service path as the
// actual send flow, so what you see is what you get. Never generates a PDF,
// never calls Resend, never mutates invoice status.
router.post(
  "/:id/render-email",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId!;
    const invoiceId = req.params.id;
    const { recipients } = validateSchema(renderInvoiceEmailSchema, req.body ?? {});

    const data = await templateDataBuilder.buildInvoiceTemplateData(tenantId, invoiceId);
    const rendered = await communicationTemplatesService.renderTemplateForEntity(
      tenantId,
      "invoice",
      "email",
      data,
    );
    if (!rendered) {
      throw createError(500, "No template or default available for invoice email");
    }

    res.json({
      subject: rendered.subject,
      body: rendered.body,
      recipients: recipients ?? [],
    });
  }),
);

// GET /api/invoices/:id/email-recipients — Return the default recipient list
// (billing contacts, with legacy fallbacks). Used by the send modal to
// pre-fill the "To:" field.
router.get(
  "/:id/email-recipients",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId!;
    const invoiceId = req.params.id;
    const result = await recipientResolverService.getDefaultRecipients({
      tenantId, entityType: "invoice", entityId: invoiceId,
    });
    res.json(result);
  }),
);

// GET /api/invoices/:id/email-contacts — Rich contact list for the To/CC
// picker: every person with an email address that belongs to this
// invoice's location or parent customer-company. 2026-04-14.
// Returns `{ contacts: [{name, email, roles, source}] }` deduped by email.
router.get(
  "/:id/email-contacts",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId!;
    const invoiceId = req.params.id;

    const { clientContactRepository } = await import("../storage/clientContacts");
    const invoice = await storage.getInvoice(tenantId, invoiceId);
    if (!invoice) throw createError(404, "Invoice not found");

    const location = await storage.getClient(tenantId, invoice.locationId);
    const customerCompanyId =
      (invoice as any).customerCompanyId || (location as any)?.parentCompanyId || null;

    type ContactOption = {
      name: string;
      email: string;
      roles: string[];
      source: "location" | "company";
    };
    const seen = new Set<string>();
    const contacts: ContactOption[] = [];

    // 2026-04-14 bug fix: only surface contacts whose email passes a basic
    // RFC-shape check. The client-side chip normalizer rejects anything
    // without a dotted domain (e.g. "huda@huda"), so unfiltered rows
    // looked selectable but silently no-op'd on click. Matches the
    // pattern used in `useSendCommunicationModal.normalizeEmail` and
    // `recipientResolverService.cleanEmail`.
    const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    const pushIf = (
      raw: { firstName?: string | null; lastName?: string | null; email?: string | null },
      roles: string[],
      source: "location" | "company",
    ) => {
      const email = (raw.email ?? "").trim().toLowerCase();
      if (!email) return;
      if (!EMAIL_SHAPE.test(email)) return;
      if (seen.has(email)) return;
      seen.add(email);
      const name = `${raw.firstName ?? ""} ${raw.lastName ?? ""}`.trim() || email;
      contacts.push({ name, email, roles, source });
    };

    try {
      const locationContacts = await clientContactRepository.getLocationContacts(
        tenantId,
        invoice.locationId,
      );
      for (const c of locationContacts) {
        const roles = Array.isArray((c.assignment as any)?.roles)
          ? ((c.assignment as any).roles as string[])
          : [];
        pushIf(c, roles, "location");
      }
    } catch { /* best-effort */ }

    if (customerCompanyId) {
      try {
        const companyDir = await clientContactRepository.getCompanyDirectory(
          tenantId,
          customerCompanyId,
        );
        for (const p of companyDir) {
          const roles = Array.from(
            new Set(
              (p.assignments ?? []).flatMap((a: any) =>
                Array.isArray(a?.roles) ? (a.roles as string[]) : [],
              ),
            ),
          );
          pushIf(p, roles, "company");
        }
      } catch { /* best-effort */ }
    }

    res.json({ contacts });
  }),
);

// GET /api/invoices/:id/available-images — System-image picker source for
// the Send Invoice attachment flow. 2026-04-14. Returns image files already
// stored in the platform that are contextually related to this invoice:
//   1. job-note image attachments for the invoice's linked job (if any)
//   2. client-document image files for the invoice's location
// Deduped by fileId, uploaded-status only, `image/*` mime-types only.
router.get(
  "/:id/available-images",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId!;
    const invoiceId = req.params.id;

    const invoice = await storage.getInvoice(tenantId, invoiceId);
    if (!invoice) throw createError(404, "Invoice not found");

    const { db } = await import("../db");
    const { and, eq, inArray, like } = await import("drizzle-orm");
    const schema = await import("@shared/schema");

    type Row = {
      id: string;
      filename: string | null;
      mimeType: string | null;
      sizeBytes: number | null;
      source: "job_note" | "client_document";
    };
    const seen = new Set<string>();
    const images: Row[] = [];

    // 1. Job-note images for the invoice's linked job.
    const linkedJobId = (invoice as any).jobId as string | null | undefined;
    if (linkedJobId) {
      const jobNotes = await db
        .select({ id: schema.jobNotes.id })
        .from(schema.jobNotes)
        .where(
          and(
            eq(schema.jobNotes.jobId, linkedJobId),
            eq(schema.jobNotes.companyId, tenantId),
          ),
        );
      if (jobNotes.length > 0) {
        const noteIds = jobNotes.map((n) => n.id);
        const rows = await db
          .select({
            id: schema.files.id,
            filename: schema.files.originalName,
            mimeType: schema.files.mimeType,
            sizeBytes: schema.files.size,
          })
          .from(schema.jobNoteAttachments)
          .innerJoin(schema.files, eq(schema.jobNoteAttachments.fileId, schema.files.id))
          .where(
            and(
              inArray(schema.jobNoteAttachments.noteId, noteIds),
              eq(schema.jobNoteAttachments.companyId, tenantId),
              eq(schema.files.status, "uploaded"),
              like(schema.files.mimeType, "image/%"),
            ),
          );
        for (const r of rows) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          images.push({ ...r, source: "job_note" });
        }
      }
    }

    // 2. Client-document images for the invoice's location.
    const rows = await db
      .select({
        id: schema.files.id,
        filename: schema.files.originalName,
        mimeType: schema.files.mimeType,
        sizeBytes: schema.files.size,
      })
      .from(schema.clientFiles)
      .innerJoin(schema.files, eq(schema.clientFiles.fileId, schema.files.id))
      .where(
        and(
          eq(schema.clientFiles.clientId, invoice.locationId),
          eq(schema.clientFiles.companyId, tenantId),
          eq(schema.files.status, "uploaded"),
          like(schema.files.mimeType, "image/%"),
        ),
      );
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      images.push({ ...r, source: "client_document" });
    }

    res.json({ images });
  }),
);

// ============================================================================
// Phase 14 (2026-04-12): Batch send multiple invoices
// POST /api/invoices/batch-send
// ============================================================================
// Each invoice is dispatched independently through emailDispatchService.
// One PDF per invoice. One delivery record per invoice. Best-effort —
// per-invoice failures never abort the batch.
const batchSendInvoicesSchema = z.object({
  invoiceIds: z.array(z.string().uuid()).min(1, "At least one invoice required").max(50, "Maximum 50 invoices per batch"),
  recipientMode: z.enum(["defaults", "manual_override"]),
  manualRecipients: z.array(z.string().email()).optional(),
  subjectOverride: z
    .string()
    .optional()
    .refine((v) => v === undefined || v.trim().length > 0, { message: "subjectOverride cannot be blank" }),
  bodyOverride: z
    .string()
    .optional()
    .refine((v) => v === undefined || v.trim().length > 0, { message: "bodyOverride cannot be blank" }),
}).refine(
  (data) => data.recipientMode !== "manual_override" || (Array.isArray(data.manualRecipients) && data.manualRecipients.length > 0),
  { message: "manualRecipients required when recipientMode is 'manual_override'", path: ["manualRecipients"] },
);

router.post(
  "/batch-send",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const tenantId = req.companyId!;
    const data = validateSchema(batchSendInvoicesSchema, req.body ?? {});

    const result = await invoiceBatchSendService.batchSendInvoices({
      tenantId,
      invoiceIds: data.invoiceIds,
      recipientMode: data.recipientMode,
      manualRecipients: data.manualRecipients,
      subjectOverride: data.subjectOverride ?? null,
      bodyOverride: data.bodyOverride ?? null,
      createdByUserId: req.user?.id ?? null,
    });

    // Per-invoice event logging happens inside the dispatch service's
    // tracking row; we emit a single summary event for the batch action.
    logEventAsync(getQueryCtx(req), {
      eventType: "invoice.batch_send",
      entityType: "invoice",
      // Use the first id as the anchor; full id list is in `meta`.
      entityId: data.invoiceIds[0],
      summary: `Batch send: ${result.successCount} sent / ${result.failureCount} failed (${data.invoiceIds.length} selected)`,
      meta: {
        recipientMode: data.recipientMode,
        invoiceIds: data.invoiceIds,
        successCount: result.successCount,
        failureCount: result.failureCount,
      },
    });

    res.json(result);
  }),
);

// POST /api/invoices/:id/send - Send invoice email, THEN transition status.
// Phase 4 correction (2026-04-12):
//   1. validate input
//   2. render + PDF + Resend (via emailDispatchService)
//   3. ONLY on success: persist invoice status transition
//   4. log invoice.sent event
//   5. return updated invoice + dispatch summary
// Phase 5: supports subjectOverride / bodyOverride (one-time, ephemeral).
router.post("/:id/send", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const tenantId = req.companyId!;
  const invoiceId = req.params.id;

  // ── 1. Validate request body ─────────────────────────────────────────────
  const {
    recipients,
    cc,
    subjectOverride,
    bodyOverride,
    attachPdf,
    attachmentFileIds,
  } = validateSchema(sendInvoiceBodySchema, req.body ?? {});

  // Parse QBO override from body
  const overrideQboLock = req.body?.overrideQboLock === true;
  const overrideReason = typeof req.body?.overrideReason === 'string' ? req.body.overrideReason : undefined;

  // ── 2. Pre-dispatch invoice-state checks (no mutation yet) ───────────────
  // Single fetch of the canonical invoice row; passed into downstream service
  // calls implicitly via the `invoiceId` + tenant (dispatch fetches its own
  // for PDF details, which is acceptable — one extra read but zero drift).
  const invoice = await storage.getInvoice(tenantId, invoiceId);
  if (!invoice) {
    throw createError(404, "Invoice not found");
  }

  // 2026-04-14: a re-send on an already-billable invoice is a
  // communication action, not a lifecycle transition. Statuses that are
  // already past "draft" and not terminal (paid / voided) skip the
  // transition assertion AND skip the post-dispatch status mutation —
  // we still stamp `sentAt` so the UI's "Email sent" row tracks the
  // most recent send. Terminal states are blocked by retaining the
  // assertion in the else branch.
  const RESENDABLE_STATES = new Set<InvoiceStatus>([
    "awaiting_payment",
    "partial_paid",
    "sent", // legacy status alias for awaiting_payment
  ]);
  const isResend = RESENDABLE_STATES.has(invoice.status as InvoiceStatus);

  if (!isResend) {
    try {
      assertInvoiceStatusTransition(invoice.status as InvoiceStatus, "awaiting_payment");
    } catch (error: any) {
      throw createError(400, error.message);
    }
  }

  const errors = validateSendRequirements(invoice);
  if (errors.length > 0) {
    throw createError(400, `Cannot send invoice: ${errors.join(", ")}`);
  }

  if (overrideQboLock) {
    requireQboOverrideReason(overrideQboLock, overrideReason);
  }
  checkQboBillingLock(invoice, { status: 'awaiting_payment' }, { overrideQboLock, overrideReason });

  // ── 3. Dispatch email + atomically transition invoice state ──────────────
  // Phase 4 correction: if email fails, invoice must NOT be marked sent.
  // 2026-04-14 Phase D atomicity: the invoice status update runs inside
  // the same DB transaction as `markSent` via the afterMarkSent callback.
  // Either both the delivery flip and the invoice update commit, or
  // neither — closing the orphan window where the delivery was `sent`
  // but the invoice was still `draft`.
  let updated: Awaited<ReturnType<typeof storage.updateInvoice>> = null;
  let warning: string | undefined;

  const dispatch = await emailDispatchService.sendInvoiceEmail({
    tenantId,
    invoiceId,
    recipients,
    cc,
    subjectOverride,
    bodyOverride,
    attachPdf,
    attachmentFileIds,
    createdByUserId: req.user?.id ?? null,
    afterMarkSent: async (tx) => {
      const now = new Date();
      // For a first send (draft → awaiting_payment) we set status + sentAt +
      // sentByUserId. For a re-send on an already-billable invoice we ONLY
      // stamp the latest sentAt + sentByUserId; status stays as-is so we
      // don't trip lifecycle invariants on a no-op transition.
      let updatePayload: Record<string, unknown> = isResend
        ? { sentAt: now, sentByUserId: req.user?.id }
        : { status: "awaiting_payment", sentAt: now, sentByUserId: req.user?.id };

      if (!invoice.issuedAt) {
        updatePayload.issuedAt = now;
      }

      // 2026-03-19: canonical due-date computation when absent.
      if (!invoice.dueDate) {
        const issuedAt = invoice.issuedAt ? new Date(invoice.issuedAt) : now;
        const paymentTermsDays = invoice.paymentTermsDays ?? 30;
        updatePayload.dueDate = calculateDueDate(issuedAt, paymentTermsDays);
      }

      if (isQboSynced(invoice) && overrideQboLock && overrideReason) {
        const outOfSyncUpdate = buildOutOfSyncUpdate(overrideReason, req.user?.id);
        updatePayload = { ...updatePayload, ...outOfSyncUpdate };
        logQboLockOverride(tenantId, invoiceId, req.user?.id ?? 'unknown', 'send_invoice', overrideReason, invoice.qboInvoiceId);
        warning = "Invoice is now out of sync with QuickBooks. Manual reconciliation required.";
      }

      updated = await storage.updateInvoice(
        tenantId,
        invoiceId,
        undefined,
        updatePayload,
        tx,
      );
    },
  });

  // Phase 1: Log invoice sent event
  logEventAsync(getQueryCtx(req), {
    eventType: "invoice.sent",
    entityType: "invoice",
    entityId: req.params.id,
    summary: `Invoice #${invoice.invoiceNumber} sent`,
    meta: {
      invoiceNumber: invoice.invoiceNumber,
      recipients: dispatch.recipients,
      resendId: dispatch.emailId,
    },
  });

  const response: Record<string, unknown> = {
    ...updated,
    dispatch: {
      emailId: dispatch.emailId,
      recipients: dispatch.recipients,
      subject: dispatch.subject,
      attachmentFilename: dispatch.attachmentFilename,
    },
  };
  if (warning) {
    response._qboWarning = warning;
  }
  res.json(response);
}));

// ─────────────────────────────────────────────────────────────────────
// Reminder routes (2026-04-16)
// ─────────────────────────────────────────────────────────────────────

const sendReminderSchema = z.object({
  recipients: z.array(z.string().email()).min(1).max(20).optional(),
}).strict().optional();

const patchRemindersSchema = z.object({
  paused: z.boolean().optional(),
  snoozeUntil: z.string().datetime().nullable().optional(),
}).strict();

// POST /api/invoices/:id/send-reminder
// Manually trigger a reminder. Shares the exact canonical path (gates,
// dispatch, PDF, delivery row, counter bump) with the sweep worker —
// see invoiceReminderService.sendOne.
router.post(
  "/:id/send-reminder",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const parsed = sendReminderSchema?.safeParse(req.body ?? {});
    const body = parsed && parsed.success ? parsed.data : undefined;
    try {
      const result = await invoiceReminderService.sendOne({
        tenantId: req.companyId!,
        invoiceId: req.params.id,
        recipients: body?.recipients,
        createdByUserId: req.user?.id ?? null,
      });
      res.json(result);
    } catch (err: any) {
      if (err instanceof ReminderGateError) {
        throw createError(err.status, err.message, err.code);
      }
      throw err;
    }
  }),
);

// PATCH /api/invoices/:id/reminders — pause / resume / snooze
router.patch(
  "/:id/reminders",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const data = validateSchema(patchRemindersSchema, req.body ?? {});
    const invoice = await storage.getInvoice(req.companyId!, req.params.id);
    if (!invoice) throw createError(404, "Invoice not found");

    // Two forms of pausing, both via the same storage helper.
    if (data.paused !== undefined || data.snoozeUntil !== undefined) {
      await invoiceRepository.setRemindersPaused(
        req.companyId!,
        req.params.id,
        data.paused === true,
        data.snoozeUntil ? new Date(data.snoozeUntil) : null,
      );
    }

    const updated = await storage.getInvoice(req.companyId!, req.params.id);
    res.json({
      id: updated?.id,
      remindersPaused: updated?.remindersPaused ?? false,
      reminderSnoozeUntil: updated?.reminderSnoozeUntil ?? null,
      reminderCount: updated?.reminderCount ?? 0,
      lastReminderAt: updated?.lastReminderAt ?? null,
    });
  }),
);

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
      companyName: location.companyName ?? "",
      address: location.address,
      address2: location.address2,
      city: location.city,
      provinceState: location.province,
      postalCode: location.postalCode,
      phone: location.phone,
      email: location.email,
    },
    customerCompany: customerCompany ? { name: customerCompany.name ?? "" } : null,
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
