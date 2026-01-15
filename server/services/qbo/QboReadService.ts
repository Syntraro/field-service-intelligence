/**
 * QboReadService - Read-only service for fetching data from QuickBooks Online
 *
 * Handles:
 * - Fetching invoices from QBO
 * - Fetching payments linked to invoices from QBO
 * - All operations are read-only (no mutations)
 *
 * IMPORTANT:
 * - Does NOT auto-sync or create any local records
 * - All reads are logged to qbo_sync_events
 * - Enforces companyId isolation
 */

import { QboClient } from "./QboClient";
import type { QboApiResponse } from "./QboClient";
import { QboSyncLogger } from "./QboSyncLogger";

// ============================================================
// QBO PAYMENT TYPES
// ============================================================

export interface QBOPaymentLine {
  Amount: number;
  LinkedTxn?: Array<{
    TxnId: string;
    TxnType: string; // "Invoice", "CreditMemo", etc.
  }>;
}

export interface QBOPaymentResponse {
  Id: string;
  SyncToken: string;
  TxnDate: string; // Payment date
  TotalAmt: number;
  CustomerRef?: { value: string; name?: string };
  Line?: QBOPaymentLine[];
  PaymentMethodRef?: { value: string; name?: string };
  PaymentRefNum?: string; // Check number, reference, etc.
  PrivateNote?: string;
  MetaData?: {
    CreateTime: string;
    LastUpdatedTime: string;
  };
}

export interface QBOQueryResponse<T> {
  QueryResponse: {
    Payment?: T[];
    Invoice?: T[];
    Customer?: T[];
    startPosition?: number;
    maxResults?: number;
    totalCount?: number;
  };
  time: string;
}

// ============================================================
// PARSED TYPES FOR APP USE
// ============================================================

export interface ParsedQBOPayment {
  qboPaymentId: string;
  qboSyncToken: string;
  paymentDate: string;
  totalAmount: number;
  customerRefId: string | null;
  paymentMethod: string | null;
  reference: string | null;
  notes: string | null;
  linkedInvoices: Array<{
    qboInvoiceId: string;
    amount: number;
  }>;
}

export interface QBOInvoiceWithPayments {
  qboInvoiceId: string;
  qboSyncToken: string;
  docNumber: string | null;
  totalAmount: number;
  balance: number;
  amountPaid: number;
  payments: ParsedQBOPayment[];
}

// ============================================================
// SERVICE CLASS
// ============================================================

/**
 * QboReadService for fetching data from QBO
 */
export class QboReadService {
  private client: QboClient;
  private companyId: string;
  private logger: QboSyncLogger;

  constructor(client: QboClient, companyId: string, triggeredBy?: string) {
    this.client = client;
    this.companyId = companyId;
    this.logger = new QboSyncLogger(companyId, triggeredBy);
  }

  /**
   * Fetch a single invoice from QBO by ID
   * Returns parsed invoice data with balance information
   */
  async fetchInvoice(qboInvoiceId: string): Promise<{
    success: boolean;
    data?: QBOInvoiceWithPayments;
    error?: string;
  }> {
    const startTime = Date.now();

    try {
      const response = await this.client.getInvoice<{
        Id: string;
        SyncToken: string;
        DocNumber?: string;
        TotalAmt: number;
        Balance: number;
      }>(qboInvoiceId);

      const durationMs = Date.now() - startTime;

      if (!response.success || !response.data) {
        await this.logger.log({
          eventType: "INVOICE_READ",
          result: "FAILURE",
          qboEntityId: qboInvoiceId,
          errorMessage: response.error?.message || "Failed to fetch invoice",
          errorCode: response.error?.code,
          durationMs,
        });

        return {
          success: false,
          error: response.error?.message || "Failed to fetch invoice from QBO",
        };
      }

      const invoice = response.data;
      const amountPaid = invoice.TotalAmt - invoice.Balance;

      // Fetch payments linked to this invoice
      const payments = await this.fetchPaymentsForInvoice(qboInvoiceId);

      await this.logger.log({
        eventType: "INVOICE_READ",
        result: "SUCCESS",
        qboEntityId: qboInvoiceId,
        qboSyncToken: invoice.SyncToken,
        responsePayload: { invoice, paymentsCount: payments.length },
        durationMs,
      });

      return {
        success: true,
        data: {
          qboInvoiceId: invoice.Id,
          qboSyncToken: invoice.SyncToken,
          docNumber: invoice.DocNumber || null,
          totalAmount: invoice.TotalAmt,
          balance: invoice.Balance,
          amountPaid,
          payments,
        },
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      await this.logger.log({
        eventType: "INVOICE_READ",
        result: "FAILURE",
        qboEntityId: qboInvoiceId,
        errorMessage,
        durationMs,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Fetch all payments linked to a specific invoice from QBO
   * Uses QBO query to find payments that reference this invoice
   */
  async fetchPaymentsForInvoice(qboInvoiceId: string): Promise<ParsedQBOPayment[]> {
    const startTime = Date.now();

    try {
      // Query payments that have a line linked to this invoice
      // QBO Query Language: SELECT * FROM Payment WHERE Line.LinkedTxn.TxnId = 'invoiceId'
      // Note: QBO doesn't support direct filtering by LinkedTxn, so we query all payments
      // for the customer and filter locally, OR we use a broader query

      // Alternative approach: Query payments and filter by linked invoice
      const query = `SELECT * FROM Payment WHERE TotalAmt > 0 MAXRESULTS 1000`;

      const response = await this.client.get<QBOQueryResponse<QBOPaymentResponse>>(
        `/query?query=${encodeURIComponent(query)}`
      );

      const durationMs = Date.now() - startTime;

      if (!response.success || !response.data) {
        await this.logger.log({
          eventType: "PAYMENT_READ",
          result: "FAILURE",
          errorMessage: response.error?.message || "Failed to fetch payments",
          errorCode: response.error?.code,
          durationMs,
        });
        return [];
      }

      // Extract payments from QueryResponse
      const queryResponse = response.data as unknown as QBOQueryResponse<QBOPaymentResponse>;
      const allPayments = queryResponse.QueryResponse?.Payment || [];

      // Filter to only payments that are linked to this invoice
      const linkedPayments = allPayments.filter(payment => {
        if (!payment.Line) return false;
        return payment.Line.some(line =>
          line.LinkedTxn?.some(
            txn => txn.TxnType === "Invoice" && txn.TxnId === qboInvoiceId
          )
        );
      });

      // Parse the payments
      const parsedPayments: ParsedQBOPayment[] = linkedPayments.map(payment =>
        this.parseQBOPayment(payment, qboInvoiceId)
      );

      await this.logger.log({
        eventType: "PAYMENT_READ",
        result: "SUCCESS",
        qboEntityId: qboInvoiceId,
        responsePayload: { totalPayments: allPayments.length, linkedPayments: parsedPayments.length },
        durationMs,
      });

      return parsedPayments;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      await this.logger.log({
        eventType: "PAYMENT_READ",
        result: "FAILURE",
        qboEntityId: qboInvoiceId,
        errorMessage,
        durationMs,
      });

      return [];
    }
  }

  /**
   * Parse a QBO Payment response into our app format
   */
  private parseQBOPayment(payment: QBOPaymentResponse, targetInvoiceId?: string): ParsedQBOPayment {
    const linkedInvoices: Array<{ qboInvoiceId: string; amount: number }> = [];

    if (payment.Line) {
      for (const line of payment.Line) {
        if (line.LinkedTxn) {
          for (const txn of line.LinkedTxn) {
            if (txn.TxnType === "Invoice") {
              // If we're filtering for a specific invoice, only include that one
              if (!targetInvoiceId || txn.TxnId === targetInvoiceId) {
                linkedInvoices.push({
                  qboInvoiceId: txn.TxnId,
                  amount: line.Amount,
                });
              }
            }
          }
        }
      }
    }

    return {
      qboPaymentId: payment.Id,
      qboSyncToken: payment.SyncToken,
      paymentDate: payment.TxnDate,
      totalAmount: payment.TotalAmt,
      customerRefId: payment.CustomerRef?.value || null,
      paymentMethod: payment.PaymentMethodRef?.name || null,
      reference: payment.PaymentRefNum || null,
      notes: payment.PrivateNote || null,
      linkedInvoices,
    };
  }

  /**
   * Fetch invoice by our local invoice's QBO ID
   * Convenience method that validates the QBO ID exists first
   */
  async fetchInvoiceByLocalId(
    localInvoiceId: string,
    qboInvoiceId: string | null
  ): Promise<{
    success: boolean;
    data?: QBOInvoiceWithPayments;
    error?: string;
    skipped?: boolean;
    skipReason?: string;
  }> {
    if (!qboInvoiceId) {
      return {
        success: false,
        skipped: true,
        skipReason: "Invoice has not been synced to QBO (no qboInvoiceId)",
      };
    }

    return this.fetchInvoice(qboInvoiceId);
  }
}

// ============================================================
// FACTORY FUNCTION
// ============================================================

/**
 * Create a QboReadService instance
 */
export function createReadService(
  client: QboClient,
  companyId: string,
  triggeredBy?: string
): QboReadService {
  return new QboReadService(client, companyId, triggeredBy);
}
