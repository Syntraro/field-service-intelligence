/**
 * Subscription Worker
 *
 * Daily job that handles:
 * 1. Renewal notices (30 days and 7 days before annual term end)
 * 2. End-of-term processing:
 *    - Auto-renew annual subscriptions (if autoRenewAnnual = true)
 *    - Revert to monthly (if autoRenewAnnual = false and not cancelled)
 *    - Skip cancelled subscriptions
 *
 * IDEMPOTENCY: All operations use the subscriptionEvents table as an idempotency guard.
 * The unique constraint on (subscriptionId, type, termEndDate) prevents duplicate processing.
 *
 * Usage:
 *   - Call runSubscriptionWorker() daily via cron or scheduler
 *   - For testing: call processSubscriptionForTesting() with a specific subscription
 */

import { subscriptionBillingRepository } from "../storage/subscriptionBilling";
import { notificationRepository } from "../storage/notifications";
import type { NotificationType } from "@shared/schema";

// ============================================================================
// Types
// ============================================================================

interface WorkerResult {
  processed: number;
  notices30Sent: number;
  notices7Sent: number;
  renewed: number;
  revertedToMonthly: number;
  skippedCancelled: number;
  skippedDuplicate: number;
  errors: Array<{ subscriptionId: string; error: string }>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Send renewal notification to company owners
 */
async function sendRenewalNotification(
  companyId: string,
  type: NotificationType,
  daysUntil: number,
  willAutoRenew: boolean,
  endDate: Date
): Promise<void> {
  const formattedDate = endDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const title = `Subscription Renewal in ${daysUntil} Days`;
  const body = willAutoRenew
    ? `Your annual subscription will automatically renew on ${formattedDate}.`
    : `Your annual subscription ends on ${formattedDate}. Without renewal, it will convert to monthly billing.`;

  const linkUrl = "/settings/subscription";
  const dedupeKey = `sub_renewal_${type}_${endDate.toISOString().split("T")[0]}`;

  // Get owners to notify
  const owners = await notificationRepository.getUsersByRole(companyId, ["owner", "admin"]);

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
        relatedEntityType: "subscription",
      }
    );
  }
}

/**
 * Send subscription renewed notification
 */
async function sendRenewedNotification(
  companyId: string,
  newEndDate: Date
): Promise<void> {
  const formattedDate = newEndDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const title = "Subscription Renewed";
  const body = `Your annual subscription has been renewed until ${formattedDate}.`;
  const linkUrl = "/settings/subscription";
  const dedupeKey = `sub_renewed_${newEndDate.toISOString().split("T")[0]}`;

  const owners = await notificationRepository.getUsersByRole(companyId, ["owner", "admin"]);

  if (owners.length > 0) {
    await notificationRepository.createNotificationsForUsers(
      companyId,
      owners.map((u) => u.id),
      {
        type: "subscription_renewed",
        title,
        body,
        linkUrl,
        dedupeKey,
        relatedEntityType: "subscription",
      }
    );
  }
}

/**
 * Send subscription reverted to monthly notification
 */
async function sendRevertedNotification(companyId: string): Promise<void> {
  const title = "Subscription Changed to Monthly";
  const body = "Your annual subscription has ended and has been converted to monthly billing.";
  const linkUrl = "/settings/subscription";
  const dedupeKey = `sub_reverted_${new Date().toISOString().split("T")[0]}`;

  const owners = await notificationRepository.getUsersByRole(companyId, ["owner", "admin"]);

  if (owners.length > 0) {
    await notificationRepository.createNotificationsForUsers(
      companyId,
      owners.map((u) => u.id),
      {
        type: "subscription_reverted",
        title,
        body,
        linkUrl,
        dedupeKey,
        relatedEntityType: "subscription",
      }
    );
  }
}

// ============================================================================
// Worker Logic
// ============================================================================

/**
 * Process 30-day renewal notices
 */
async function processRenewalNotices30(result: WorkerResult): Promise<void> {
  const subscriptions = await subscriptionBillingRepository.getSubscriptionsForRenewalNotice(30, 1);

  console.log(`[SubscriptionWorker] Found ${subscriptions.length} subscriptions for 30-day notice`);

  for (const sub of subscriptions) {
    try {
      // Try to record the event (idempotency guard)
      const { created } = await subscriptionBillingRepository.recordEvent({
        subscriptionId: sub.id,
        companyId: sub.companyId,
        type: "renewal_notice_30",
        termEndDate: sub.endDate,
        metadata: { autoRenewAnnual: sub.autoRenewAnnual },
      });

      if (created) {
        // Send notification
        await sendRenewalNotification(
          sub.companyId,
          "subscription_renewal_30",
          30,
          sub.autoRenewAnnual,
          sub.endDate
        );
        result.notices30Sent++;
        console.log(`[SubscriptionWorker] Sent 30-day notice for subscription ${sub.id}`);
      } else {
        result.skippedDuplicate++;
        console.log(`[SubscriptionWorker] Skipped 30-day notice for ${sub.id} (already sent)`);
      }
      result.processed++;
    } catch (error: any) {
      console.error(`[SubscriptionWorker] Error processing 30-day notice for ${sub.id}:`, error);
      result.errors.push({ subscriptionId: sub.id, error: error.message });
    }
  }
}

/**
 * Process 7-day renewal notices
 */
async function processRenewalNotices7(result: WorkerResult): Promise<void> {
  const subscriptions = await subscriptionBillingRepository.getSubscriptionsForRenewalNotice(7, 1);

  console.log(`[SubscriptionWorker] Found ${subscriptions.length} subscriptions for 7-day notice`);

  for (const sub of subscriptions) {
    try {
      const { created } = await subscriptionBillingRepository.recordEvent({
        subscriptionId: sub.id,
        companyId: sub.companyId,
        type: "renewal_notice_7",
        termEndDate: sub.endDate,
        metadata: { autoRenewAnnual: sub.autoRenewAnnual },
      });

      if (created) {
        await sendRenewalNotification(
          sub.companyId,
          "subscription_renewal_7",
          7,
          sub.autoRenewAnnual,
          sub.endDate
        );
        result.notices7Sent++;
        console.log(`[SubscriptionWorker] Sent 7-day notice for subscription ${sub.id}`);
      } else {
        result.skippedDuplicate++;
        console.log(`[SubscriptionWorker] Skipped 7-day notice for ${sub.id} (already sent)`);
      }
      result.processed++;
    } catch (error: any) {
      console.error(`[SubscriptionWorker] Error processing 7-day notice for ${sub.id}:`, error);
      result.errors.push({ subscriptionId: sub.id, error: error.message });
    }
  }
}

/**
 * Process end-of-term subscriptions (endDate <= today)
 */
async function processEndOfTerm(result: WorkerResult): Promise<void> {
  const subscriptions = await subscriptionBillingRepository.getAnnualSubscriptionsDueForProcessing();

  console.log(`[SubscriptionWorker] Found ${subscriptions.length} subscriptions at end of term`);

  for (const sub of subscriptions) {
    try {
      // Skip if already cancelled
      if (sub.status === "cancelled") {
        result.skippedCancelled++;
        console.log(`[SubscriptionWorker] Skipped cancelled subscription ${sub.id}`);
        result.processed++;
        continue;
      }

      const oldEndDate = sub.endDate;

      if (sub.autoRenewAnnual) {
        // Auto-renew: extend by 1 year
        const { created } = await subscriptionBillingRepository.recordEvent({
          subscriptionId: sub.id,
          companyId: sub.companyId,
          type: "annual_renewed",
          termEndDate: oldEndDate,
          metadata: { previousEndDate: oldEndDate.toISOString() },
        });

        if (created) {
          const updated = await subscriptionBillingRepository.autoRenewAnnual(sub.id, oldEndDate);

          // Send renewed notification
          if (updated.endDate) {
            await sendRenewedNotification(sub.companyId, updated.endDate);
          }

          result.renewed++;
          console.log(`[SubscriptionWorker] Auto-renewed subscription ${sub.id}`);
        } else {
          result.skippedDuplicate++;
          console.log(`[SubscriptionWorker] Skipped renewal for ${sub.id} (already processed)`);
        }
      } else {
        // Revert to monthly
        const { created } = await subscriptionBillingRepository.recordEvent({
          subscriptionId: sub.id,
          companyId: sub.companyId,
          type: "reverted_to_monthly",
          termEndDate: oldEndDate,
          metadata: { previousEndDate: oldEndDate.toISOString() },
        });

        if (created) {
          await subscriptionBillingRepository.revertToMonthly(sub.id);

          // Send reverted notification
          await sendRevertedNotification(sub.companyId);

          result.revertedToMonthly++;
          console.log(`[SubscriptionWorker] Reverted subscription ${sub.id} to monthly`);
        } else {
          result.skippedDuplicate++;
          console.log(`[SubscriptionWorker] Skipped revert for ${sub.id} (already processed)`);
        }
      }
      result.processed++;
    } catch (error: any) {
      console.error(`[SubscriptionWorker] Error processing end-of-term for ${sub.id}:`, error);
      result.errors.push({ subscriptionId: sub.id, error: error.message });
    }
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Run the complete subscription worker
 * Call this daily via cron job
 */
export async function runSubscriptionWorker(): Promise<WorkerResult> {
  console.log("[SubscriptionWorker] Starting daily subscription processing...");
  const startTime = Date.now();

  const result: WorkerResult = {
    processed: 0,
    notices30Sent: 0,
    notices7Sent: 0,
    renewed: 0,
    revertedToMonthly: 0,
    skippedCancelled: 0,
    skippedDuplicate: 0,
    errors: [],
  };

  try {
    // Process in order: notices first, then end-of-term
    await processRenewalNotices30(result);
    await processRenewalNotices7(result);
    await processEndOfTerm(result);
  } catch (error: any) {
    console.error("[SubscriptionWorker] Fatal error:", error);
    result.errors.push({ subscriptionId: "global", error: error.message });
  }

  const duration = Date.now() - startTime;
  console.log(
    `[SubscriptionWorker] Completed in ${duration}ms. ` +
      `Processed: ${result.processed}, 30-day notices: ${result.notices30Sent}, ` +
      `7-day notices: ${result.notices7Sent}, Renewed: ${result.renewed}, ` +
      `Reverted: ${result.revertedToMonthly}, Skipped: ${result.skippedDuplicate + result.skippedCancelled}, ` +
      `Errors: ${result.errors.length}`
  );

  return result;
}

/**
 * Process a specific subscription for testing
 * Useful for simulating what would happen at end-of-term
 */
export async function processSubscriptionForTesting(
  companyId: string,
  options: {
    simulateEndDate?: Date; // If provided, treats this as the endDate for testing
    dryRun?: boolean; // If true, doesn't actually update the subscription
  } = {}
): Promise<{
  action: "renewed" | "reverted_to_monthly" | "skipped_cancelled" | "skipped_not_due" | "none";
  details: string;
}> {
  const sub = await subscriptionBillingRepository.getByCompanyId(companyId);

  if (!sub) {
    return { action: "none", details: "No subscription found" };
  }

  if (sub.billingCycle !== "annual") {
    return { action: "none", details: "Not an annual subscription" };
  }

  if (sub.status === "cancelled") {
    return { action: "skipped_cancelled", details: "Subscription is cancelled" };
  }

  const checkDate = options.simulateEndDate || sub.endDate;
  if (!checkDate) {
    return { action: "none", details: "No end date set" };
  }

  const now = new Date();
  if (new Date(checkDate) > now && !options.simulateEndDate) {
    return {
      action: "skipped_not_due",
      details: `End date ${checkDate} is in the future`,
    };
  }

  if (options.dryRun) {
    if (sub.autoRenewAnnual) {
      const newEndDate = new Date(checkDate);
      newEndDate.setFullYear(newEndDate.getFullYear() + 1);
      return {
        action: "renewed",
        details: `[DRY RUN] Would renew until ${newEndDate.toISOString()}`,
      };
    } else {
      return {
        action: "reverted_to_monthly",
        details: "[DRY RUN] Would revert to monthly",
      };
    }
  }

  // Actually process
  if (sub.autoRenewAnnual) {
    const updated = await subscriptionBillingRepository.autoRenewAnnual(
      sub.id,
      new Date(checkDate)
    );
    await subscriptionBillingRepository.recordEvent({
      subscriptionId: sub.id,
      companyId,
      type: "annual_renewed",
      termEndDate: new Date(checkDate),
      metadata: { source: "test", previousEndDate: checkDate },
    });
    return {
      action: "renewed",
      details: `Renewed until ${updated.endDate?.toISOString()}`,
    };
  } else {
    await subscriptionBillingRepository.revertToMonthly(sub.id);
    await subscriptionBillingRepository.recordEvent({
      subscriptionId: sub.id,
      companyId,
      type: "reverted_to_monthly",
      termEndDate: new Date(checkDate),
      metadata: { source: "test", previousEndDate: checkDate },
    });
    return {
      action: "reverted_to_monthly",
      details: "Reverted to monthly billing",
    };
  }
}

/**
 * Test helper: Fast-forward a subscription's end date to simulate expiry
 * WARNING: Only use in development/testing environments
 */
export async function fastForwardEndDate(
  companyId: string,
  daysInPast: number = 1
): Promise<{ success: boolean; newEndDate?: Date; error?: string }> {
  const sub = await subscriptionBillingRepository.getByCompanyId(companyId);

  if (!sub) {
    return { success: false, error: "No subscription found" };
  }

  if (sub.billingCycle !== "annual") {
    return { success: false, error: "Not an annual subscription" };
  }

  const newEndDate = new Date();
  newEndDate.setDate(newEndDate.getDate() - daysInPast);

  // Direct update via raw SQL (only for testing)
  const { db } = await import("../db");
  const { eq } = await import("drizzle-orm");
  const { tenantSubscriptions } = await import("@shared/schema");

  await db
    .update(tenantSubscriptions)
    .set({ endDate: newEndDate, updatedAt: new Date() })
    .where(eq(tenantSubscriptions.id, sub.id));

  return { success: true, newEndDate };
}
