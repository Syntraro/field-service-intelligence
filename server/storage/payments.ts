/**
 * Payment Repository
 *
 * Handles payment CRUD operations with automatic invoice balance recalculation.
 * Auto-updates invoice status to partial_paid or paid based on balance.
 */

import { db } from "../db";
import { eq, and, sql, desc, gte, lte } from "drizzle-orm";
import { payments, invoices, customerCompanies } from "@shared/schema";
import { BaseRepository } from "./base";
import type { InvoiceStatus, PaymentType } from "@shared/schema";
import { canAcceptInvoicePayment, isInvoiceVoided } from "../lib/invoicePredicates";
import { isProviderLinked } from "../lib/paymentPredicates";
import { createError } from "../middleware/errorHandler";

/**
 * 2026-04-14 Payments Phase 2: window for hard-delete of a "data entry
 * error" payment. Outside this window the row must be reversed via a
 * `paymentType='reversal'` child row instead. 30 days matches the
 * decision memo's canonical value.
 */
export const DELETE_WINDOW_DAYS = 30;

// 2026-05-03 multi-invoice payments (PR 1): `payments.invoiceId` is now
// nullable to support multi-invoice payment rows that rely entirely on
// `payment_allocations`. Every legacy 1:1 path in this file still loads
// a payment and uses its `invoiceId` directly. Until those paths are
// teach-aware (PR 2+), narrow null-checks at the use sites keep TS
// honest and surface a real error if a multi-invoice payment ever
// reaches the legacy path.
function assertLegacyInvoiceId(invoiceId: string | null, paymentId: string): string {
  if (!invoiceId) {
    throw new Error(
      `Payment ${paymentId} has no invoice_id (multi-invoice payment). ` +
        `Legacy 1:1 path invoked on a multi-invoice payment — use payment_allocations.`,
    );
  }
  return invoiceId;
}

/**
 * 2026-04-14 Payments Phase 2: input shape for refund / reversal
 * writers. `amount` is the positive absolute value; the storage layer
 * negates before insert.
 *
 * 2026-04-14 Stripe Phase 1: optional system-managed fields so the
 * Stripe webhook handler can pre-set the row id, provider source, and
 * provider event id on webhook-driven inserts. Every field is OPTIONAL
 * — the manual-entry route caller continues to omit them and the row
 * lands with schema defaults (providerSource='manual', etc.). Never
 * user-input: `insertPaymentSchema` strips these fields at the Zod
 * boundary.
 */
export interface AdjustmentInput {
  amount: string | number;
  method?: string;
  reference?: string | null;
  notes?: string | null;
  receivedAt?: string;
  id?: string;
  providerSource?: "manual" | "qbo" | "stripe";
  providerEventId?: string | null;
}

export class PaymentRepository extends BaseRepository {
  /**
   * Look up a payment by its `(providerSource, reference)` pair. Used by
   * the webhook dispatcher to resolve the parent of an externally-
   * initiated provider refund: the `reference` column carries the
   * provider charge id (e.g. Stripe `ch_...`) on rows the
   * `payment_intent.succeeded` webhook handler wrote.
   *
   * Returns the single matching row, or null. Companywide by design —
   * the webhook has no tenant context at this call site; tenant is
   * re-verified by the dispatcher using the row's `companyId`.
   */
  async findByProviderReference(
    providerSource: "stripe" | "qbo",
    reference: string,
  ) {
    const rows = await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.providerSource, providerSource),
          eq(payments.reference, reference),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * 2026-05-04 PR7 — tenant-level transactions list for the Payments
   * dashboard. Returns ONLINE (provider-source = `'stripe'`) payment
   * rows for the tenant, joined to customer-company display data.
   *
   * Why scoped to `provider_source = 'stripe'`: the dashboard's
   * Transactions tab is "online payments only" by design (manual
   * cash/cheque entries already surface on Invoice Detail; QBO-source
   * rows belong to the QBO sync console). Mixing them in here would
   * make the table noisy and the wording ambiguous.
   *
   * Provider-neutrality note: today Stripe is the only online
   * provider, so filtering by `provider_source IN ('stripe')` is
   * equivalent to "online". When a second adapter ships, this filter
   * widens; the Transactions tab wording stays "Online payments".
   *
   * Both top-level payment rows and refund/reversal children are
   * included — operators see the full ledger as it appears on a
   * statement. Sort: most-recent receivedAt first.
   *
   * NOT exposed:
   *   - provider_event_id / provider_payment_id / qbo_* columns —
   *     the dashboard surfaces only safe, customer-facing fields per
   *     PR7 spec.
   */
  async listOnlineTransactionsForCompany(
    companyId: string,
    filters: {
      from?: Date;
      to?: Date;
      status?: InvoiceStatus;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    this.assertCompanyId(companyId);

    const limit = clampTransactionsLimit(filters.limit);
    const offset = clampTransactionsOffset(filters.offset);

    const predicates = [
      eq(payments.companyId, companyId),
      eq(payments.providerSource, "stripe"),
    ];
    if (filters.from) {
      predicates.push(gte(payments.receivedAt, filters.from));
    }
    if (filters.to) {
      predicates.push(lte(payments.receivedAt, filters.to));
    }

    const rows = await db
      .select({
        id: payments.id,
        receivedAt: payments.receivedAt,
        invoiceId: payments.invoiceId,
        invoiceNumber: invoices.invoiceNumber,
        invoiceStatus: invoices.status,
        customerCompanyId: customerCompanies.id,
        customerCompanyName: customerCompanies.name,
        method: payments.method,
        amount: payments.amount,
        paymentType: payments.paymentType,
        parentPaymentId: payments.parentPaymentId,
        paymentProviderAccountId: payments.paymentProviderAccountId,
      })
      .from(payments)
      // 2026-05-04 PR7 — multi-invoice payments leave invoice_id NULL
      // (allocations table holds the breakdown). LEFT JOIN keeps those
      // rows in the result set with `invoiceNumber: null`; the UI
      // renders "Multi-invoice" in that case.
      .leftJoin(invoices, eq(invoices.id, payments.invoiceId))
      .leftJoin(
        customerCompanies,
        eq(customerCompanies.id, invoices.customerCompanyId),
      )
      .where(and(...predicates))
      .orderBy(desc(payments.receivedAt))
      .limit(limit)
      .offset(offset);

    // Optional invoice-status filter is applied in JS because the
    // join-source `invoices.status` may legitimately be null on
    // multi-invoice rows; a SQL predicate would silently exclude
    // those even when no status filter is set.
    const filtered = filters.status
      ? rows.filter((r) => r.invoiceStatus === filters.status)
      : rows;

    return filtered;
  }

  /**
   * Get all payments for an invoice
   */
  async getPayments(companyId: string, invoiceId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(invoiceId, "invoiceId");

    return await db
      .select()
      .from(payments)
      .where(
        and(eq(payments.companyId, companyId), eq(payments.invoiceId, invoiceId))
      )
      .orderBy(desc(payments.receivedAt));
  }

  /**
   * Create a payment and recalculate invoice balance
   * Auto-updates invoice status to partial_paid or paid based on balance
   */
  async createPayment(
    companyId: string,
    invoiceId: string,
    paymentData: {
      amount: string;
      method: string;
      reference?: string | null;
      notes?: string | null;
      receivedAt?: string;
      // 2026-04-14 Stripe Phase 1: optional system-managed fields used by
      // the Stripe webhook handler to pre-set the row id (== outbound
      // idempotency key) and provider attribution. The manual-entry
      // route caller (server/routes/payments.ts) continues to pass none
      // of these — they take schema defaults (providerSource='manual',
      // providerEventId=NULL, id=gen_random_uuid()). Never user-input.
      id?: string;
      providerSource?: "manual" | "qbo" | "stripe";
      providerEventId?: string | null;
      // 2026-05-03 PR4: connected-account attribution. Both fields
      // are system-managed by the webhook handler / off-session
      // payment writer; the manual-entry route never sets them.
      // `paymentProviderAccountId` is the local FK; `providerAccountId`
      // mirrors the provider's opaque id (Stripe `acct_...`) so refund
      // / cross-reference paths can avoid an extra join.
      paymentProviderAccountId?: string | null;
      providerAccountId?: string | null;
    }
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(invoiceId, "invoiceId");

    return await db.transaction(async (tx) => {
      // 1. Verify invoice exists and is payable
      const [invoice] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
        .limit(1);

      if (!invoice) {
        throw this.notFoundError("Invoice");
      }

      // Only allow payments on issued invoices: awaiting_payment (canonical),
      // sent (legacy alias), or partial_paid. Uses canonical predicate to avoid drift.
      if (!canAcceptInvoicePayment(invoice.status)) {
        throw this.validationError(
          `Cannot add payment to invoice with status "${invoice.status}". Invoice must be issued first.`
        );
      }

      // 2026-04-14 Phase 1 next-frontier: duplicate-payment pre-check.
      // When a reference is provided, a 409 is a friendlier surface for
      // the same rule the DB `payments_company_invoice_reference_uq`
      // partial unique index enforces authoritatively. Cash/other
      // payments without a reference bypass both guards by design.
      const trimmedReference = paymentData.reference?.trim() ?? "";
      if (trimmedReference.length > 0) {
        const [existing] = await tx
          .select({ id: payments.id })
          .from(payments)
          .where(
            and(
              eq(payments.companyId, companyId),
              eq(payments.invoiceId, invoiceId),
              eq(payments.reference, trimmedReference),
            ),
          )
          .limit(1);
        if (existing) {
          throw createError(
            409,
            `A payment with reference "${trimmedReference}" already exists on this invoice.`,
          );
        }
      }

      // 2. Create the payment. Any optional system-managed fields
      // (id / providerSource / providerEventId) are spread conditionally
      // so they only override the DB defaults when the webhook handler
      // explicitly passes them.
      const insertValues: Record<string, unknown> = {
        companyId,
        invoiceId,
        amount: paymentData.amount,
        method: paymentData.method,
        reference: trimmedReference.length > 0 ? trimmedReference : null,
        notes: paymentData.notes ?? null,
        receivedAt: paymentData.receivedAt
          ? new Date(paymentData.receivedAt)
          : new Date(),
      };
      if (paymentData.id) insertValues.id = paymentData.id;
      if (paymentData.providerSource) {
        insertValues.providerSource = paymentData.providerSource;
      }
      if (paymentData.providerEventId !== undefined) {
        insertValues.providerEventId = paymentData.providerEventId;
      }
      // 2026-05-03 PR4: connected-account attribution. Written together
      // — either both set or both null.
      if (paymentData.paymentProviderAccountId !== undefined) {
        insertValues.paymentProviderAccountId = paymentData.paymentProviderAccountId;
      }
      if (paymentData.providerAccountId !== undefined) {
        insertValues.providerAccountId = paymentData.providerAccountId;
      }
      const [payment] = await tx
        .insert(payments)
        .values(insertValues as any)
        .returning();

      // 3. Recalculate invoice totals from all payments
      await this.recalculateInvoiceBalance(tx, companyId, invoiceId);

      return payment;
    });
  }

  /**
   * Update a payment and recalculate invoice balance
   */
  async updatePayment(
    companyId: string,
    paymentId: string,
    patch: {
      amount?: string;
      method?: string;
      reference?: string | null;
      notes?: string | null;
      receivedAt?: string;
    }
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(paymentId, "paymentId");

    return await db.transaction(async (tx) => {
      // Get current payment
      const [payment] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.id, paymentId), eq(payments.companyId, companyId)))
        .limit(1);

      if (!payment) {
        throw this.notFoundError("Payment");
      }

      // 2026-04-14 Payments Phase 3: provider-linked immutability guard.
      // When the row is owned by an external provider (QBO or — in the
      // future — Stripe), the financial identity of the row is fixed:
      // `amount`, `method`, `receivedAt` come from the provider and
      // cannot be overwritten locally. Metadata (`reference`, `notes`)
      // remains editable so operators can annotate the row without
      // breaking provider reconciliation.
      if (
        isProviderLinked(payment) &&
        (patch.amount !== undefined ||
          patch.method !== undefined ||
          patch.receivedAt !== undefined)
      ) {
        throw this.validationError(
          "This payment is linked to an external provider (QuickBooks or Stripe). " +
            "Amount, method, and receivedAt cannot be edited locally. " +
            "To reverse a provider-linked payment, create a reversal or refund instead.",
        );
      }

      // Update payment
      const updateData: Record<string, any> = {};
      if (patch.amount !== undefined) updateData.amount = patch.amount;
      if (patch.method !== undefined) updateData.method = patch.method;
      if (patch.reference !== undefined) updateData.reference = patch.reference;
      if (patch.notes !== undefined) updateData.notes = patch.notes;
      if (patch.receivedAt !== undefined) {
        updateData.receivedAt = new Date(patch.receivedAt);
      }

      const [updated] = await tx
        .update(payments)
        .set(updateData)
        .where(and(eq(payments.id, paymentId), eq(payments.companyId, companyId)))
        .returning();

      // Recalculate invoice balance
      await this.recalculateInvoiceBalance(
        tx,
        companyId,
        assertLegacyInvoiceId(payment.invoiceId, payment.id),
      );

      return updated;
    });
  }

  /**
   * Delete a payment and recalculate invoice balance.
   *
   * 2026-04-14 Payments Phase 2: deletion is narrowed to the
   * "data-entry error" case only. Every other reason to reverse a
   * payment (bounced cheque, refund, accounting correction past the
   * window) MUST go through `createReversal` / `createRefund`, which
   * preserve audit history by inserting an offsetting row instead of
   * destroying the original.
   *
   * Rejected with 400:
   *   - Non-payment rows (refund/reversal children cannot be deleted
   *     directly — delete their parents if legitimate).
   *   - Parents that have children (refunds/reversals already attached).
   *   - QBO-synced rows (provider-linked: must be reversed, not erased).
   *   - Rows older than `DELETE_WINDOW_DAYS`.
   *   - Rows on a voided invoice (pre-existing guard).
   */
  async deletePayment(companyId: string, paymentId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(paymentId, "paymentId");

    return await db.transaction(async (tx) => {
      // Get payment to find invoiceId
      const [payment] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.id, paymentId), eq(payments.companyId, companyId)))
        .limit(1);

      if (!payment) {
        throw this.notFoundError("Payment");
      }

      // Phase 2 guard 1: only `paymentType='payment'` rows are deletable.
      if (payment.paymentType !== "payment") {
        throw this.validationError(
          "Refund/reversal rows cannot be deleted. To undo one, delete it only if it is a data-entry error within the window; otherwise create an offsetting row.",
        );
      }

      // Phase 2 guard 2: childless only. Even though the FK is
      // `ON DELETE RESTRICT`, a DB-level error is opaque — this pre-check
      // gives a clean actionable message.
      const [firstChild] = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.companyId, companyId),
            eq(payments.parentPaymentId, paymentId),
          ),
        )
        .limit(1);
      if (firstChild) {
        throw this.validationError(
          "Cannot delete a payment that has refunds or reversals attached. Remove the attached rows first, or reverse the payment instead.",
        );
      }

      // Phase 2 guard 3: unsynced / provider-unlinked only.
      if (payment.qboPaymentId) {
        throw this.validationError(
          "Cannot delete a payment that has been synced to QuickBooks. Create a reversal instead.",
        );
      }

      // Phase 2 guard 4: within the delete window.
      const ageMs = Date.now() - new Date(payment.createdAt).getTime();
      if (ageMs > DELETE_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
        throw this.validationError(
          `Cannot delete a payment older than ${DELETE_WINDOW_DAYS} days. Create a reversal instead.`,
        );
      }

      const legacyInvoiceId = assertLegacyInvoiceId(payment.invoiceId, payment.id);

      // Check if invoice is in a modifiable state (pre-existing guard).
      const [invoice] = await tx
        .select()
        .from(invoices)
        .where(
          and(eq(invoices.id, legacyInvoiceId), eq(invoices.companyId, companyId))
        )
        .limit(1);

      if (invoice && isInvoiceVoided(invoice.status)) {
        throw this.validationError("Cannot delete payments from a voided invoice");
      }

      // Delete payment
      await tx
        .delete(payments)
        .where(and(eq(payments.id, paymentId), eq(payments.companyId, companyId)));

      // Recalculate invoice balance
      await this.recalculateInvoiceBalance(tx, companyId, legacyInvoiceId);

      return { success: true };
    });
  }

  // =========================================================================
  // 2026-04-14 Payments Phase 2: non-payment ledger writers.
  //
  // Both `createRefund` and `createReversal` share the same insert shape —
  // the only difference is the `paymentType` value and the event emitted
  // by the route layer. Shared logic lives in the private helper below.
  //
  // Amounts are supplied as POSITIVE absolute values from the route layer;
  // the helper negates before insert. This keeps the API user-facing
  // ("refund $50") while the ledger stays signed ("-50.00").
  // =========================================================================

  /**
   * Create a refund attached to a parent payment. Negative-amount row,
   * `paymentType='refund'`, `parentPaymentId` set. See helper docs.
   */
  async createRefund(
    companyId: string,
    parentPaymentId: string,
    data: AdjustmentInput,
  ) {
    return this.createLedgerAdjustment(companyId, parentPaymentId, "refund", data);
  }

  /**
   * Create a reversal attached to a parent payment (bounced cheque, NSF,
   * stopped ACH). Same shape as a refund; `paymentType='reversal'`.
   */
  async createReversal(
    companyId: string,
    parentPaymentId: string,
    data: AdjustmentInput,
  ) {
    return this.createLedgerAdjustment(companyId, parentPaymentId, "reversal", data);
  }

  /**
   * Internal: unified writer for non-payment ledger rows.
   *
   * Invariants enforced in order:
   *   1. Parent exists, belongs to tenant, is itself a `paymentType='payment'`.
   *   2. Invoice is not voided.
   *   3. `requestedAbsAmount` is a positive finite number.
   *   4. Cumulative offset on the parent would not exceed its amount
   *      (delegates to `assertRefundAmountWithinParent`).
   *   5. Reference (if provided) is not a duplicate for this
   *      (tenant, invoice, reference) pair — friendlier 409 surface for
   *      the same rule the two partial UNIQUEs enforce at the DB.
   *
   * All within the same tx as the insert + recalculate.
   */
  private async createLedgerAdjustment(
    companyId: string,
    parentPaymentId: string,
    paymentType: Extract<PaymentType, "refund" | "reversal">,
    data: AdjustmentInput,
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(parentPaymentId, "parentPaymentId");

    const requestedAbsAmount = parseFloat(String(data.amount));
    if (!Number.isFinite(requestedAbsAmount) || requestedAbsAmount <= 0) {
      throw this.validationError(
        `${paymentType === "refund" ? "Refund" : "Reversal"} amount must be a positive number`,
      );
    }

    return await db.transaction(async (tx) => {
      // 1. Load parent payment, tenant-scoped.
      const [parent] = await tx
        .select()
        .from(payments)
        .where(
          and(eq(payments.id, parentPaymentId), eq(payments.companyId, companyId)),
        )
        .limit(1);
      if (!parent) throw this.notFoundError("Parent payment");
      if (parent.paymentType !== "payment") {
        throw this.validationError(
          "Refund/reversal can only attach to a parent of paymentType='payment'",
        );
      }
      const parentInvoiceId = assertLegacyInvoiceId(parent.invoiceId, parent.id);

      // 2. Invoice must be in a modifiable state.
      const [invoice] = await tx
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.id, parentInvoiceId),
            eq(invoices.companyId, companyId),
          ),
        )
        .limit(1);
      if (!invoice) throw this.notFoundError("Invoice");
      if (isInvoiceVoided(invoice.status)) {
        throw this.validationError(
          `Cannot ${paymentType === "refund" ? "refund" : "reverse"} payments on a voided invoice`,
        );
      }

      // 4. Overshoot invariant (canonical enforcement hook from Phase 1).
      await this.assertRefundAmountWithinParent(
        companyId,
        parentPaymentId,
        requestedAbsAmount,
        tx,
      );

      // 5. Reference dedupe pre-check (user-friendly 409 for the rule
      //    the partial UNIQUEs will otherwise surface as a 500).
      const trimmedReference = data.reference?.trim() ?? "";
      if (trimmedReference.length > 0) {
        const [existing] = await tx
          .select({ id: payments.id })
          .from(payments)
          .where(
            and(
              eq(payments.companyId, companyId),
              eq(payments.invoiceId, parentInvoiceId),
              eq(payments.reference, trimmedReference),
            ),
          )
          .limit(1);
        if (existing) {
          throw createError(
            409,
            `A payment or adjustment with reference "${trimmedReference}" already exists on this invoice.`,
          );
        }
      }

      // Insert the signed-negative row. `method` defaults to the parent's
      // method so a refund of a cheque is recorded with method='cheque'
      // unless the caller explicitly overrides (e.g., refund-to-card for
      // a cash payment). No QBO sync fired (Phase 2 rule 7).
      //
      // 2026-04-14 Stripe Phase 1: optional system-managed fields (id,
      // providerSource, providerEventId) are applied conditionally so
      // the Stripe webhook handler can pre-set the row id and provider
      // attribution without forcing those into the manual-entry path.
      const adjustmentValues: Record<string, unknown> = {
        companyId,
        invoiceId: parentInvoiceId,
        amount: (-requestedAbsAmount).toFixed(2),
        method: data.method ?? parent.method,
        reference: trimmedReference.length > 0 ? trimmedReference : null,
        notes: data.notes ?? null,
        receivedAt: data.receivedAt ? new Date(data.receivedAt) : new Date(),
        paymentType,
        parentPaymentId,
        // 2026-05-03 PR4: refund / reversal rows INHERIT connected-
        // account attribution from the parent payment. The refund
        // happens on the same connected account that took the original
        // charge — there is no path where they could legitimately
        // differ. This way the application service / webhook handler
        // doesn't need to thread attribution through every refund
        // creation site.
        paymentProviderAccountId: parent.paymentProviderAccountId,
        providerAccountId: parent.providerAccountId,
      };
      if (data.id) adjustmentValues.id = data.id;
      if (data.providerSource) {
        adjustmentValues.providerSource = data.providerSource;
      }
      if (data.providerEventId !== undefined) {
        adjustmentValues.providerEventId = data.providerEventId;
      }
      const [row] = await tx
        .insert(payments)
        .values(adjustmentValues as any)
        .returning();

      // Recalculate invoice balance — uses SUM(amount) so negative rows
      // flow through naturally. amountPaid is clamped by
      // recalculateInvoiceBalance.
      await this.recalculateInvoiceBalance(tx, companyId, parentInvoiceId);

      return row;
    });
  }

  /**
   * Recalculate invoice amountPaid, balance, and status from payments
   * Called within a transaction after any payment change
   */
  private async recalculateInvoiceBalance(
    tx: any,
    companyId: string,
    invoiceId: string
  ) {
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
      .limit(1);

    if (!invoice) return;

    // Sum all payments for this invoice
    const [totals] = await tx
      .select({
        amountPaid: sql<string>`COALESCE(SUM(${payments.amount}), '0')`,
      })
      .from(payments)
      .where(
        and(eq(payments.companyId, companyId), eq(payments.invoiceId, invoiceId))
      );

    const amountPaid = parseFloat(totals.amountPaid || "0");
    const total = parseFloat(invoice.total || "0");
    const balance = total - amountPaid;

    // Determine new status based on payment state
    let newStatus: InvoiceStatus = invoice.status as InvoiceStatus;

    // Only recalc status if invoice is in an issued/payable state.
    // Includes legacy "sent" alias for backward compatibility with existing rows;
    // modern flows write the canonical "awaiting_payment".
    if (["awaiting_payment", "sent", "partial_paid", "paid"].includes(invoice.status)) {
      if (balance <= 0 && amountPaid > 0) {
        newStatus = "paid";
      } else if (amountPaid > 0 && balance > 0) {
        newStatus = "partial_paid";
      } else if (amountPaid === 0) {
        // All payments removed → return to canonical issued state.
        // 2026-04-08: Write "awaiting_payment" (canonical) instead of legacy "sent"
        // to stop perpetuating the legacy alias.
        newStatus = "awaiting_payment";
      }
    }

    // 2026-04-14 Ledger foundation: clamp stored `amountPaid` to >= 0.
    // The underlying SUM can legitimately go negative across bookkeeping
    // edges once refund/reversal rows exist (Phase 2+). The status
    // transitions above work on the raw (unclamped) `amountPaid`, which
    // is correct: a net-negative sum is semantically `amountPaid === 0
    // → awaiting_payment` already. The clamp here is purely to preserve
    // the natural non-negative invariant on the `invoices.amountPaid`
    // column so downstream readers never see a negative.
    const storedAmountPaid = Math.max(0, amountPaid);
    await tx
      .update(invoices)
      .set({
        amountPaid: storedAmountPaid.toFixed(2),
        balance: Math.max(0, balance).toFixed(2),
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));
  }

  /**
   * 2026-04-14 Ledger foundation (Phase 1): service-layer invariant
   * preventing a refund/reversal row from pushing the parent's cumulative
   * offset beyond the parent's own amount. Every Phase 2+ method that
   * inserts a `paymentType='refund'|'reversal'` row MUST call this first.
   *
   * Not called by any existing Phase 1 code — the defensive wire exists
   * so there is a single canonical enforcement point the moment the
   * refund/reversal creation path ships.
   *
   * Shape: `requestedAbsAmount` is the absolute (positive) value of the
   * new row's amount (callers pass the user-facing "amount to refund",
   * not the signed value that will land in the DB).
   *
   * Throws 400 on overshoot; tenant-scoped; tx-capable.
   */
  async assertRefundAmountWithinParent(
    companyId: string,
    parentPaymentId: string,
    requestedAbsAmount: number,
    txHandle?: any,
  ): Promise<void> {
    this.assertCompanyId(companyId);
    this.validateUUID(parentPaymentId, "parentPaymentId");
    if (!Number.isFinite(requestedAbsAmount) || requestedAbsAmount <= 0) {
      throw this.validationError("Refund/reversal amount must be a positive number");
    }
    const queryDb: any = txHandle ?? db;

    const [parent] = await queryDb
      .select({ amount: payments.amount, paymentType: payments.paymentType })
      .from(payments)
      .where(and(eq(payments.id, parentPaymentId), eq(payments.companyId, companyId)))
      .limit(1);
    if (!parent) throw this.notFoundError("Parent payment");
    if (parent.paymentType !== "payment") {
      throw this.validationError(
        "Refund/reversal can only attach to a parent of paymentType='payment'",
      );
    }

    const parentAmount = parseFloat(parent.amount || "0");
    const [sumRow] = await queryDb
      .select({
        // Sum of absolute values across existing children. Children are
        // negative-signed so SUM(ABS(amount)) gives the amount already
        // offset regardless of refund vs reversal.
        alreadyOffset: sql<string>`COALESCE(SUM(ABS(${payments.amount})), '0')`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.companyId, companyId),
          eq(payments.parentPaymentId, parentPaymentId),
        ),
      );
    const alreadyOffset = parseFloat(sumRow?.alreadyOffset || "0");

    if (alreadyOffset + requestedAbsAmount > parentAmount + 1e-9) {
      const remaining = Math.max(0, parentAmount - alreadyOffset);
      throw this.validationError(
        `Refund/reversal total would exceed parent payment. ` +
          `Parent amount: ${parentAmount.toFixed(2)}, already offset: ${alreadyOffset.toFixed(2)}, ` +
          `remaining refundable: ${remaining.toFixed(2)}, requested: ${requestedAbsAmount.toFixed(2)}`,
      );
    }
  }
}

// 2026-05-04 PR7 — pagination clamps for the transactions list.
// Larger than the per-invoice list (50/200) because the dashboard is
// the only place that loads N payments at once, and infinite scroll /
// load-more lives in the UI.
function clampTransactionsLimit(raw: number | undefined): number {
  if (raw === undefined) return 50;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(n, 200);
}

function clampTransactionsOffset(raw: number | undefined): number {
  if (raw === undefined) return 0;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export const paymentRepository = new PaymentRepository();
