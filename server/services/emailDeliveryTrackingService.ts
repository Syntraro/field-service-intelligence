/**
 * Email Delivery Tracking Service (Phase 10, 2026-04-12).
 *
 * Thin orchestration wrapper around `emailDeliveriesStorage`. Callers (the
 * dispatch service) go through this file so the lifecycle choices — what
 * counts as "sent", what error shape gets persisted, what webhook statuses
 * are allowed — stay in one place.
 */

import { createError } from "../middleware/errorHandler";
import {
  emailDeliveriesStorage,
  type CreateDeliveryAttemptRow,
  type MarkWebhookStatusPatch,
} from "../storage/emailDeliveriesStorage";
import type {
  CommunicationTemplateEntityType,
  EmailDelivery,
  EmailDeliveryStatus,
} from "@shared/schema";
// Phase 16 (2026-04-12): failure/bounce notifications to tenant office users.
import {
  notifyDeliveryProblem,
  type DeliveryProblemStatus,
} from "./deliveryNotificationService";

export interface CreateQueuedDeliveryInput
  extends Omit<CreateDeliveryAttemptRow, "provider" | "channel"> {
  provider?: string;
  /** Phase 17: if this queued row is a resend child, set the parent id. */
  retriedFromDeliveryId?: string | null;
}

export interface MarkSentInput {
  tenantId: string;
  deliveryId: string;
  providerMessageId: string | null;
}

export interface MarkFailedInput {
  tenantId: string;
  deliveryId: string;
  errorMessage: string;
}

export interface MarkWebhookStatusInput {
  tenantId: string;
  providerMessageId: string;
  status: EmailDeliveryStatus;
  deliveredAt?: Date | null;
  errorMessage?: string | null;
}

const WEBHOOK_STATUSES: ReadonlySet<EmailDeliveryStatus> = new Set<EmailDeliveryStatus>([
  "delivered",
  "bounced",
  "complained",
]);

/**
 * Phase 15: decide whether the UI should offer a one-time Resend.
 * Policy: only `failed` or `bounced` rows, and only when they have not
 * already been retried once (resend_count < 1). Phase 17 enforces this
 * server-side too.
 */
export function canResendDelivery(d: EmailDelivery): boolean {
  if (d.status !== "failed" && d.status !== "bounced") return false;
  if ((d.resendCount ?? 0) >= 1) return false;
  return true;
}

export interface DeliverySummary {
  id: string;
  status: EmailDeliveryStatus;
  subject: string | null;
  recipientCount: number;
  recipients: string[];
  templateSource: string;
  providerMessageId: string | null;
  sentAt: string | null;
  failedAt: string | null;
  deliveredAt: string | null;
  errorMessage: string | null;
  canResend: boolean;
  resendCount: number;
  retriedFromDeliveryId: string | null;
  createdAt: string;
}

function toSummary(d: EmailDelivery): DeliverySummary {
  const recipients = Array.isArray(d.recipientsJson)
    ? (d.recipientsJson as unknown as string[])
    : [];
  return {
    id: d.id,
    status: d.status as EmailDeliveryStatus,
    subject: d.subject,
    recipientCount: d.recipientCount,
    recipients,
    templateSource: d.templateSource,
    providerMessageId: d.providerMessageId,
    sentAt: d.sentAt ? d.sentAt.toISOString() : null,
    failedAt: d.failedAt ? d.failedAt.toISOString() : null,
    deliveredAt: d.deliveredAt ? d.deliveredAt.toISOString() : null,
    errorMessage: d.errorMessage,
    canResend: canResendDelivery(d),
    resendCount: d.resendCount ?? 0,
    retriedFromDeliveryId: d.retriedFromDeliveryId ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

export const emailDeliveryTrackingService = {
  /** Create a 'queued' row. Called right before the provider send. */
  async createQueuedDelivery(input: CreateQueuedDeliveryInput): Promise<EmailDelivery> {
    if (!input.tenantId) throw createError(400, "tenantId is required");
    if (!input.entityId) throw createError(400, "entityId is required");
    if (!Array.isArray(input.recipients)) {
      throw createError(400, "recipients must be an array");
    }
    return emailDeliveriesStorage.createDeliveryAttempt({
      ...input,
      channel: "email",
    });
  },

  /** Flip to 'sent' + persist provider message id. */
  async markSent(input: MarkSentInput): Promise<EmailDelivery | null> {
    if (!input.tenantId) throw createError(400, "tenantId is required");
    if (!input.deliveryId) throw createError(400, "deliveryId is required");
    return emailDeliveriesStorage.markDeliverySent(input.tenantId, input.deliveryId, {
      providerMessageId: input.providerMessageId,
    });
  },

  /** Flip to 'failed' + persist error string. Emits office-user notifications. */
  async markFailed(input: MarkFailedInput): Promise<EmailDelivery | null> {
    if (!input.tenantId) throw createError(400, "tenantId is required");
    if (!input.deliveryId) throw createError(400, "deliveryId is required");
    const row = await emailDeliveriesStorage.markDeliveryFailed(input.tenantId, input.deliveryId, {
      errorMessage: (input.errorMessage ?? "").slice(0, 2000),
    });
    // Phase 16: notify office users. Fire-and-forget; never blocks the send path.
    if (row) {
      void notifyDeliveryProblem(row, "failed");
    }
    return row;
  },

  /**
   * Webhook-driven lifecycle update. Only 'delivered' | 'bounced' |
   * 'complained' are accepted here; other transitions go through
   * markSent / markFailed.
   */
  async markWebhookStatus(input: MarkWebhookStatusInput): Promise<EmailDelivery | null> {
    if (!input.tenantId) throw createError(400, "tenantId is required");
    if (!input.providerMessageId) throw createError(400, "providerMessageId is required");
    if (!WEBHOOK_STATUSES.has(input.status)) {
      throw createError(400, `Unsupported webhook status: ${input.status}`);
    }
    const existing = await emailDeliveriesStorage.getDeliveryByProviderMessageId(
      input.tenantId,
      input.providerMessageId,
    );
    if (!existing) return null;

    const patch: MarkWebhookStatusPatch = {
      status: input.status,
      deliveredAt: input.status === "delivered" ? input.deliveredAt ?? new Date() : undefined,
      errorMessage: input.errorMessage ?? undefined,
    };
    const updated = await emailDeliveriesStorage.markDeliveryStatus(
      input.tenantId,
      existing.id,
      patch,
    );
    // Phase 16: failure/bounce/complaint → notify office users (dedupe in storage).
    if (
      updated &&
      (input.status === "bounced" || input.status === "complained" || input.status === "failed")
    ) {
      void notifyDeliveryProblem(updated, input.status as DeliveryProblemStatus);
    }
    return updated;
  },

  /** Phase 15: list deliveries for an entity, newest first, pre-summarized. */
  async getEntityDeliveries(input: {
    tenantId: string;
    entityType: CommunicationTemplateEntityType;
    entityId: string;
    limit?: number;
  }): Promise<DeliverySummary[]> {
    if (!input.tenantId) throw createError(400, "tenantId is required");
    if (!input.entityId) throw createError(400, "entityId is required");
    const rows = await emailDeliveriesStorage.getDeliveriesByEntity(
      input.tenantId,
      input.entityType,
      input.entityId,
      input.limit ?? 20,
    );
    return rows.map(toSummary);
  },

  /**
   * Phase 17: one-time resend of a failed/bounced delivery.
   *
   * Policy:
   *   - status must be 'failed' or 'bounced'
   *   - resendCount must be < 1
   *   - always creates a NEW delivery row; original is only incremented
   *   - replays the original snapshot subject/body/recipients (not the
   *     current template — the caller explicitly asked for "the same
   *     communication once again")
   */
  async resendDelivery(input: {
    tenantId: string;
    deliveryId: string;
    userId?: string | null;
  }): Promise<{ ok: true; newDeliveryId: string; status: EmailDeliveryStatus }> {
    const { tenantId, deliveryId, userId } = input;
    if (!tenantId) throw createError(400, "tenantId is required");
    if (!deliveryId) throw createError(400, "deliveryId is required");

    const original = await emailDeliveriesStorage.getDeliveryById(tenantId, deliveryId);
    if (!original) throw createError(404, "Delivery not found");
    if (!canResendDelivery(original)) {
      throw createError(
        400,
        `Delivery not eligible for resend (status=${original.status}, resendCount=${original.resendCount ?? 0})`,
      );
    }

    const recipients = Array.isArray(original.recipientsJson)
      ? (original.recipientsJson as unknown as string[])
      : [];
    if (recipients.length === 0) {
      throw createError(400, "Original delivery has no recipients to resend to");
    }

    const snapshotSubject = original.subject ?? "";
    const snapshotBody = original.bodySnapshot ?? "";
    if (!snapshotSubject.trim() || !snapshotBody.trim()) {
      throw createError(400, "Original delivery snapshot is incomplete");
    }

    // Lazy import to avoid a circular module reference (dispatch imports tracking).
    const { emailDispatchService } = await import("./emailDispatchService");

    const entityType = original.entityType as CommunicationTemplateEntityType;
    const common = {
      tenantId,
      recipients,
      subjectOverride: snapshotSubject,
      bodyOverride: snapshotBody,
      createdByUserId: userId ?? null,
      parentDeliveryId: original.id,
    };

    let dispatchResult: { emailId: string | null };
    if (entityType === "invoice") {
      dispatchResult = await emailDispatchService.sendInvoiceEmail({
        ...common,
        invoiceId: original.entityId,
      });
    } else if (entityType === "quote") {
      dispatchResult = await emailDispatchService.sendQuoteEmail({
        ...common,
        quoteId: original.entityId,
      });
    } else if (entityType === "job") {
      dispatchResult = await emailDispatchService.sendJobEmail({
        ...common,
        jobId: original.entityId,
      });
    } else {
      throw createError(400, `Unsupported entityType: ${entityType}`);
    }

    // Increment the original row's resend_count only after the new send
    // succeeds — if the send throws, the counter stays at 0 so the user
    // can try again once the underlying issue is fixed. (Failure of the
    // new attempt still creates a new 'failed' delivery row via the
    // dispatch path; that row is not the original and does not re-open
    // eligibility on the original.)
    await emailDeliveriesStorage.incrementResendCount(tenantId, original.id);

    // Locate the newly-created child delivery row. It's the newest row
    // under this entity whose retried_from_delivery_id points at the
    // original.
    const latest = await emailDeliveriesStorage.getDeliveriesByEntity(
      tenantId,
      entityType,
      original.entityId,
      5,
    );
    const child = latest.find((d) => d.retriedFromDeliveryId === original.id) ?? null;

    return {
      ok: true,
      newDeliveryId: child?.id ?? "",
      status: (child?.status ?? "sent") as EmailDeliveryStatus,
    };
  },
};
