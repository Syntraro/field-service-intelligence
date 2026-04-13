/**
 * Notification Service
 *
 * Event-driven notification emitters for V1 events:
 * - Quote approved/declined → notify office/owner
 * - Job scheduled/rescheduled → notify assigned technician
 * - SLA breach for action_required → notify office/owner
 * - QBO failure event → notify owner
 *
 * Uses deduplication to prevent spam.
 */

import { notificationRepository } from "../storage/notifications";
import type { NotificationType } from "@shared/schema";

// ============================================================================
// Types
// ============================================================================

interface QuoteNotificationParams {
  companyId: string;
  quoteId: string;
  quoteNumber: string;
  customerName: string;
  action: "approved" | "declined";
  declineReason?: string;
}

interface JobScheduledParams {
  companyId: string;
  jobId: string;
  jobNumber: string;
  clientName: string;
  scheduledDate: string;
  /** User ID to notify. 2026-04-12: renamed from `technicianUserId` — this is
   *  a notification recipient, not a visit-assignment field. */
  notifyUserId: string;
  isReschedule?: boolean;
}

interface SlaBreachParams {
  companyId: string;
  jobId: string;
  jobNumber: string;
  clientName: string;
  daysPending: number;
}

interface QboFailureParams {
  companyId: string;
  entityType: string;
  entityId: string;
  errorMessage: string;
}

// Role groups for targeting notifications
const OFFICE_ROLES = ["owner", "admin", "manager", "dispatcher"];
const OWNER_ONLY = ["owner"];

// ============================================================================
// Notification Emitters
// ============================================================================

/**
 * Emit notification when a quote is approved or declined
 */
export async function emitQuoteStatusChange(params: QuoteNotificationParams): Promise<void> {
  const { companyId, quoteId, quoteNumber, customerName, action, declineReason } = params;

  const type: NotificationType = action === "approved" ? "quote_approved" : "quote_declined";
  const title = action === "approved"
    ? `Quote #${quoteNumber} Approved`
    : `Quote #${quoteNumber} Declined`;

  const body = action === "approved"
    ? `${customerName} has approved your quote.`
    : `${customerName} has declined your quote.${declineReason ? ` Reason: ${declineReason}` : ""}`;

  const linkUrl = `/quotes/${quoteId}`;
  const dedupeKey = `quote_${action}_${quoteId}`;

  // Get office staff to notify
  const officeUsers = await notificationRepository.getUsersByRole(companyId, OFFICE_ROLES);

  if (officeUsers.length > 0) {
    await notificationRepository.createNotificationsForUsers(
      companyId,
      officeUsers.map((u) => u.id),
      {
        type,
        title,
        body,
        linkUrl,
        dedupeKey,
        relatedEntityType: "quote",
        relatedEntityId: quoteId,
      }
    );
  }
}

/**
 * Emit notification when a job is scheduled or rescheduled
 */
export async function emitJobScheduled(params: JobScheduledParams): Promise<void> {
  const { companyId, jobId, jobNumber, clientName, scheduledDate, notifyUserId, isReschedule } = params;

  const type: NotificationType = isReschedule ? "job_rescheduled" : "job_scheduled";
  const title = isReschedule
    ? `Job #${jobNumber} Rescheduled`
    : `New Job Scheduled: #${jobNumber}`;

  const formattedDate = new Date(scheduledDate).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const body = isReschedule
    ? `Job at ${clientName} has been rescheduled to ${formattedDate}.`
    : `You have a new job at ${clientName} on ${formattedDate}.`;

  const linkUrl = `/jobs/${jobId}`;
  // Use timestamp in dedupeKey to allow new notifications after reschedule
  const dedupeKey = `job_${isReschedule ? "resched" : "sched"}_${jobId}_${Date.now()}`;

  // Notify the assigned technician
  await notificationRepository.createNotification({
    companyId,
    userId: notifyUserId,
    type,
    title,
    body,
    linkUrl,
    dedupeKey,
    relatedEntityType: "job",
    relatedEntityId: jobId,
  });
}

/**
 * Emit notification for SLA breach (job stuck in action_required)
 */
export async function emitSlaBreachNotification(params: SlaBreachParams): Promise<void> {
  const { companyId, jobId, jobNumber, clientName, daysPending } = params;

  const type: NotificationType = "sla_breach";
  const title = `SLA Alert: Job #${jobNumber}`;
  const body = `Job at ${clientName} has been pending action for ${daysPending} day${daysPending === 1 ? "" : "s"}.`;
  const linkUrl = `/jobs/${jobId}`;
  // Daily dedupe - only one notification per day per job
  const today = new Date().toISOString().split("T")[0];
  const dedupeKey = `sla_breach_${jobId}_${today}`;

  // Get office staff to notify
  const officeUsers = await notificationRepository.getUsersByRole(companyId, OFFICE_ROLES);

  if (officeUsers.length > 0) {
    await notificationRepository.createNotificationsForUsers(
      companyId,
      officeUsers.map((u) => u.id),
      {
        type,
        title,
        body,
        linkUrl,
        dedupeKey,
        relatedEntityType: "job",
        relatedEntityId: jobId,
      }
    );
  }
}

/**
 * Emit notification for QBO sync failure
 */
export async function emitQboFailureNotification(params: QboFailureParams): Promise<void> {
  const { companyId, entityType, entityId, errorMessage } = params;

  const type: NotificationType = "qbo_failure";
  const title = "QuickBooks Sync Failed";
  const body = `Failed to sync ${entityType}: ${errorMessage.slice(0, 100)}${errorMessage.length > 100 ? "..." : ""}`;
  const linkUrl = "/settings/integrations";
  // Hourly dedupe per entity to avoid spam but still alert on repeated failures
  const hourKey = Math.floor(Date.now() / 3600000);
  const dedupeKey = `qbo_fail_${entityType}_${entityId}_${hourKey}`;

  // Notify owners only for QBO issues
  const owners = await notificationRepository.getUsersByRole(companyId, OWNER_ONLY);

  if (owners.length > 0) {
    await notificationRepository.createNotificationsForUsers(
      companyId,
      owners.map((u) => u.id),
      {
        type,
        title,
        body,
        linkUrl,
        dedupeKey,
        relatedEntityType: entityType,
        relatedEntityId: entityId,
      }
    );
  }
}

/**
 * Emit a generic system notification
 */
export async function emitSystemNotification(
  companyId: string,
  userIds: string[],
  title: string,
  body: string,
  linkUrl?: string,
  dedupeKey?: string
): Promise<void> {
  if (userIds.length === 0) return;

  await notificationRepository.createNotificationsForUsers(companyId, userIds, {
    type: "system",
    title,
    body,
    linkUrl,
    dedupeKey,
  });
}

// ============================================================================
// Export Service Object
// ============================================================================

export const notificationService = {
  emitQuoteStatusChange,
  emitJobScheduled,
  emitSlaBreachNotification,
  emitQboFailureNotification,
  emitSystemNotification,
};
