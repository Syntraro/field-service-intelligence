/**
 * QboReconciliationService - Compares QBO and local invoice/payment state
 *
 * Handles:
 * - Comparing local invoice balance with QBO balance
 * - Detecting payments in QBO that don't exist locally
 * - Creating local payment records from QBO (explicit apply only)
 *
 * IMPORTANT:
 * - No auto-sync: All reconciliation must be explicitly triggered
 * - No silent mutations: dry run returns differences, apply creates records
 * - All actions are logged to qbo_sync_events
 * - Enforces companyId isolation
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
  private client: QboClient;
  private companyId: string;
  private readService: QboReadService;
  private logger: QboSyncLogger;
  private triggeredBy: string | undefined;

  constructor(client: QboClient, companyId: string, triggeredBy?: string) {
    this.client = client;
    this.companyId = companyId;
    this.triggeredBy = triggeredBy;
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
   * Apply reconciliation - creates local payment records for QBO payments
   * Only creates payments that don't exist locally
   */
  async reconcileApply(invoiceId: string): Promise<ReconcileApplyResult> {
    const startTime = Date.now();

    // First do a dry run to get the differences
    const dryRunResult = await this.reconcileDryRun(invoiceId);

    if (!dryRunResult.success || !dryRunResult.data) {
      await this.logger.log({
        eventType: "RECONCILE_APPLY",
        result: "FAILURE",
        invoiceId,
        errorMessage: dryRunResult.error || dryRunResult.skipReason || "Dry run failed",
        durationMs: Date.now() - startTime,
      });

      return {
        success: false,
        invoiceId,
        paymentsCreated: 0,
        totalAmountApplied: 0,
        createdPaymentIds: [],
        errors: [dryRunResult.error || dryRunResult.skipReason || "Failed to analyze invoice"],
        skipped: dryRunResult.skipped,
        skipReason: dryRunResult.skipReason,
      };
    }

    const reconciliation = dryRunResult.data;

    // If no missing payments, nothing to do
    if (reconciliation.missingPayments.length === 0) {
      await this.logger.log({
        eventType: "RECONCILE_APPLY",
        result: "NO_CHANGES",
        invoiceId,
        qboEntityId: reconciliation.qboInvoiceId,
        responsePayload: { message: "No missing payments to create" },
        durationMs: Date.now() - startTime,
      });

      return {
        success: true,
        invoiceId,
        paymentsCreated: 0,
        totalAmountApplied: 0,
        createdPaymentIds: [],
        errors: [],
      };
    }

    // Create local payments for each missing QBO payment
    const createdPaymentIds: string[] = [];
    const errors: string[] = [];
    let totalAmountApplied = 0;

    for (const missingPayment of reconciliation.missingPayments) {
      try {
        const [created] = await db
          .insert(payments)
          .values({
            companyId: this.companyId,
            invoiceId,
            amount: String(missingPayment.qboAmount),
            method: this.mapQboPaymentMethod(missingPayment.qboMethod),
            reference: missingPayment.qboReference || `QBO:${missingPayment.qboPaymentId}`,
            receivedAt: new Date(missingPayment.qboPaymentDate),
            notes: `Imported from QuickBooks Online (Payment ID: ${missingPayment.qboPaymentId})`,
          })
          .returning();

        if (created) {
          createdPaymentIds.push(created.id);
          totalAmountApplied += missingPayment.qboAmount;

          // Log individual payment creation
          await this.logger.log({
            eventType: "PAYMENT_CREATED_FROM_QBO",
            result: "SUCCESS",
            invoiceId,
            qboEntityId: missingPayment.qboPaymentId,
            responsePayload: {
              localPaymentId: created.id,
              amount: missingPayment.qboAmount,
            },
          });
        }
      } catch (err) {
        const errorMsg = `Failed to create payment for QBO payment ${missingPayment.qboPaymentId}: ${
          err instanceof Error ? err.message : String(err)
        }`;
        errors.push(errorMsg);

        await this.logger.log({
          eventType: "PAYMENT_CREATED_FROM_QBO",
          result: "FAILURE",
          invoiceId,
          qboEntityId: missingPayment.qboPaymentId,
          errorMessage: errorMsg,
        });
      }
    }

    // Update invoice balance if payments were created
    if (createdPaymentIds.length > 0) {
      await this.updateInvoiceBalance(invoiceId);
    }

    const durationMs = Date.now() - startTime;

    await this.logger.log({
      eventType: "RECONCILE_APPLY",
      result: errors.length === 0 ? "SUCCESS" : "FAILURE",
      invoiceId,
      qboEntityId: reconciliation.qboInvoiceId,
      responsePayload: {
        paymentsCreated: createdPaymentIds.length,
        totalAmountApplied,
        errors: errors.length,
      },
      durationMs,
    });

    return {
      success: errors.length === 0,
      invoiceId,
      paymentsCreated: createdPaymentIds.length,
      totalAmountApplied,
      createdPaymentIds,
      errors,
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

  /**
   * Map QBO payment method to local payment method
   */
  private mapQboPaymentMethod(qboMethod: string | null): string {
    if (!qboMethod) return "other";

    const methodLower = qboMethod.toLowerCase();
    if (methodLower.includes("cash")) return "cash";
    if (methodLower.includes("check") || methodLower.includes("cheque")) return "cheque";
    if (methodLower.includes("credit")) return "credit";
    if (methodLower.includes("debit")) return "debit";
    if (methodLower.includes("transfer") || methodLower.includes("eft") || methodLower.includes("ach")) {
      return "e-transfer";
    }
    return "other";
  }

  /**
   * Update invoice balance after creating payments
   */
  private async updateInvoiceBalance(invoiceId: string): Promise<void> {
    // Sum all payments for this invoice
    const allPayments = await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.invoiceId, invoiceId),
          eq(payments.companyId, this.companyId)
        )
      );

    const totalPaid = allPayments.reduce(
      (sum, p) => sum + parseFloat(p.amount),
      0
    );

    // Get current invoice total
    const [invoice] = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(invoices.companyId, this.companyId)
        )
      )
      .limit(1);

    if (!invoice) return;

    const total = parseFloat(invoice.total);
    const newBalance = Math.max(0, total - totalPaid);

    // Update invoice
    await db
      .update(invoices)
      .set({
        amountPaid: String(totalPaid),
        balance: String(newBalance),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(invoices.companyId, this.companyId)
        )
      );
  }
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
