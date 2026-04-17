/**
 * Delivery Notification Service (Phase 16, 2026-04-12).
 *
 * When an email_deliveries row transitions to failed / bounced /
 * complained, notify the tenant's office users (owners, admins, managers).
 * Technicians are NOT notified.
 *
 * Reuses the existing `notifications` table + `notificationRepository`
 * infrastructure — no new table, no parallel notification system. The
 * dedupe-key mechanism on notificationRepository prevents duplicate
 * notifications for the same (delivery, status) tuple.
 *
 * Deliberately narrow: this module exposes exactly one call site used by
 * the delivery tracking service.
 */

import { storage } from "../storage/index";
import { notificationRepository } from "../storage/notifications";
import { quoteRepository } from "../storage/quotes";
import type {
  CommunicationTemplateEntityType,
  EmailDelivery,
} from "@shared/schema";

export type DeliveryProblemStatus = "failed" | "bounced" | "complained";

const OFFICE_ROLES = ["owner", "admin", "manager"] as const;

function buildMessage(params: {
  status: DeliveryProblemStatus;
  entityType: CommunicationTemplateEntityType;
  entityLabel: string;
  recipients: string[];
  errorMessage: string | null;
}): { title: string; body: string } {
  const { status, entityType, entityLabel, recipients, errorMessage } = params;
  const prettyEntity =
    entityType === "invoice" ? "Invoice" : entityType === "quote" ? "Quote" : "Job";
  const recipientPhrase =
    recipients.length === 1
      ? recipients[0]
      : recipients.length > 1
        ? `${recipients[0]} and ${recipients.length - 1} other${recipients.length - 1 === 1 ? "" : "s"}`
        : "the recipient";

  switch (status) {
    case "failed":
      return {
        title: `${prettyEntity} ${entityLabel} email failed to send`,
        body:
          errorMessage
            ? `${prettyEntity} ${entityLabel} could not be emailed: ${errorMessage}`
            : `${prettyEntity} ${entityLabel} could not be emailed.`,
      };
    case "bounced":
      return {
        title: `${prettyEntity} ${entityLabel} email bounced`,
        body: `${prettyEntity} ${entityLabel} email bounced from ${recipientPhrase}.`,
      };
    case "complained":
      return {
        title: `${prettyEntity} ${entityLabel} marked as spam`,
        body: `A recipient marked ${prettyEntity} ${entityLabel} email as spam.`,
      };
  }
}

function linkForEntity(entityType: CommunicationTemplateEntityType, entityId: string): string {
  switch (entityType) {
    case "invoice":
    case "invoice_reminder":
      // 2026-04-16: reminder notifications deep-link to the same invoice detail.
      return `/invoices/${entityId}`;
    case "quote":   return `/quotes/${entityId}`;
    case "job":     return `/jobs/${entityId}`;
  }
}

async function resolveEntityLabel(
  tenantId: string,
  entityType: CommunicationTemplateEntityType,
  entityId: string,
): Promise<string> {
  try {
    if (entityType === "invoice") {
      const inv = await storage.getInvoice(tenantId, entityId);
      return inv?.invoiceNumber ? `#${inv.invoiceNumber}` : entityId.slice(0, 8);
    }
    if (entityType === "quote") {
      const q = await quoteRepository.getQuote(tenantId, entityId);
      return (q as any)?.quoteNumber ? `#${(q as any).quoteNumber}` : entityId.slice(0, 8);
    }
    if (entityType === "job") {
      const j = await storage.getJob(tenantId, entityId);
      return (j as any)?.jobNumber ? `#${(j as any).jobNumber}` : entityId.slice(0, 8);
    }
  } catch {
    // swallow; the label is cosmetic
  }
  return entityId.slice(0, 8);
}

/**
 * Emit one notification per office user for a delivery problem. Silently
 * becomes a no-op if notification plumbing errors — the email send path
 * must not fail just because a notification couldn't be written.
 */
export async function notifyDeliveryProblem(
  delivery: EmailDelivery,
  status: DeliveryProblemStatus,
): Promise<void> {
  try {
    const entityType = delivery.entityType as CommunicationTemplateEntityType;
    const recipients = Array.isArray(delivery.recipientsJson)
      ? (delivery.recipientsJson as unknown as string[])
      : [];

    const officeUsers = await notificationRepository.getUsersByRole(
      delivery.tenantId,
      OFFICE_ROLES as unknown as string[],
    );
    if (officeUsers.length === 0) return;

    const entityLabel = await resolveEntityLabel(
      delivery.tenantId,
      entityType,
      delivery.entityId,
    );
    const { title, body } = buildMessage({
      status,
      entityType,
      entityLabel,
      recipients,
      errorMessage: delivery.errorMessage,
    });

    // Dedupe key: one notification per (delivery, status) tuple. The
    // existing `notifications_dedupe_idx` unique constraint on
    // (user_id, dedupe_key) prevents repeat inserts per user.
    const dedupeKey = `email_delivery:${delivery.id}:${status}`;

    await notificationRepository.createNotificationsForUsers(
      delivery.tenantId,
      officeUsers.map((u) => u.id),
      {
        type: "system",
        title,
        body,
        linkUrl: linkForEntity(entityType, delivery.entityId),
        dedupeKey,
        relatedEntityType: entityType,
        relatedEntityId: delivery.entityId,
      },
    );
  } catch (err) {
    // Never bubble notification errors into the email send path.
    // eslint-disable-next-line no-console
    console.warn("[deliveryNotificationService] failed to emit notification:", err);
  }
}
