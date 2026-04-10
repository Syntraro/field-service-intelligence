/**
 * QboSyncLogger - Audit logging for QBO sync operations
 *
 * Writes all sync events (success, failure, skipped) to qbo_sync_events table.
 * Provides a complete audit trail for debugging and compliance.
 */

import { db } from "../../db";
import { qboSyncEvents } from "@shared/schema";
import type { QboSyncEventType, QboSyncResult, InsertQboSyncEvent } from "@shared/schema";

export interface SyncEventParams {
  companyId: string;
  eventType: QboSyncEventType;
  result: QboSyncResult;
  // Entity references (set one based on event type)
  customerCompanyId?: string | null;
  clientLocationId?: string | null;
  invoiceId?: string | null;
  itemId?: string | null;
  // 2026-04-09: paymentId for outbound payment sync events (PAYMENT_CREATE / UPDATE / DELETE).
  paymentId?: string | null;
  // QBO references
  qboEntityId?: string | null;
  qboSyncToken?: string | null;
  // Request/response data
  requestPayload?: unknown;
  responsePayload?: unknown;
  // Error info
  errorMessage?: string | null;
  errorCode?: string | null;
  // User context
  triggeredBy?: string | null;
  // Run correlation
  syncRunId?: string | null;
  // Timing
  durationMs?: number | null;
}

/**
 * QboSyncLogger class for logging sync events
 */
export class QboSyncLogger {
  private companyId: string;
  private triggeredBy: string | null;
  private syncRunId: string | null;

  constructor(companyId: string, triggeredBy?: string | null, syncRunId?: string | null) {
    this.companyId = companyId;
    this.triggeredBy = triggeredBy ?? null;
    this.syncRunId = syncRunId ?? null;
  }

  /**
   * Set the syncRunId for this logger (useful for updating after construction)
   */
  setSyncRunId(syncRunId: string): void {
    this.syncRunId = syncRunId;
  }

  /**
   * Get the current syncRunId
   */
  getSyncRunId(): string | null {
    return this.syncRunId;
  }

  /**
   * Log a sync event
   */
  async log(params: Omit<SyncEventParams, "companyId" | "triggeredBy" | "syncRunId">): Promise<void> {
    try {
      const event: InsertQboSyncEvent = {
        companyId: this.companyId,
        eventType: params.eventType,
        result: params.result,
        customerCompanyId: params.customerCompanyId ?? null,
        clientLocationId: params.clientLocationId ?? null,
        invoiceId: params.invoiceId ?? null,
        itemId: params.itemId ?? null,
        // 2026-04-09: paymentId for outbound payment events
        paymentId: params.paymentId ?? null,
        qboEntityId: params.qboEntityId ?? null,
        qboSyncToken: params.qboSyncToken ?? null,
        requestPayload: params.requestPayload ? JSON.stringify(params.requestPayload) : null,
        responsePayload: params.responsePayload ? JSON.stringify(params.responsePayload) : null,
        errorMessage: params.errorMessage ?? null,
        errorCode: params.errorCode ?? null,
        triggeredBy: this.triggeredBy,
        syncRunId: this.syncRunId,
        durationMs: params.durationMs ?? null,
      };

      await db.insert(qboSyncEvents).values(event);
    } catch (err) {
      // Log to console but don't throw - audit logging should never break sync
      console.error("[QboSyncLogger] Failed to log sync event:", err);
    }
  }

  /**
   * Log a successful customer create/update
   */
  async logCustomerSuccess(
    eventType: "CUSTOMER_CREATE" | "CUSTOMER_UPDATE",
    params: {
      customerCompanyId?: string;
      clientLocationId?: string;
      qboCustomerId: string;
      qboSyncToken: string;
      requestPayload?: unknown;
      responsePayload?: unknown;
      durationMs?: number;
    }
  ): Promise<void> {
    await this.log({
      eventType,
      result: "SUCCESS",
      customerCompanyId: params.customerCompanyId,
      clientLocationId: params.clientLocationId,
      qboEntityId: params.qboCustomerId,
      qboSyncToken: params.qboSyncToken,
      requestPayload: params.requestPayload,
      responsePayload: params.responsePayload,
      durationMs: params.durationMs,
    });
  }

  /**
   * Log a failed customer create/update
   */
  async logCustomerFailure(
    eventType: "CUSTOMER_CREATE" | "CUSTOMER_UPDATE",
    params: {
      customerCompanyId?: string;
      clientLocationId?: string;
      errorMessage: string;
      errorCode?: string;
      requestPayload?: unknown;
      responsePayload?: unknown;
      durationMs?: number;
    }
  ): Promise<void> {
    await this.log({
      eventType,
      result: "FAILURE",
      customerCompanyId: params.customerCompanyId,
      clientLocationId: params.clientLocationId,
      errorMessage: params.errorMessage,
      errorCode: params.errorCode,
      requestPayload: params.requestPayload,
      responsePayload: params.responsePayload,
      durationMs: params.durationMs,
    });
  }

  /**
   * Log a skipped customer sync (e.g., validation failed)
   */
  async logCustomerSkipped(
    eventType: "CUSTOMER_CREATE" | "CUSTOMER_UPDATE",
    params: {
      customerCompanyId?: string;
      clientLocationId?: string;
      reason: string;
    }
  ): Promise<void> {
    await this.log({
      eventType,
      result: "SKIPPED",
      customerCompanyId: params.customerCompanyId,
      clientLocationId: params.clientLocationId,
      errorMessage: params.reason,
    });
  }

  /**
   * Log a successful invoice create
   */
  async logInvoiceSuccess(
    eventType: "INVOICE_CREATE" | "INVOICE_UPDATE",
    params: {
      invoiceId: string;
      qboInvoiceId: string;
      qboSyncToken: string;
      requestPayload?: unknown;
      responsePayload?: unknown;
      durationMs?: number;
    }
  ): Promise<void> {
    await this.log({
      eventType,
      result: "SUCCESS",
      invoiceId: params.invoiceId,
      qboEntityId: params.qboInvoiceId,
      qboSyncToken: params.qboSyncToken,
      requestPayload: params.requestPayload,
      responsePayload: params.responsePayload,
      durationMs: params.durationMs,
    });
  }

  /**
   * Log a failed invoice create
   */
  async logInvoiceFailure(
    eventType: "INVOICE_CREATE" | "INVOICE_UPDATE",
    params: {
      invoiceId: string;
      errorMessage: string;
      errorCode?: string;
      requestPayload?: unknown;
      responsePayload?: unknown;
      durationMs?: number;
    }
  ): Promise<void> {
    await this.log({
      eventType,
      result: "FAILURE",
      invoiceId: params.invoiceId,
      errorMessage: params.errorMessage,
      errorCode: params.errorCode,
      requestPayload: params.requestPayload,
      responsePayload: params.responsePayload,
      durationMs: params.durationMs,
    });
  }

  /**
   * Log a skipped invoice sync (e.g., draft invoice)
   */
  async logInvoiceSkipped(
    eventType: "INVOICE_CREATE" | "INVOICE_UPDATE",
    params: {
      invoiceId: string;
      reason: string;
    }
  ): Promise<void> {
    await this.log({
      eventType,
      result: "SKIPPED",
      invoiceId: params.invoiceId,
      errorMessage: params.reason,
    });
  }

  // ==========================================================================
  // 2026-04-09: Outbound payment sync logging (App → QBO).
  // Mirrors the invoice helpers above. The `paymentId` is captured directly
  // (using the new qboSyncEvents.paymentId column added in the same migration)
  // and `invoiceId` is captured alongside for cross-entity correlation.
  // ==========================================================================

  /**
   * Log a successful outbound payment sync
   */
  async logPaymentSuccess(
    eventType: "PAYMENT_CREATE" | "PAYMENT_UPDATE" | "PAYMENT_DELETE",
    params: {
      paymentId: string;
      invoiceId: string;
      qboPaymentId: string;
      qboSyncToken: string;
      requestPayload?: unknown;
      responsePayload?: unknown;
      durationMs?: number;
    }
  ): Promise<void> {
    await this.log({
      eventType,
      result: "SUCCESS",
      paymentId: params.paymentId,
      invoiceId: params.invoiceId,
      qboEntityId: params.qboPaymentId,
      qboSyncToken: params.qboSyncToken,
      requestPayload: params.requestPayload,
      responsePayload: params.responsePayload,
      durationMs: params.durationMs,
    });
  }

  /**
   * Log a failed outbound payment sync
   */
  async logPaymentFailure(
    eventType: "PAYMENT_CREATE" | "PAYMENT_UPDATE" | "PAYMENT_DELETE",
    params: {
      paymentId: string;
      invoiceId: string;
      errorMessage: string;
      errorCode?: string;
      requestPayload?: unknown;
      responsePayload?: unknown;
      durationMs?: number;
    }
  ): Promise<void> {
    await this.log({
      eventType,
      result: "FAILURE",
      paymentId: params.paymentId,
      invoiceId: params.invoiceId,
      errorMessage: params.errorMessage,
      errorCode: params.errorCode,
      requestPayload: params.requestPayload,
      responsePayload: params.responsePayload,
      durationMs: params.durationMs,
    });
  }

  /**
   * Log a skipped outbound payment sync (e.g., parent invoice not synced)
   */
  async logPaymentSkipped(
    eventType: "PAYMENT_CREATE" | "PAYMENT_UPDATE" | "PAYMENT_DELETE",
    params: {
      paymentId: string;
      invoiceId: string;
      reason: string;
    }
  ): Promise<void> {
    await this.log({
      eventType,
      result: "SKIPPED",
      paymentId: params.paymentId,
      invoiceId: params.invoiceId,
      errorMessage: params.reason,
    });
  }
}

/**
 * Create a QboSyncLogger instance
 */
export function createSyncLogger(companyId: string, triggeredBy?: string, syncRunId?: string): QboSyncLogger {
  return new QboSyncLogger(companyId, triggeredBy, syncRunId);
}

/**
 * Standalone function to log a sync event (for use outside of a logger instance)
 */
export async function logSyncEvent(params: SyncEventParams): Promise<void> {
  const logger = new QboSyncLogger(params.companyId, params.triggeredBy);
  await logger.log(params);
}
