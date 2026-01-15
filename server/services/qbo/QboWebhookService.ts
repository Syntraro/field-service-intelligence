/**
 * QboWebhookService - Webhook handling for QBO integration
 *
 * Handles:
 * - Webhook signature verification (HMAC)
 * - Storing inbound webhook events
 * - Processing events to create drift alerts / enqueue reconcile jobs
 *
 * RULES:
 * - No auto-apply changes: only create alerts or enqueue jobs
 * - No token exposure
 * - companyId isolation via realmId mapping
 * - All processing must be manually triggered
 */

import crypto from "crypto";
import { db } from "../../db";
import { companies, invoices, qboWebhookEvents, qboSyncQueue } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import type { QboWebhookEvent, QboWebhookStatus } from "@shared/schema";

// ============================================================
// TYPES
// ============================================================

export interface IntuitWebhookPayload {
  eventNotifications: Array<{
    realmId: string;
    dataChangeEvent: {
      entities: Array<{
        name: string; // "Invoice", "Payment", "Customer", etc.
        id: string; // QBO entity ID
        operation: string; // "Create", "Update", "Delete", "Merge", "Void"
        lastUpdated: string; // ISO timestamp
      }>;
    };
  }>;
}

export interface WebhookVerificationResult {
  valid: boolean;
  error?: string;
}

export interface WebhookReceiveResult {
  success: boolean;
  eventsReceived: number;
  eventIds: string[];
  duplicatesIgnored: number;
  error?: string;
}

export interface WebhookProcessResult {
  processed: number;
  driftAlertsCreated: number;
  reconcileJobsEnqueued: number;
  ignored: number;
  errors: number;
  events: Array<{
    eventId: string;
    status: string;
    actionTaken?: string;
    error?: string;
  }>;
}

export interface DriftAlert {
  invoiceId: string;
  invoiceNumber: string | null;
  qboInvoiceId: string | null;
  qboEntityId: string;
  operation: string;
  lastUpdated: string | null;
  webhookEventId: string;
  status: "pending" | "reconciled" | "ignored";
}

// ============================================================
// SERVICE CLASS
// ============================================================

export class QboWebhookService {
  private webhookVerifierToken: string | null;

  constructor() {
    this.webhookVerifierToken = process.env.QBO_WEBHOOK_VERIFIER_TOKEN || null;
  }

  /**
   * Verify Intuit webhook signature using HMAC-SHA256
   * See: https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks/managing-webhooks-notifications
   */
  verifySignature(payload: string, signature: string): WebhookVerificationResult {
    if (!this.webhookVerifierToken) {
      return { valid: false, error: "Webhook verifier token not configured" };
    }

    try {
      // Intuit sends signature in base64 format
      const hmac = crypto.createHmac("sha256", this.webhookVerifierToken);
      hmac.update(payload);
      const expectedSignature = hmac.digest("base64");

      // Constant-time comparison to prevent timing attacks
      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );

      if (!isValid) {
        return { valid: false, error: "Invalid signature" };
      }

      return { valid: true };
    } catch (err) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : "Signature verification failed",
      };
    }
  }

  /**
   * Receive and store webhook events
   * Does NOT process them - just stores for later processing
   * Uses dedupeKey to prevent duplicate events
   */
  async receiveWebhook(
    payload: IntuitWebhookPayload,
    rawPayload: string,
    signature: string
  ): Promise<WebhookReceiveResult> {
    const eventIds: string[] = [];
    let duplicatesIgnored = 0;

    // Verify signature first
    const verification = this.verifySignature(rawPayload, signature);

    try {
      for (const notification of payload.eventNotifications || []) {
        const { realmId, dataChangeEvent } = notification;

        // Resolve companyId from realmId
        const [company] = await db
          .select({ id: companies.id })
          .from(companies)
          .where(eq(companies.qboRealmId, realmId))
          .limit(1);

        const companyId = company?.id || null;

        for (const entity of dataChangeEvent?.entities || []) {
          // Compute deduplication key - hash of unique event attributes
          const dedupeKey = this.computeDedupeKey(
            realmId,
            entity.name || "Other",
            entity.id,
            entity.operation,
            entity.lastUpdated
          );

          // Check for existing event with same dedupeKey
          const [existing] = await db
            .select({ id: qboWebhookEvents.id })
            .from(qboWebhookEvents)
            .where(eq(qboWebhookEvents.dedupeKey, dedupeKey))
            .limit(1);

          if (existing) {
            duplicatesIgnored++;
            continue; // Skip duplicate
          }

          // Redact sensitive data from payload for storage
          const redactedPayload = this.redactPayload({
            realmId,
            entity: {
              name: entity.name,
              id: entity.id,
              operation: entity.operation,
              lastUpdated: entity.lastUpdated,
            },
          });

          // Store the event
          const [event] = await db
            .insert(qboWebhookEvents)
            .values({
              realmId,
              companyId,
              dedupeKey,
              qboEntityType: entity.name || "Other",
              qboEntityId: entity.id,
              operation: entity.operation,
              lastUpdated: entity.lastUpdated ? new Date(entity.lastUpdated) : null,
              status: verification.valid ? "VERIFIED" : "REJECTED",
              verificationError: verification.error,
              eventPayload: redactedPayload,
            })
            .returning({ id: qboWebhookEvents.id });

          if (event) {
            eventIds.push(event.id);
          }
        }
      }

      return {
        success: true,
        eventsReceived: eventIds.length,
        eventIds,
        duplicatesIgnored,
      };
    } catch (err) {
      return {
        success: false,
        eventsReceived: 0,
        eventIds: [],
        duplicatesIgnored,
        error: err instanceof Error ? err.message : "Failed to receive webhook",
      };
    }
  }

  /**
   * Compute a SHA-256 hash for deduplication
   */
  private computeDedupeKey(
    realmId: string,
    entityType: string,
    entityId: string,
    operation: string,
    lastUpdated?: string
  ): string {
    const data = `${realmId}:${entityType}:${entityId}:${operation}:${lastUpdated || ""}`;
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  /**
   * Process verified webhook events
   * Creates drift alerts for invoices or enqueues reconcile jobs
   */
  async processWebhookEvents(
    companyId: string,
    limit: number = 50,
    triggeredBy?: string,
    processedRunId?: string
  ): Promise<WebhookProcessResult> {
    const result: WebhookProcessResult = {
      processed: 0,
      driftAlertsCreated: 0,
      reconcileJobsEnqueued: 0,
      ignored: 0,
      errors: 0,
      events: [],
    };

    // Get VERIFIED events for this company
    const events = await db
      .select()
      .from(qboWebhookEvents)
      .where(
        and(
          eq(qboWebhookEvents.companyId, companyId),
          eq(qboWebhookEvents.status, "VERIFIED")
        )
      )
      .orderBy(qboWebhookEvents.receivedAt)
      .limit(limit);

    for (const event of events) {
      try {
        const processResult = await this.processSingleEvent(event, triggeredBy, processedRunId);
        result.events.push(processResult);
        result.processed++;

        if (processResult.actionTaken === "RECONCILE_ENQUEUED") {
          result.reconcileJobsEnqueued++;
        } else if (processResult.actionTaken === "DRIFT_ALERT_CREATED") {
          result.driftAlertsCreated++;
        } else if (processResult.status === "IGNORED") {
          result.ignored++;
        }
      } catch (err) {
        result.errors++;
        result.events.push({
          eventId: event.id,
          status: "ERROR",
          error: err instanceof Error ? err.message : "Processing failed",
        });

        // Update event with error
        await db
          .update(qboWebhookEvents)
          .set({
            processingError: err instanceof Error ? err.message : "Processing failed",
          })
          .where(eq(qboWebhookEvents.id, event.id));
      }
    }

    return result;
  }

  /**
   * Process a single webhook event
   */
  private async processSingleEvent(
    event: QboWebhookEvent,
    triggeredBy?: string,
    processedRunId?: string
  ): Promise<{ eventId: string; status: string; actionTaken?: string; error?: string }> {
    const { id, qboEntityType, qboEntityId, operation, companyId } = event;

    // Only process Invoice and Payment events
    if (qboEntityType !== "Invoice" && qboEntityType !== "Payment") {
      await db
        .update(qboWebhookEvents)
        .set({
          status: "IGNORED",
          actionTaken: `Ignored: ${qboEntityType} events not processed`,
          processedRunId,
          processedAt: new Date(),
        })
        .where(eq(qboWebhookEvents.id, id));

      return { eventId: id, status: "IGNORED", actionTaken: `Ignored: ${qboEntityType}` };
    }

    if (!companyId) {
      await db
        .update(qboWebhookEvents)
        .set({
          status: "IGNORED",
          actionTaken: "Ignored: No company mapping for realmId",
          processedRunId,
          processedAt: new Date(),
        })
        .where(eq(qboWebhookEvents.id, id));

      return { eventId: id, status: "IGNORED", actionTaken: "No company mapping" };
    }

    // For Invoice events: find the local invoice and enqueue reconcile
    if (qboEntityType === "Invoice") {
      // Find invoice by qboInvoiceId
      const [invoice] = await db
        .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber })
        .from(invoices)
        .where(
          and(
            eq(invoices.companyId, companyId),
            eq(invoices.qboInvoiceId, qboEntityId)
          )
        )
        .limit(1);

      if (invoice) {
        // Enqueue reconcile dry-run job
        const [job] = await db
          .insert(qboSyncQueue)
          .values({
            companyId,
            entityType: "INVOICE",
            entityId: invoice.id,
            action: "RECONCILE",
            status: "QUEUED",
            enqueuedBy: triggeredBy,
          })
          .returning({ id: qboSyncQueue.id });

        await db
          .update(qboWebhookEvents)
          .set({
            status: "PROCESSED",
            actionTaken: "RECONCILE_ENQUEUED",
            relatedInvoiceId: invoice.id,
            queueJobId: job?.id,
            processedRunId,
            processedAt: new Date(),
          })
          .where(eq(qboWebhookEvents.id, id));

        return {
          eventId: id,
          status: "PROCESSED",
          actionTaken: "RECONCILE_ENQUEUED",
        };
      } else {
        // Invoice not found locally - create drift alert
        await db
          .update(qboWebhookEvents)
          .set({
            status: "PROCESSED",
            actionTaken: "DRIFT_ALERT_CREATED",
            processedRunId,
            processedAt: new Date(),
          })
          .where(eq(qboWebhookEvents.id, id));

        return {
          eventId: id,
          status: "PROCESSED",
          actionTaken: "DRIFT_ALERT_CREATED",
        };
      }
    }

    // For Payment events: find invoices that might be affected
    if (qboEntityType === "Payment") {
      // Payments are harder to map without fetching from QBO
      // For now, create a drift alert and let admin investigate
      await db
        .update(qboWebhookEvents)
        .set({
          status: "PROCESSED",
          actionTaken: "DRIFT_ALERT_CREATED",
          processedRunId,
          processedAt: new Date(),
        })
        .where(eq(qboWebhookEvents.id, id));

      return {
        eventId: id,
        status: "PROCESSED",
        actionTaken: "DRIFT_ALERT_CREATED",
      };
    }

    // Default: ignore
    await db
      .update(qboWebhookEvents)
      .set({
        status: "IGNORED",
        actionTaken: "No action defined",
        processedRunId,
        processedAt: new Date(),
      })
      .where(eq(qboWebhookEvents.id, id));

    return { eventId: id, status: "IGNORED", actionTaken: "No action defined" };
  }

  /**
   * Get webhook events with optional filtering
   */
  async getWebhookEvents(
    companyId: string | null,
    options: {
      status?: string;
      entityType?: string;
      limit?: number;
    } = {}
  ): Promise<QboWebhookEvent[]> {
    const { status, entityType, limit = 50 } = options;

    const conditions = [];

    if (companyId) {
      conditions.push(eq(qboWebhookEvents.companyId, companyId));
    }

    if (status) {
      conditions.push(eq(qboWebhookEvents.status, status));
    }

    if (entityType) {
      conditions.push(eq(qboWebhookEvents.qboEntityType, entityType));
    }

    const query = conditions.length > 0
      ? db.select().from(qboWebhookEvents).where(and(...conditions))
      : db.select().from(qboWebhookEvents);

    return query.orderBy(desc(qboWebhookEvents.receivedAt)).limit(limit);
  }

  /**
   * Get drift alerts (invoice/payment events that need attention)
   */
  async getDriftAlerts(companyId: string): Promise<DriftAlert[]> {
    // Get processed events that created drift alerts
    const events = await db
      .select({
        id: qboWebhookEvents.id,
        qboEntityType: qboWebhookEvents.qboEntityType,
        qboEntityId: qboWebhookEvents.qboEntityId,
        operation: qboWebhookEvents.operation,
        lastUpdated: qboWebhookEvents.lastUpdated,
        relatedInvoiceId: qboWebhookEvents.relatedInvoiceId,
        queueJobId: qboWebhookEvents.queueJobId,
        actionTaken: qboWebhookEvents.actionTaken,
      })
      .from(qboWebhookEvents)
      .where(
        and(
          eq(qboWebhookEvents.companyId, companyId),
          eq(qboWebhookEvents.actionTaken, "DRIFT_ALERT_CREATED")
        )
      )
      .orderBy(desc(qboWebhookEvents.receivedAt))
      .limit(100);

    const alerts: DriftAlert[] = [];

    for (const event of events) {
      // If we have a related invoice, get its details
      let invoiceDetails = null;
      if (event.relatedInvoiceId) {
        const [inv] = await db
          .select({
            invoiceNumber: invoices.invoiceNumber,
            qboInvoiceId: invoices.qboInvoiceId,
          })
          .from(invoices)
          .where(eq(invoices.id, event.relatedInvoiceId))
          .limit(1);
        invoiceDetails = inv;
      }

      alerts.push({
        invoiceId: event.relatedInvoiceId || "",
        invoiceNumber: invoiceDetails?.invoiceNumber || null,
        qboInvoiceId: invoiceDetails?.qboInvoiceId || null,
        qboEntityId: event.qboEntityId,
        operation: event.operation,
        lastUpdated: event.lastUpdated?.toISOString() || null,
        webhookEventId: event.id,
        status: event.queueJobId ? "reconciled" : "pending",
      });
    }

    return alerts;
  }

  /**
   * Redact sensitive data from webhook payload
   */
  private redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
    // For now, webhook payloads don't contain tokens
    // but we still redact any potentially sensitive fields
    const sensitivePatterns = /token|secret|password|key|auth|bearer/i;

    const redactObject = (obj: Record<string, unknown>): Record<string, unknown> => {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (sensitivePatterns.test(key)) {
          result[key] = "[REDACTED]";
        } else if (value && typeof value === "object" && !Array.isArray(value)) {
          result[key] = redactObject(value as Record<string, unknown>);
        } else {
          result[key] = value;
        }
      }
      return result;
    };

    return redactObject(payload);
  }
}

// ============================================================
// FACTORY FUNCTION
// ============================================================

export function createWebhookService(): QboWebhookService {
  return new QboWebhookService();
}
