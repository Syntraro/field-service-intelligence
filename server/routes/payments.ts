/**
 * Payment Routes
 *
 * Handles payment CRUD operations for invoices.
 * Payments auto-update invoice balance and status.
 */

import { Router, Response } from "express";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
// 2026-05-04 PR 4: fine permission gates added BEHIND existing role
// gates per the two-layer model in CLAUDE.md. `payments.view` on
// reads, `payments.collect` on create/update/reversal/delete. Refunds
// intentionally stay on the role gate only — refunds are not
// tenant-customizable yet (see ACCESS_CONTROL_MATRIX.md §5).
import { requirePermission } from "../permissions";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest, rateLimitPerTenant } from "../auth/tenantIsolation";
import { paymentRepository } from "../storage/payments";
import { invoiceRepository } from "../storage/invoices";
import { isInvoicePaid } from "../lib/invoicePredicates";
import {
  paymentMethodEnum,
  payments as paymentsTable,
  invoices as invoicesTable,
  customerCompanies as customerCompaniesTable,
} from "@shared/schema";
import { UNPAID_INVOICE_STATUSES } from "@shared/invoiceStatus";
import { db } from "../db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { logEventAsync } from "../lib/events";
import { getQueryCtx } from "../lib/queryCtx";
// 2026-04-09: Outbound QBO payment sync — fire-and-forget hook called AFTER
// canonical local reconciliation. Helper enforces the company toggle, never
// throws, never mutates invoice financial state. See locked product decisions
// in maybeSyncPayment.ts and QboPaymentService.ts.
import { maybeSyncPaymentToQbo } from "../services/qbo/maybeSyncPayment";
// 2026-04-21 provider-neutral seam. Routes do auth + validation + call the
// application service. Stripe SDK usage lives only behind the Stripe adapter.
import { paymentApplicationService } from "../services/payments/paymentApplicationService";
// 2026-05-06 PR2: receipt email wiring for the manual Collect Payment
// flow. `sendMultiInvoicePaymentReceiptEmail` handles BOTH single- and
// multi-allocation receipts (the template builder loads allocations off
// the payment row, so a one-allocation manual payment renders cleanly).
import { emailDispatchService } from "../services/emailDispatchService";

const router = Router();

// ========================================
// VALIDATION SCHEMAS
// ========================================

const createPaymentSchema = z
  .object({
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid amount format"),
    method: z.enum(paymentMethodEnum),
    reference: z.string().max(100).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    receivedAt: z.string().datetime().optional(),
  })
  .strict();

const updatePaymentSchema = z
  .object({
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    method: z.enum(paymentMethodEnum).optional(),
    reference: z.string().max(100).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    receivedAt: z.string().datetime().optional(),
  })
  .strict();

// ========================================
// ROUTES
// ========================================

// ========================================
// PROVIDER-NEUTRAL CHECKOUT (staff)
// ========================================
// POST /api/invoices/:invoiceId/payments/checkout
// Issues a provider-neutral checkout token for an invoice. Replaces
// the provider-named /stripe/payment-intent route (kept live as a
// forwarder). Response contract is the same for every future provider;
// only the `providerId` + `clientToken` semantics differ.
//
// 2026-04-29 Stripe completion: rate limiter mirrors the portal
// `portal-payment-intent` cap. Staff is authenticated and trusted, but
// every call mints a new Stripe PaymentIntent (a real provider cost).
// 12/min/tenant is double the portal allowance — generous for legitimate
// retries from a busy office while still capping scripted abuse if a
// session is compromised.
const staffPaymentCheckoutLimiter = rateLimitPerTenant({
  scope: "staff-payment-checkout",
  windowMs: 60_000,
  max: 12,
});

const checkoutSchema = z
  .object({
    amount: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, "Invalid amount format")
      .optional(),
    currency: z.string().length(3).optional(),
  })
  .strict();

router.post(
  "/invoices/:invoiceId/payments/checkout",
  requireRole(MANAGER_ROLES),
  requirePermission("payments.collect"),
  staffPaymentCheckoutLimiter,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { amount, currency } = validateSchema(checkoutSchema, req.body ?? {});
    const result = await paymentApplicationService.createCheckout({
      companyId: req.companyId!,
      invoiceId: req.params.invoiceId,
      source: "staff",
      amount,
      currency,
    });
    res.status(201).json(result);
  }),
);

// ========================================
// COLLECT PAYMENT (provider-neutral, multi-invoice)
// 2026-05-06
// ========================================
//
// Two endpoints power the staff "Collect Payment" flow:
//
//   GET  /api/invoices/:invoiceId/collect-payment-context
//        Returns the data the modal needs in one round trip:
//          - the source invoice (for header context + preselected row)
//          - the customer company
//          - every UNPAID invoice for that customer company
//            (the source invoice is included by design)
//          - account balance (sum of unpaid invoice balances)
//          - supported payment methods (from the schema enum)
//
//   POST /api/payments
//        Body: { customerCompanyId, method, transactionDate, reference,
//                notes, allocations: [{invoiceId, amount}], emailReceipt }
//        Creates ONE payment row (invoiceId=null, providerSource=manual)
//        + N allocation rows + per-invoice balance/status updates,
//        atomically. emailReceipt is best-effort; receipt-mailer wiring
//        for the manual path is a follow-up.
//
// The Stripe staff "Take card payment" path
// (`/api/invoices/:invoiceId/payments/checkout`) is NOT touched. Staff
// can still mount that flow from the overflow menu when they want to
// charge a card directly. This endpoint is for cash / cheque / e-transfer
// / debit / external-card / other manual entry.

router.get(
  "/invoices/:invoiceId/collect-payment-context",
  requireRole(MANAGER_ROLES),
  requirePermission("payments.collect"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const sourceInvoiceId = req.params.invoiceId;

    const sourceInvoice = await invoiceRepository.getInvoice(companyId, sourceInvoiceId);
    if (!sourceInvoice) throw createError(404, "Invoice not found");

    if (!sourceInvoice.customerCompanyId) {
      // Standalone-location invoices have no parent customer company —
      // they can still take a single-invoice manual payment, but the
      // multi-invoice picker is not meaningful. Return an empty list
      // alongside the source invoice so the dialog renders correctly
      // and only the source row is selectable.
      // 2026-05-06 — pre-resolve recipient so the dialog can disable
      // "Save and Email Receipt" upfront when no billing email is on
      // file. We resolve the SAME way the receipt mailer will resolve
      // it — `recipientResolverService.getDefaultRecipients` keyed by
      // entityType "payment_receipt" — so the upfront UI signal is
      // truthful.
      const billingEmail = await resolveBillingEmail(companyId, sourceInvoiceId);
      res.json({
        sourceInvoiceId,
        customerCompany: null,
        invoices: [
          {
            id: sourceInvoice.id,
            invoiceNumber: sourceInvoice.invoiceNumber,
            status: sourceInvoice.status,
            issueDate: sourceInvoice.issueDate,
            dueDate: sourceInvoice.dueDate,
            total: sourceInvoice.total,
            amountPaid: sourceInvoice.amountPaid,
            balance: sourceInvoice.balance,
            locationId: sourceInvoice.locationId,
          },
        ],
        accountBalance: sourceInvoice.balance ?? "0.00",
        supportedMethods: paymentMethodEnum,
        billingEmail,
      });
      return;
    }

    const [customerCompany] = await db
      .select()
      .from(customerCompaniesTable)
      .where(
        and(
          eq(customerCompaniesTable.id, sourceInvoice.customerCompanyId),
          eq(customerCompaniesTable.companyId, companyId),
        ),
      )
      .limit(1);

    // All UNPAID invoices for this customer company. Filters in SQL via
    // (a) the canonical UNPAID statuses set, (b) balance > 0, (c) tenant
    // scope, (d) customer-company scope. The source invoice is naturally
    // included if it is itself unpaid.
    const unpaidRows = await db
      .select({
        id: invoicesTable.id,
        invoiceNumber: invoicesTable.invoiceNumber,
        status: invoicesTable.status,
        issueDate: invoicesTable.issueDate,
        dueDate: invoicesTable.dueDate,
        total: invoicesTable.total,
        amountPaid: invoicesTable.amountPaid,
        balance: invoicesTable.balance,
        locationId: invoicesTable.locationId,
      })
      .from(invoicesTable)
      .where(
        and(
          eq(invoicesTable.companyId, companyId),
          eq(invoicesTable.customerCompanyId, sourceInvoice.customerCompanyId),
          inArray(invoicesTable.status, UNPAID_INVOICE_STATUSES),
          sql`CAST(${invoicesTable.balance} AS numeric) > 0`,
        ),
      )
      .orderBy(invoicesTable.dueDate);

    // Defensive: if the source invoice itself isn't in the unpaid set
    // (e.g. paid already) but the user still hit this endpoint, fold
    // it in so the dialog can show "this invoice has nothing left to
    // collect" without crashing.
    const found = unpaidRows.some((r) => r.id === sourceInvoiceId);
    if (!found) {
      unpaidRows.unshift({
        id: sourceInvoice.id,
        invoiceNumber: sourceInvoice.invoiceNumber,
        status: sourceInvoice.status,
        issueDate: sourceInvoice.issueDate,
        dueDate: sourceInvoice.dueDate,
        total: sourceInvoice.total,
        amountPaid: sourceInvoice.amountPaid,
        balance: sourceInvoice.balance,
        locationId: sourceInvoice.locationId,
      });
    }

    const accountBalance = unpaidRows
      .reduce((sum, r) => sum + parseFloat(r.balance ?? "0"), 0)
      .toFixed(2);

    const billingEmail = await resolveBillingEmail(companyId, sourceInvoiceId);

    res.json({
      sourceInvoiceId,
      customerCompany: customerCompany
        ? { id: customerCompany.id, name: customerCompany.name }
        : null,
      invoices: unpaidRows,
      accountBalance,
      supportedMethods: paymentMethodEnum,
      billingEmail,
    });
  }),
);

/**
 * 2026-05-06 — pre-resolve the billing email the receipt mailer would
 * use, so the Collect Payment dialog can disable "Save and Email
 * Receipt" upfront. Returns the FIRST resolvable address, or null when
 * the canonical resolver returns nothing (e.g. customer has no billing
 * contact + no invoice-level billing_email override).
 *
 * NOTE: this is a READ-ONLY hint. The actual receipt dispatch goes
 * through the same resolver at send time, so a stale billing record
 * after the dialog opens degrades gracefully — the worst case is we
 * disabled the email button but the address is on file by send time
 * (the operator simply re-opens the dialog).
 */
async function resolveBillingEmail(
  companyId: string,
  invoiceId: string,
): Promise<string | null> {
  try {
    const { recipientResolverService } = await import(
      "../services/recipientResolverService"
    );
    const resolved = await recipientResolverService.getDefaultRecipients({
      tenantId: companyId,
      entityType: "payment_receipt",
      entityId: invoiceId,
    });
    return resolved.recipients[0] ?? null;
  } catch {
    // Resolver failure is non-fatal here — the dialog handles a null
    // result by treating the email button as unavailable, which is
    // strictly safer than enabling it and discovering the failure at
    // send time.
    return null;
  }
}

const collectPaymentSchema = z
  .object({
    customerCompanyId: z.string().uuid(),
    method: z.enum(paymentMethodEnum),
    transactionDate: z.string().datetime().optional(),
    reference: z.string().max(100).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    allocations: z
      .array(
        z.object({
          invoiceId: z.string().uuid(),
          amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid amount format"),
        }),
      )
      .min(1, "At least one invoice allocation is required"),
    emailReceipt: z.boolean().optional(),
  })
  .strict();

// 2026-05-06 — Inline-Elements multi-invoice card payment intent.
// Distinct from the existing single-invoice /payments/checkout (which
// charges a single invoice's full balance). The Collect Payment dialog
// posts here when the operator picks Credit Card. The service mints a
// Stripe PaymentIntent for the SUM of allocations and packs the
// allocation breakdown into Stripe metadata; the webhook handler is
// the canonical writer (one payment row + N allocations).
const cardIntentSchema = z
  .object({
    customerCompanyId: z.string().uuid(),
    allocations: z
      .array(
        z.object({
          invoiceId: z.string().uuid(),
          amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid amount format"),
        }),
      )
      .min(1, "At least one allocation is required"),
    currency: z.string().length(3).optional(),
  })
  .strict();

const cardIntentLimiter = rateLimitPerTenant({
  scope: "staff-card-intent",
  windowMs: 60_000,
  max: 12,
});

router.post(
  "/payments/card-intent",
  requireRole(MANAGER_ROLES),
  requirePermission("payments.collect"),
  cardIntentLimiter,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const validated = validateSchema(cardIntentSchema, req.body ?? {});

    const result = await paymentApplicationService.createCardIntentWithAllocations({
      companyId,
      customerCompanyId: validated.customerCompanyId,
      allocations: validated.allocations,
      source: "staff",
      currency: validated.currency,
    });

    res.status(201).json(result);
  }),
);

router.post(
  "/payments",
  requireRole(MANAGER_ROLES),
  requirePermission("payments.collect"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const validated = validateSchema(collectPaymentSchema, req.body);

    // Storage layer enforces tenant + customer-scope + status + per-allocation
    // amount-vs-balance invariants atomically.
    const result = await paymentRepository.createManualMultiInvoicePayment(
      companyId,
      {
        customerCompanyId: validated.customerCompanyId,
        method: validated.method,
        reference: validated.reference ?? null,
        notes: validated.notes ?? null,
        receivedAt: validated.transactionDate,
        allocations: validated.allocations.map((a) => ({
          invoiceId: a.invoiceId,
          allocatedAmount: a.amount,
        })),
        createdByUserId: req.user?.id ?? null,
      },
    );

    // Lifecycle event — fires once per invoice that hit `paid` because
    // of this payment, mirroring the legacy single-invoice flow.
    for (const inv of result.invoices) {
      if (isInvoicePaid(inv.status)) {
        logEventAsync(getQueryCtx(req), {
          eventType: "invoice.paid",
          entityType: "invoice",
          entityId: inv.id,
          summary: `Invoice #${inv.invoiceNumber} fully paid`,
          meta: {
            invoiceNumber: inv.invoiceNumber,
            paymentId: result.payment.id,
            method: validated.method,
            multiInvoice: result.invoices.length > 1,
          },
        });
      }
    }

    // 2026-05-06 PR2 — receipt email dispatch. We use the canonical
    // `sendMultiInvoicePaymentReceiptEmail({ tenantId, paymentId })`
    // because manual payments ALWAYS write `payments.invoiceId = NULL`
    // + N allocation rows (even for single-invoice manual entries), so
    // the multi-invoice template builder is the right surface for both
    // 1-allocation and N-allocation receipts. The single-invoice
    // `sendPaymentReceiptEmail({ invoiceId })` would be the wrong call
    // here — its template builder reads payment.amount off the payment
    // row keyed by `payments.invoiceId`, which is null on this path.
    //
    // Failure policy mirrors the Stripe webhook receipt path: the
    // payment row + allocations + balance updates have ALREADY committed
    // when we get here, so a Resend failure must NOT roll any of that
    // back. We catch every throw, surface it on the response as
    // `receiptEmailQueued: false` + `receiptEmailReason`, and continue.
    // The customer can be re-emailed later via the canonical email
    // history retry path.
    let receiptEmailQueued = false;
    let receiptEmailReason: "not_requested" | "no_recipient" | "send_failed" | null = null;
    let receiptEmailMessageId: string | null = null;
    let receiptEmailErrorMessage: string | null = null;

    if (validated.emailReceipt === true) {
      try {
        const sendResult = await emailDispatchService.sendMultiInvoicePaymentReceiptEmail({
          tenantId: companyId,
          paymentId: result.payment.id,
        });
        if (sendResult === null) {
          // No recipient resolved — `getDefaultRecipients` returned
          // empty and the caller did not pass an explicit override.
          receiptEmailQueued = false;
          receiptEmailReason = "no_recipient";
        } else {
          receiptEmailQueued = true;
          receiptEmailMessageId = sendResult.emailId;
          receiptEmailReason = null;
        }
      } catch (err: any) {
        // Resend transport error / template render failure / etc. The
        // payment is committed, so we log and surface the failure on
        // the response without bubbling.
        receiptEmailQueued = false;
        receiptEmailReason = "send_failed";
        receiptEmailErrorMessage = err?.message ?? "Receipt send failed";
        // eslint-disable-next-line no-console
        console.error(
          JSON.stringify({
            event: "manual_payment.receipt_send_failed",
            companyId,
            paymentId: result.payment.id,
            error: receiptEmailErrorMessage,
            timestamp: new Date().toISOString(),
          }),
        );
      }
    } else {
      receiptEmailReason = "not_requested";
    }

    res.status(201).json({
      payment: result.payment,
      invoices: result.invoices,
      receiptEmailRequested: validated.emailReceipt === true,
      receiptEmailQueued,
      receiptEmailReason,
      receiptEmailMessageId,
      // Only included when send_failed — gives the UI a human-readable
      // hint without blowing up the response shape on success.
      receiptEmailError: receiptEmailErrorMessage,
    });
  }),
);

// GET /api/invoices/:invoiceId/payments - List payments for invoice
router.get(
  "/invoices/:invoiceId/payments",
  requirePermission("payments.view"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const payments = await paymentRepository.getPayments(
      req.companyId!,
      req.params.invoiceId
    );
    res.json(payments);
  })
);

// POST /api/invoices/:invoiceId/payments - Create payment
router.post(
  "/invoices/:invoiceId/payments",
  requireRole(MANAGER_ROLES),
  requirePermission("payments.collect"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const validated = validateSchema(createPaymentSchema, req.body);

    try {
      const payment = await paymentRepository.createPayment(
        req.companyId!,
        req.params.invoiceId,
        validated
      );

      // 2026-03-20 Phase 4A: Emit invoice.paid event if payment caused fully-paid status
      const postPaymentInvoice = await invoiceRepository.getInvoice(req.companyId!, req.params.invoiceId);
      if (postPaymentInvoice && isInvoicePaid(postPaymentInvoice.status)) {
        logEventAsync(getQueryCtx(req), {
          eventType: "invoice.paid",
          entityType: "invoice",
          entityId: req.params.invoiceId,
          summary: `Invoice #${postPaymentInvoice.invoiceNumber} fully paid`,
          meta: { invoiceNumber: postPaymentInvoice.invoiceNumber, paymentId: payment.id },
        });
      }

      res.status(201).json(payment);

      // 2026-04-09: Outbound QBO payment sync — fire-and-forget AFTER local
      // canonical reconciliation has already committed (paymentRepository.createPayment
      // wraps insert + recalculateInvoiceBalance in a transaction). The helper checks
      // companies.qboPaymentSyncEnabled internally; when disabled this is a quiet no-op.
      // The sync runs after the HTTP response is sent so a slow QBO call cannot
      // block the user. Errors surface on payments.qboSyncStatus, not via res.
      void maybeSyncPaymentToQbo(req.companyId!, payment.id, "create", req.user?.id);
    } catch (error: any) {
      if (error.statusCode) throw error;
      if (error.message?.includes("Cannot add payment")) {
        throw createError(400, error.message);
      }
      throw error;
    }
  })
);

// GET /api/payments/:id - Get single payment
router.get(
  "/payments/:id",
  requirePermission("payments.view"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    // Would need a getPayment method - for now redirect to list
    throw createError(501, "Get single payment not implemented");
  })
);

// PATCH /api/payments/:id - Update payment
router.patch(
  "/payments/:id",
  requireRole(MANAGER_ROLES),
  requirePermission("payments.collect"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const validated = validateSchema(updatePaymentSchema, req.body);

    try {
      const payment = await paymentRepository.updatePayment(
        req.companyId!,
        req.params.id,
        validated
      );

      res.json(payment);

      // 2026-04-09: Outbound QBO payment sync — mirror the local edit to QBO
      // after the response is sent. updatePayment in QboPaymentService falls
      // through to createPayment if the row was never synced before, so this
      // safely handles both first-sync and re-sync.
      void maybeSyncPaymentToQbo(req.companyId!, req.params.id, "update", req.user?.id);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw error;
    }
  })
);

// =============================================================================
// 2026-04-14 Payments Phase 2: refund + reversal writers.
//
// POST /api/payments/:id/refund   — money returned to customer
// POST /api/payments/:id/reversal — valid payment that didn't actually
//                                   happen (NSF, bounced cheque, stopped ACH)
//
// Both create a new ledger row attached to the parent payment via
// `parentPaymentId`. Same role gate as payment create. No QBO sync yet
// (Phase 2 rule 7 — QBO RefundReceipt sync lands in a follow-up).
// =============================================================================

const adjustmentSchema = z
  .object({
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid amount format"),
    method: z.enum(paymentMethodEnum).optional(),
    reference: z.string().max(100).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    receivedAt: z.string().datetime().optional(),
    // 2026-04-21 provider refunds: optional structured reason passed to
    // the provider adapter (ignored for manual rows). Free-text notes
    // continue via `notes`.
    reason: z.string().max(200).nullable().optional(),
  })
  .strict();

// POST /api/payments/:id/refund - Create a refund attached to a parent payment
//
// 2026-04-21 provider-neutral refund flow + hardening:
//   Delegates to paymentApplicationService.refundPayment, which returns
//   a discriminated union:
//     - `settled`                → 201 with the ledger row (normal path).
//     - `reconciliation_pending` → 202 with a structured body telling
//       the caller "provider has the refund, ledger backfill pending".
//       Returned only when Stripe has definitely moved money but the
//       ledger insert failed for a non-unique reason (DB blip, etc.).
//       A subsequent retry with the same arguments CANNOT cause a
//       second Stripe refund — the service uses a deterministic Stripe
//       idempotency key derived from the request shape, so Stripe
//       collapses retries to a single refund object.
router.post(
  "/payments/:id/refund",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const validated = validateSchema(adjustmentSchema, req.body);
    const result = await paymentApplicationService.refundPayment({
      companyId: req.companyId!,
      parentPaymentId: req.params.id,
      amount: validated.amount,
      method: validated.method,
      reference: validated.reference,
      notes: validated.notes,
      reason: validated.reason ?? null,
    });

    if (result.kind === "reconciliation_pending") {
      // 202 Accepted — request received and the external effect (the
      // refund at Stripe) has been applied, but the server hasn't yet
      // persisted the canonical record. The webhook will reconcile.
      res.status(202).json({
        status: "reconciliation_pending",
        message: "Refund issued. Reconciliation pending.",
        refundLedgerId: result.refundLedgerId,
        providerRefundId: result.providerRefundId,
        providerSource: result.providerSource,
      });
      return;
    }

    const refund = result.row;
    // Refunds/reversals are always children of legacy 1:1 payments, so they
    // inherit a non-null invoiceId from the parent (see
    // PaymentRepository.createLedgerAdjustment). The fallback to the empty
    // string keeps TS quiet for the new nullable column type without
    // changing any existing behavior.
    logEventAsync(getQueryCtx(req), {
      eventType: "invoice.refunded",
      entityType: "invoice",
      entityId: refund.invoiceId ?? "",
      summary: `Refund recorded on invoice`,
      meta: {
        refundId: refund.id,
        parentPaymentId: refund.parentPaymentId,
        amount: refund.amount,
        method: refund.method,
        reference: refund.reference,
        providerSource: refund.providerSource,
      },
    });
    res.status(201).json(refund);
  }),
);

// POST /api/payments/:id/reversal - Create a reversal attached to a parent payment
router.post(
  "/payments/:id/reversal",
  requireRole(MANAGER_ROLES),
  requirePermission("payments.collect"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const validated = validateSchema(adjustmentSchema, req.body);
    try {
      const reversal = await paymentRepository.createReversal(
        req.companyId!,
        req.params.id,
        validated,
      );
      logEventAsync(getQueryCtx(req), {
        eventType: "invoice.payment_reversed",
        entityType: "invoice",
        // See refund handler above — reversals inherit the parent's invoiceId.
        entityId: reversal.invoiceId ?? "",
        summary: `Payment reversed on invoice`,
        meta: {
          reversalId: reversal.id,
          parentPaymentId: reversal.parentPaymentId,
          amount: reversal.amount,
          method: reversal.method,
          reference: reversal.reference,
        },
      });
      res.status(201).json(reversal);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw error;
    }
  }),
);

// DELETE /api/payments/:id - Delete payment
router.delete(
  "/payments/:id",
  requireRole(MANAGER_ROLES),
  requirePermission("payments.collect"),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    try {
      // 2026-04-09: Snapshot the payment row BEFORE the local delete so the
      // outbound QBO void call can read qboPaymentId / qboSyncToken (which
      // are gone after delete). We pass the snapshot through to the helper.
      // Tenant-isolated by companyId. If the row doesn't exist, paymentRepository
      // will throw notFound below — keep the existing behavior intact.
      const [snapshot] = await db
        .select()
        .from(paymentsTable)
        .where(
          and(
            eq(paymentsTable.id, req.params.id),
            eq(paymentsTable.companyId, req.companyId!),
          ),
        )
        .limit(1);

      await paymentRepository.deletePayment(req.companyId!, req.params.id);
      res.json({ success: true });

      // Fire QBO void after local delete commits. If snapshot is missing the
      // helper logs a skip and exits cleanly — no throw can leak from here.
      if (snapshot) {
        void maybeSyncPaymentToQbo(
          req.companyId!,
          req.params.id,
          "delete",
          req.user?.id,
          snapshot,
        );
      }
    } catch (error: any) {
      if (error.statusCode) throw error;
      if (error.message?.includes("Cannot delete payments")) {
        throw createError(400, error.message);
      }
      throw error;
    }
  })
);

export default router;
