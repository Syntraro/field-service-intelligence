/**
 * QboPaymentService - One-way outbound payment sync to QuickBooks Online
 *
 * 2026-04-09: Implements the locked product decisions for payment sync:
 *
 *   1. App is the source of truth. QBO mirrors local payment actions when
 *      `companies.qboPaymentSyncEnabled` is true.
 *
 *   2. One-way only. There is no inbound counterpart in this service. The
 *      legacy QboReconciliationService inbound path is unrelated and is being
 *      retired in a separate pass.
 *
 *   3. Optional via the company-level toggle. The toggle check happens in the
 *      route/service caller layer (maybeSyncPayment helper) — this class
 *      assumes the caller has already decided sync should run.
 *
 *   4. Supports create / update / delete (delete maps to QBO `void`, which
 *      preserves the audit trail in QBO accounting).
 *
 *   5. No silent divergence. Every failure path writes an ERROR sync status
 *      to the local payment row AND logs to qbo_sync_events. Callers can
 *      surface the failure to the user via the payment list UI.
 *
 *   6. CRITICAL — does NOT touch invoice financial state. The
 *      `updatePaymentSyncStatus` private helper writes only to the
 *      `payments` row's QBO fields (qboPaymentId, qboSyncToken,
 *      qboSyncStatus, qboSyncError, qboLastSyncedAt). It NEVER touches
 *      `invoices.amountPaid / balance / status`. Those remain controlled
 *      exclusively by `paymentRepository.recalculateInvoiceBalance` (the
 *      canonical local writer).
 *
 * Pattern is intentionally a near-clone of QboInvoiceService — same fetch /
 * idempotency-check / validate / build-payload / call-QBO / log / update-
 * sync-status flow. Differences:
 *   - Validates `validatePaymentForSync` (not invoice).
 *   - Writes to `payments.qbo*` columns (not invoices).
 *   - Resolves the QBO Customer ref from the parent invoice's location
 *     (using the same `determineCustomerRefId` logic the invoice service uses).
 *   - delete maps to QBO void.
 */

import { db } from "../../db";
import { payments, invoices, clientLocations, customerCompanies } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import type { Invoice, Payment, Client, CustomerCompany } from "@shared/schema";
import { QboClient } from "./QboClient";
import type { QboApiResponse, QboTokens } from "./QboClient";
import { QboSyncLogger } from "./QboSyncLogger";
import {
  toQboPaymentPayload,
  validatePaymentForSync,
  type QBOPaymentResponse,
} from "./QboMapper";

export interface PaymentSyncResult {
  success: boolean;
  qboPaymentId?: string;
  qboSyncToken?: string;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

/**
 * QboPaymentService class for syncing payments to QBO (one-way outbound).
 */
export class QboPaymentService {
  private client: QboClient;
  private companyId: string;
  private logger: QboSyncLogger;

  constructor(client: QboClient, companyId: string, triggeredBy?: string) {
    this.client = client;
    this.companyId = companyId;
    this.logger = new QboSyncLogger(companyId, triggeredBy);
  }

  // ==========================================================================
  // CREATE
  // ==========================================================================

  /**
   * Create a payment in QBO. Idempotent — if `payment.qboPaymentId` already
   * exists, returns success without re-creating.
   *
   * The caller is responsible for the toggle check
   * (companies.qboPaymentSyncEnabled). This method assumes the caller has
   * decided sync should run.
   */
  async createPayment(paymentId: string): Promise<PaymentSyncResult> {
    // Fetch the payment with tenant isolation
    const [payment] = await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.id, paymentId),
          eq(payments.companyId, this.companyId),
        ),
      )
      .limit(1);

    if (!payment) {
      return { success: false, error: "Payment not found" };
    }

    // IDEMPOTENT: If already synced, return existing IDs without re-creating
    if (payment.qboPaymentId) {
      return {
        success: true,
        qboPaymentId: payment.qboPaymentId,
        qboSyncToken: payment.qboSyncToken || undefined,
      };
    }

    // Fetch parent invoice (tenant-isolated)
    const [invoice] = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, payment.invoiceId),
          eq(invoices.companyId, this.companyId),
        ),
      )
      .limit(1);

    if (!invoice) {
      const reason = "Parent invoice not found";
      await this.logger.logPaymentSkipped("PAYMENT_CREATE", {
        paymentId,
        invoiceId: payment.invoiceId,
        reason,
      });
      await this.updatePaymentSyncStatus(paymentId, null, null, "ERROR", reason);
      return { success: false, error: reason };
    }

    // Validate (parent invoice synced, not voided, amount > 0)
    const validation = validatePaymentForSync(payment, invoice);
    if (!validation.valid) {
      await this.logger.logPaymentSkipped("PAYMENT_CREATE", {
        paymentId,
        invoiceId: payment.invoiceId,
        reason: validation.reason!,
      });
      // Skipped is a kind of failure for the user — surface it via the
      // payment row's status so the UI can show a "needs attention" badge.
      await this.updatePaymentSyncStatus(paymentId, null, null, "ERROR", validation.reason!);
      return { success: false, skipped: true, skipReason: validation.reason };
    }

    // Resolve the QBO customer ref via the same logic invoice sync uses
    const customerRefId = await this.resolveCustomerRefForInvoice(invoice);
    if (!customerRefId) {
      const reason = "No QBO Customer ID available for this invoice. Sync the customer first.";
      await this.logger.logPaymentSkipped("PAYMENT_CREATE", {
        paymentId,
        invoiceId: payment.invoiceId,
        reason,
      });
      await this.updatePaymentSyncStatus(paymentId, null, null, "ERROR", reason);
      return { success: false, skipped: true, skipReason: reason };
    }

    // Build QBO payload
    let payload;
    try {
      payload = toQboPaymentPayload(payment, invoice, customerRefId, false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.logger.logPaymentFailure("PAYMENT_CREATE", {
        paymentId,
        invoiceId: payment.invoiceId,
        errorMessage,
      });
      await this.updatePaymentSyncStatus(paymentId, null, null, "ERROR", errorMessage);
      return { success: false, error: errorMessage };
    }

    const startTime = Date.now();
    let response: QboApiResponse<QBOPaymentResponse>;

    try {
      response = await this.client.createPayment<QBOPaymentResponse>(payload);
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      await this.logger.logPaymentFailure("PAYMENT_CREATE", {
        paymentId,
        invoiceId: payment.invoiceId,
        errorMessage,
        requestPayload: payload,
        durationMs,
      });
      await this.updatePaymentSyncStatus(paymentId, null, null, "ERROR", errorMessage);
      return { success: false, error: errorMessage };
    }

    const durationMs = Date.now() - startTime;

    if (!response.success || !response.data) {
      const errorMessage = response.error?.message || "Unknown QBO error";
      const errorCode = response.error?.code;

      await this.logger.logPaymentFailure("PAYMENT_CREATE", {
        paymentId,
        invoiceId: payment.invoiceId,
        errorMessage,
        errorCode,
        requestPayload: payload,
        responsePayload: response.raw,
        durationMs,
      });
      await this.updatePaymentSyncStatus(paymentId, null, null, "ERROR", errorMessage);
      return { success: false, error: errorMessage };
    }

    // Success - update local record with QBO IDs
    const qboPaymentId = response.data.Id;
    const qboSyncToken = response.data.SyncToken;

    await this.updatePaymentSyncStatus(
      paymentId,
      qboPaymentId,
      qboSyncToken,
      "SYNCED",
      null,
    );

    await this.logger.logPaymentSuccess("PAYMENT_CREATE", {
      paymentId,
      invoiceId: payment.invoiceId,
      qboPaymentId,
      qboSyncToken,
      requestPayload: payload,
      responsePayload: response.data,
      durationMs,
    });

    return {
      success: true,
      qboPaymentId,
      qboSyncToken,
    };
  }

  // ==========================================================================
  // UPDATE
  // ==========================================================================

  /**
   * Update an existing QBO payment to mirror a local edit. Requires the
   * payment to already have qboPaymentId + qboSyncToken (i.e. it must have
   * been previously created in QBO via this service).
   *
   * If the payment has not yet been created in QBO, falls through to
   * `createPayment` (the local edit becomes the first sync).
   */
  async updatePayment(paymentId: string): Promise<PaymentSyncResult> {
    const [payment] = await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.id, paymentId),
          eq(payments.companyId, this.companyId),
        ),
      )
      .limit(1);

    if (!payment) {
      return { success: false, error: "Payment not found" };
    }

    // Not yet synced → first sync via createPayment
    if (!payment.qboPaymentId || !payment.qboSyncToken) {
      return this.createPayment(paymentId);
    }

    const [invoice] = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, payment.invoiceId),
          eq(invoices.companyId, this.companyId),
        ),
      )
      .limit(1);

    if (!invoice) {
      const reason = "Parent invoice not found";
      await this.logger.logPaymentSkipped("PAYMENT_UPDATE", {
        paymentId,
        invoiceId: payment.invoiceId,
        reason,
      });
      await this.updatePaymentSyncStatus(paymentId, payment.qboPaymentId, payment.qboSyncToken, "ERROR", reason);
      return { success: false, error: reason };
    }

    const validation = validatePaymentForSync(payment, invoice);
    if (!validation.valid) {
      await this.logger.logPaymentSkipped("PAYMENT_UPDATE", {
        paymentId,
        invoiceId: payment.invoiceId,
        reason: validation.reason!,
      });
      await this.updatePaymentSyncStatus(paymentId, payment.qboPaymentId, payment.qboSyncToken, "ERROR", validation.reason!);
      return { success: false, skipped: true, skipReason: validation.reason };
    }

    const customerRefId = await this.resolveCustomerRefForInvoice(invoice);
    if (!customerRefId) {
      const reason = "No QBO Customer ID available for this invoice.";
      await this.logger.logPaymentSkipped("PAYMENT_UPDATE", {
        paymentId,
        invoiceId: payment.invoiceId,
        reason,
      });
      await this.updatePaymentSyncStatus(paymentId, payment.qboPaymentId, payment.qboSyncToken, "ERROR", reason);
      return { success: false, skipped: true, skipReason: reason };
    }

    // Build update payload (forUpdate=true → includes Id + SyncToken)
    let payload;
    try {
      payload = toQboPaymentPayload(payment, invoice, customerRefId, true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.logger.logPaymentFailure("PAYMENT_UPDATE", {
        paymentId,
        invoiceId: payment.invoiceId,
        errorMessage,
      });
      await this.updatePaymentSyncStatus(paymentId, payment.qboPaymentId, payment.qboSyncToken, "ERROR", errorMessage);
      return { success: false, error: errorMessage };
    }

    const startTime = Date.now();
    let response: QboApiResponse<QBOPaymentResponse>;

    try {
      response = await this.client.updatePayment<QBOPaymentResponse>(payload);
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      await this.logger.logPaymentFailure("PAYMENT_UPDATE", {
        paymentId,
        invoiceId: payment.invoiceId,
        errorMessage,
        requestPayload: payload,
        durationMs,
      });
      await this.updatePaymentSyncStatus(paymentId, payment.qboPaymentId, payment.qboSyncToken, "ERROR", errorMessage);
      return { success: false, error: errorMessage };
    }

    const durationMs = Date.now() - startTime;

    if (!response.success || !response.data) {
      const errorMessage = response.error?.message || "Unknown QBO error";
      const errorCode = response.error?.code;

      await this.logger.logPaymentFailure("PAYMENT_UPDATE", {
        paymentId,
        invoiceId: payment.invoiceId,
        errorMessage,
        errorCode,
        requestPayload: payload,
        responsePayload: response.raw,
        durationMs,
      });
      await this.updatePaymentSyncStatus(paymentId, payment.qboPaymentId, payment.qboSyncToken, "ERROR", errorMessage);
      return { success: false, error: errorMessage };
    }

    // Success — pull the new SyncToken from the response
    const qboPaymentId = response.data.Id;
    const qboSyncToken = response.data.SyncToken;

    await this.updatePaymentSyncStatus(
      paymentId,
      qboPaymentId,
      qboSyncToken,
      "SYNCED",
      null,
    );

    await this.logger.logPaymentSuccess("PAYMENT_UPDATE", {
      paymentId,
      invoiceId: payment.invoiceId,
      qboPaymentId,
      qboSyncToken,
      requestPayload: payload,
      responsePayload: response.data,
      durationMs,
    });

    return {
      success: true,
      qboPaymentId,
      qboSyncToken,
    };
  }

  // ==========================================================================
  // DELETE (mapped to QBO void)
  // ==========================================================================

  /**
   * Void the corresponding QBO payment when the local payment is deleted.
   *
   * NOTE: This is called BEFORE the local payment row is deleted, because
   * after delete the row is gone and we can't read its qboPaymentId. The
   * caller (the route handler / sync helper) is responsible for ordering:
   * call `voidPaymentInQbo(paymentId)` first, then call
   * `paymentRepository.deletePayment` second. Failure of the QBO void does
   * NOT block the local delete — local is the source of truth and the user
   * can clean up QBO manually if needed (the qboSyncEvents log captures the
   * failure for support).
   *
   * Because the local row may have already been deleted by the time we get
   * here in some flows, callers can pass a snapshot via the optional
   * `paymentSnapshot` parameter to avoid a re-fetch.
   */
  async deletePayment(
    paymentId: string,
    paymentSnapshot?: Payment,
  ): Promise<PaymentSyncResult> {
    let payment: Payment | undefined = paymentSnapshot;

    if (!payment) {
      const [row] = await db
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.id, paymentId),
            eq(payments.companyId, this.companyId),
          ),
        )
        .limit(1);
      payment = row;
    }

    if (!payment) {
      // Local row already gone and no snapshot provided. Without the
      // qboPaymentId we can't void anything. Log and return — the local
      // delete already succeeded by definition.
      await this.logger.logPaymentSkipped("PAYMENT_DELETE", {
        paymentId,
        invoiceId: "",
        reason: "Payment row not found and no snapshot provided; cannot void in QBO",
      });
      return { success: false, error: "Payment not found" };
    }

    // No QBO counterpart → nothing to void
    if (!payment.qboPaymentId || !payment.qboSyncToken) {
      await this.logger.logPaymentSkipped("PAYMENT_DELETE", {
        paymentId,
        invoiceId: payment.invoiceId,
        reason: "Payment was never synced to QBO; nothing to void",
      });
      return { success: true, skipped: true, skipReason: "Not synced to QBO" };
    }

    // Build the void payload — QBO requires Id + SyncToken (and the void
    // operation is set via URL query string, not the body).
    const voidPayload = {
      Id: payment.qboPaymentId,
      SyncToken: payment.qboSyncToken,
      sparse: true,
    };

    const startTime = Date.now();
    let response: QboApiResponse<QBOPaymentResponse>;

    try {
      response = await this.client.voidPayment<QBOPaymentResponse>(voidPayload);
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      await this.logger.logPaymentFailure("PAYMENT_DELETE", {
        paymentId,
        invoiceId: payment.invoiceId,
        errorMessage,
        requestPayload: voidPayload,
        durationMs,
      });
      // We don't update sync status because the local row may already be deleted.
      return { success: false, error: errorMessage };
    }

    const durationMs = Date.now() - startTime;

    if (!response.success || !response.data) {
      const errorMessage = response.error?.message || "Unknown QBO error";
      const errorCode = response.error?.code;

      await this.logger.logPaymentFailure("PAYMENT_DELETE", {
        paymentId,
        invoiceId: payment.invoiceId,
        errorMessage,
        errorCode,
        requestPayload: voidPayload,
        responsePayload: response.raw,
        durationMs,
      });
      return { success: false, error: errorMessage };
    }

    await this.logger.logPaymentSuccess("PAYMENT_DELETE", {
      paymentId,
      invoiceId: payment.invoiceId,
      qboPaymentId: payment.qboPaymentId,
      qboSyncToken: response.data.SyncToken,
      requestPayload: voidPayload,
      responsePayload: response.data,
      durationMs,
    });

    return {
      success: true,
      qboPaymentId: payment.qboPaymentId,
      qboSyncToken: response.data.SyncToken,
    };
  }

  // ==========================================================================
  // INTERNAL HELPERS
  // ==========================================================================

  /**
   * Resolve the QBO Customer ref for a given invoice. Mirrors the same logic
   * `QboInvoiceService.determineCustomerRefId` uses: if `billWithParent` is
   * true and the parent customer company has a qboCustomerId, use the
   * parent; otherwise use the location's qboCustomerId.
   *
   * Returns null if neither is available — the caller should treat this as
   * a skip with reason.
   */
  private async resolveCustomerRefForInvoice(invoice: Invoice): Promise<string | null> {
    const [location] = await db
      .select()
      .from(clientLocations)
      .where(
        and(
          eq(clientLocations.id, invoice.locationId),
          eq(clientLocations.companyId, this.companyId),
        ),
      )
      .limit(1);

    if (!location) {
      return null;
    }

    let customerCompany: CustomerCompany | undefined;
    if (invoice.customerCompanyId) {
      const [company] = await db
        .select()
        .from(customerCompanies)
        .where(
          and(
            eq(customerCompanies.id, invoice.customerCompanyId),
            eq(customerCompanies.companyId, this.companyId),
          ),
        )
        .limit(1);
      customerCompany = company;
    }

    if (location.billWithParent && customerCompany?.qboCustomerId) {
      return customerCompany.qboCustomerId;
    }
    if (location.qboCustomerId) {
      return location.qboCustomerId;
    }
    return null;
  }

  /**
   * Update the payments row's QBO sync state.
   *
   * CRITICAL — locked product decision #6: this method writes ONLY to the
   * payments row's QBO fields. It NEVER touches `invoices.amountPaid /
   * balance / status`. Those remain controlled exclusively by the canonical
   * local writer (`paymentRepository.recalculateInvoiceBalance`).
   *
   * Audit invariant: if any future change tries to add an `invoices` update
   * inside this method, it MUST be rejected at code review. The dual-writer
   * problem is what this whole architecture exists to prevent.
   */
  private async updatePaymentSyncStatus(
    paymentId: string,
    qboPaymentId: string | null,
    qboSyncToken: string | null,
    syncStatus: "NOT_SYNCED" | "SYNCED" | "PENDING" | "ERROR",
    syncError: string | null,
  ): Promise<void> {
    const updateData: Record<string, unknown> = {
      qboSyncStatus: syncStatus,
      qboSyncError: syncError,
    };

    if (qboPaymentId) {
      updateData.qboPaymentId = qboPaymentId;
      updateData.qboSyncToken = qboSyncToken;
    }
    if (syncStatus === "SYNCED") {
      updateData.qboLastSyncedAt = new Date();
    }

    await db
      .update(payments)
      .set(updateData)
      .where(
        and(
          eq(payments.id, paymentId),
          eq(payments.companyId, this.companyId),
        ),
      );
  }
}

/**
 * Create a QboPaymentService instance from tokens.
 * Returns null if QBO is not configured (env vars missing).
 */
export function createPaymentService(
  tokens: QboTokens,
  companyId: string,
  triggeredBy?: string,
): QboPaymentService | null {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const environment = (process.env.QBO_ENVIRONMENT as "sandbox" | "production") || "sandbox";

  if (!clientId || !clientSecret) {
    return null;
  }

  const client = new QboClient({ clientId, clientSecret, environment }, tokens);
  return new QboPaymentService(client, companyId, triggeredBy);
}
