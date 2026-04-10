/**
 * QboReconciliationService - READ-ONLY diagnostic comparison of QBO and local
 * invoice/payment state.
 *
 * 2026-04-09: This service was reduced in scope to support the locked product
 * decision that QBO payment sync is one-way (App → QBO). Previously this
 * service had a `reconcileApply` method that imported QBO payments into the
 * local payments table AND directly mutated invoices.amountPaid / balance
 * outside of the canonical local writer (paymentRepository.recalculateInvoiceBalance).
 *
 * Both behaviors are now retired:
 *   1. `reconcileApply` no longer imports payments. It returns a structured
 *      "retired" result and writes a SKIPPED log event. This is enforced at
 *      the service layer so no caller (queue, route, UI) can re-enable it
 *      without intentionally modifying the service.
 *   2. The dual-writer `updateInvoiceBalance` private helper has been removed
 *      entirely. Locked product rule #6 forbids ANY QBO sync code path from
 *      mutating invoice financial fields directly.
 *
 * What this service still does:
 *   - `reconcileDryRun` is preserved as a READ-ONLY diagnostic tool. It
 *     fetches the QBO invoice + payments, compares them to local state, and
 *     returns the differences. It does NOT mutate anything. Admins use it
 *     when troubleshooting drift; the App is the source of truth so any
 *     drift is corrected manually in QBO, not by importing back into the App.
 *
 * Tenant isolation: enforced via companyId on every query.
 */

import { db } from "../../db";
import { invoices, payments } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import type { Invoice, Payment } from "@shared/schema";
import { QboClient } from "./QboClient";
import { QboReadService } from "./QboReadService";
import type { ParsedQBOPayment, QBOInvoiceWithPayments } from "./QboReadService";
import { QboSyncLogger } from "./QboSyncLogger";

// ============================================================
// RESULT TYPES
// ============================================================

export interface PaymentDifference {
  qboPaymentId: string;
  qboPaymentDate: string;
  qboAmount: number;
  qboMethod: string | null;
  qboReference: string | null;
  existsLocally: boolean;
  localPaymentId?: string;
  amountDifference?: number; // Positive if QBO has more
}

export interface ReconciliationResult {
  invoiceId: string;
  qboInvoiceId: string;
  // Balance comparison
  localTotal: number;
  localBalance: number;
  localAmountPaid: number;
  qboTotal: number;
  qboBalance: number;
  qboAmountPaid: number;
  // Differences
  balanceDifference: number; // Positive if QBO shows more paid
  hasDiscrepancy: boolean;
  // Payment analysis
  qboPayments: PaymentDifference[];
  missingPayments: PaymentDifference[]; // Payments in QBO but not local
  matchedPayments: PaymentDifference[]; // Payments in both
  // Summary
  totalMissingAmount: number;
  paymentCountDifference: number;
}

export interface ReconcileApplyResult {
  success: boolean;
  invoiceId: string;
  paymentsCreated: number;
  totalAmountApplied: number;
  createdPaymentIds: string[];
  errors: string[];
  skipped?: boolean;
  skipReason?: string;
}

// ============================================================
// SERVICE CLASS
// ============================================================

/**
 * QboReconciliationService compares local and QBO state
 */
export class QboReconciliationService {
  private companyId: string;
  private readService: QboReadService;
  private logger: QboSyncLogger;

  constructor(client: QboClient, companyId: string, triggeredBy?: string) {
    this.companyId = companyId;
    this.readService = new QboReadService(client, companyId, triggeredBy);
    this.logger = new QboSyncLogger(companyId, triggeredBy);
  }

  /**
   * Dry run reconciliation - compares local and QBO state
   * Does NOT create any records, just returns differences
   */
  async reconcileDryRun(invoiceId: string): Promise<{
    success: boolean;
    data?: ReconciliationResult;
    error?: string;
    skipped?: boolean;
    skipReason?: string;
  }> {
    const startTime = Date.now();

    // Fetch local invoice with tenant isolation
    const [localInvoice] = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(invoices.companyId, this.companyId)
        )
      )
      .limit(1);

    if (!localInvoice) {
      return { success: false, error: "Invoice not found" };
    }

    if (!localInvoice.qboInvoiceId) {
      await this.logger.log({
        eventType: "RECONCILE_DRY_RUN",
        result: "SKIPPED",
        invoiceId,
        errorMessage: "Invoice has not been synced to QBO",
        durationMs: Date.now() - startTime,
      });

      return {
        success: false,
        skipped: true,
        skipReason: "Invoice has not been synced to QBO (no qboInvoiceId)",
      };
    }

    // Fetch QBO invoice data
    const qboResult = await this.readService.fetchInvoice(localInvoice.qboInvoiceId);

    if (!qboResult.success || !qboResult.data) {
      await this.logger.log({
        eventType: "RECONCILE_DRY_RUN",
        result: "FAILURE",
        invoiceId,
        qboEntityId: localInvoice.qboInvoiceId,
        errorMessage: qboResult.error || "Failed to fetch QBO invoice",
        durationMs: Date.now() - startTime,
      });

      return {
        success: false,
        error: qboResult.error || "Failed to fetch invoice from QBO",
      };
    }

    const qboInvoice = qboResult.data;

    // Fetch local payments for this invoice
    const localPayments = await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.invoiceId, invoiceId),
          eq(payments.companyId, this.companyId)
        )
      );

    // Compare and analyze
    const reconciliationResult = this.analyzeReconciliation(
      invoiceId,
      localInvoice,
      localPayments,
      qboInvoice
    );

    const durationMs = Date.now() - startTime;

    await this.logger.log({
      eventType: "RECONCILE_DRY_RUN",
      result: reconciliationResult.hasDiscrepancy ? "SUCCESS" : "NO_CHANGES",
      invoiceId,
      qboEntityId: localInvoice.qboInvoiceId,
      responsePayload: {
        hasDiscrepancy: reconciliationResult.hasDiscrepancy,
        balanceDifference: reconciliationResult.balanceDifference,
        missingPaymentsCount: reconciliationResult.missingPayments.length,
        totalMissingAmount: reconciliationResult.totalMissingAmount,
      },
      durationMs,
    });

    return {
      success: true,
      data: reconciliationResult,
    };
  }

  /**
   * RETIRED 2026-04-09 — Inbound payment import is no longer an active product
   * behavior. The locked product decision is one-way payment sync (App → QBO).
   * The App is the source of truth; any drift in QBO is resolved manually in
   * QBO, never imported back.
   *
   * This method now logs a SKIPPED event and returns a structured "retired"
   * result. It does NOT touch the local payments table or invoice financial
   * fields. Callers (route handler, queue processor) must surface the retired
   * state to the user clearly — silently swallowing the call would violate
   * locked rule #5 ("no silent failure paths").
   *
   * If you find yourself wanting to revive this method, re-read the locked
   * product decisions in maybeSyncPayment.ts and QboPaymentService.ts. The
   * dual-writer problem this prevents is the entire reason the new outbound
   * sync exists.
   */
  async reconcileApply(invoiceId: string): Promise<ReconcileApplyResult> {
    const reason =
      "Inbound payment reconcile-apply is retired (2026-04-09). Payments now sync one-way (App → QBO). Resolve any QBO drift manually in QuickBooks.";

    await this.logger.log({
      eventType: "RECONCILE_APPLY",
      result: "SKIPPED",
      invoiceId,
      errorMessage: reason,
    });

    return {
      success: false,
      invoiceId,
      paymentsCreated: 0,
      totalAmountApplied: 0,
      createdPaymentIds: [],
      errors: [],
      skipped: true,
      skipReason: reason,
    };
  }

  /**
   * Analyze reconciliation between local and QBO data
   */
  private analyzeReconciliation(
    invoiceId: string,
    localInvoice: Invoice,
    localPayments: Payment[],
    qboInvoice: QBOInvoiceWithPayments
  ): ReconciliationResult {
    const localTotal = parseFloat(localInvoice.total);
    const localBalance = parseFloat(localInvoice.balance);
    const localAmountPaid = parseFloat(localInvoice.amountPaid);

    const qboTotal = qboInvoice.totalAmount;
    const qboBalance = qboInvoice.balance;
    const qboAmountPaid = qboInvoice.amountPaid;

    // Analyze each QBO payment
    const qboPayments: PaymentDifference[] = [];
    const missingPayments: PaymentDifference[] = [];
    const matchedPayments: PaymentDifference[] = [];

    for (const qboPayment of qboInvoice.payments) {
      // Get the amount for this specific invoice from the payment
      const invoicePaymentAmount = qboPayment.linkedInvoices.find(
        li => li.qboInvoiceId === qboInvoice.qboInvoiceId
      )?.amount || qboPayment.totalAmount;

      // Try to find a matching local payment
      // Match by reference (if it contains QBO payment ID) or by amount + date proximity
      const matchingLocal = this.findMatchingLocalPayment(
        localPayments,
        qboPayment,
        invoicePaymentAmount
      );

      const paymentDiff: PaymentDifference = {
        qboPaymentId: qboPayment.qboPaymentId,
        qboPaymentDate: qboPayment.paymentDate,
        qboAmount: invoicePaymentAmount,
        qboMethod: qboPayment.paymentMethod,
        qboReference: qboPayment.reference,
        existsLocally: !!matchingLocal,
        localPaymentId: matchingLocal?.id,
        amountDifference: matchingLocal
          ? invoicePaymentAmount - parseFloat(matchingLocal.amount)
          : undefined,
      };

      qboPayments.push(paymentDiff);

      if (matchingLocal) {
        matchedPayments.push(paymentDiff);
      } else {
        missingPayments.push(paymentDiff);
      }
    }

    const totalMissingAmount = missingPayments.reduce((sum, p) => sum + p.qboAmount, 0);
    const balanceDifference = localBalance - qboBalance; // Positive means local shows more owed
    const hasDiscrepancy = Math.abs(balanceDifference) > 0.01 || missingPayments.length > 0;

    return {
      invoiceId,
      qboInvoiceId: qboInvoice.qboInvoiceId,
      localTotal,
      localBalance,
      localAmountPaid,
      qboTotal,
      qboBalance,
      qboAmountPaid,
      balanceDifference,
      hasDiscrepancy,
      qboPayments,
      missingPayments,
      matchedPayments,
      totalMissingAmount,
      paymentCountDifference: qboInvoice.payments.length - localPayments.length,
    };
  }

  /**
   * Find a matching local payment for a QBO payment
   * Matches by:
   * 1. Reference containing QBO payment ID
   * 2. Same amount and similar date (within 1 day)
   */
  private findMatchingLocalPayment(
    localPayments: Payment[],
    qboPayment: ParsedQBOPayment,
    expectedAmount: number
  ): Payment | undefined {
    // First, try to match by reference containing QBO ID
    const byReference = localPayments.find(
      lp => lp.reference?.includes(qboPayment.qboPaymentId)
    );
    if (byReference) return byReference;

    // Otherwise, try to match by amount and date
    const qboDate = new Date(qboPayment.paymentDate);

    return localPayments.find(lp => {
      const localAmount = parseFloat(lp.amount);
      const localDate = new Date(lp.receivedAt);

      // Amount must match within 0.01
      if (Math.abs(localAmount - expectedAmount) > 0.01) return false;

      // Date must be within 1 day
      const daysDiff = Math.abs(localDate.getTime() - qboDate.getTime()) / (1000 * 60 * 60 * 24);
      return daysDiff <= 1;
    });
  }

  // 2026-04-09: `mapQboPaymentMethod` and `updateInvoiceBalance` were removed
  // along with `reconcileApply`. The latter was a dual-writer that mutated
  // invoices.amountPaid / balance directly, violating locked product rule #6.
  // The canonical writer remains paymentRepository.recalculateInvoiceBalance.
}

// ============================================================
// FACTORY FUNCTION
// ============================================================

/**
 * Create a QboReconciliationService instance
 */
export function createReconciliationService(
  client: QboClient,
  companyId: string,
  triggeredBy?: string
): QboReconciliationService {
  return new QboReconciliationService(client, companyId, triggeredBy);
}
