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
import { pushDeliveryService } from "./pushDeliveryService";
import type { PushPayload } from "./push/types";
// 2026-04-21 Phase 2: user-level notification preference enforcement.
import { notificationPreferencesRepository } from "../storage/notificationPreferences";

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

interface QboFailureParams {
  companyId: string;
  entityType: string;
  entityId: string;
  errorMessage: string;
}

/**
 * 2026-04-21 Phase 1 push notifications: visit crew change.
 *
 * Caller (the canonical crew-assign route handler) supplies the before/after
 * crew sets plus enough visit metadata to compose the notification body.
 * This service owns the delta computation, actor skip, dedupe keying, the
 * persistent in-app notification row, and the best-effort push fan-out.
 */
interface VisitAssignmentChangeParams {
  companyId: string;
  visitId: string;
  jobId: string;
  jobNumber: number;
  /**
   * 2026-04-21 Phase 1.1: post-write visit version. Canonical monotonic
   * identifier for this mutation — the orchestrator's optimistic-lock
   * counter increments on every successful assign-crew write. Used as the
   * terminal segment of the dedupe key so legitimate same-day
   * reassignments each produce their own notification, while a
   * retried/double-clicked same request (same version) is idempotent.
   */
  visitVersion: number;
  /** ISO string of visit.scheduledStart if present — used for a friendly body. */
  scheduledStart: string | null;
  /** Crew on the visit BEFORE the write. */
  previousAssignedTechnicianIds: string[];
  /** Crew on the visit AFTER the write. */
  currentAssignedTechnicianIds: string[];
  /** User who performed the write — excluded from notification recipients. */
  actorUserId: string | null;
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
 * 2026-04-21 Phase 1 — visit crew change → notify newly-assigned techs.
 *
 * Rules enforced here (exactly as spec'd in the audit):
 *   1. Only NEWLY assigned users get notified (current − previous).
 *   2. The actor is never notified about their own assignment write.
 *   3. Empty delta → no-op. Saving a visit with an unchanged crew, or
 *      re-saving unrelated fields, produces zero notifications.
 *   4. Dedupe key `visit.assigned:<visitId>:<userId>:<YYYY-MM-DD>` — the
 *      notifications table's unique(user_id, dedupe_key) index means a
 *      second assignment the same day is silently idempotent. A NEW day
 *      gets a new notification.
 *
 * Persistence + push are independent concerns:
 *   - The `notifications` row is the durable record. It is created FIRST,
 *     inside the request path. Failing to create it is loud (the caller
 *     will log but push will still be attempted for the delta).
 *   - Push is best-effort via pushDeliveryService. Any push failure is
 *     swallowed here — the assignment write has already succeeded and
 *     the in-app notification row is durable.
 */
export async function emitVisitAssignmentChange(
  params: VisitAssignmentChangeParams,
): Promise<void> {
  const {
    companyId,
    visitId,
    jobId,
    jobNumber,
    visitVersion,
    scheduledStart,
    previousAssignedTechnicianIds,
    currentAssignedTechnicianIds,
    actorUserId,
  } = params;

  // Delta = newly-assigned. Set semantics — order doesn't matter.
  const previous = new Set(previousAssignedTechnicianIds);
  const newlyAssigned = currentAssignedTechnicianIds.filter((id) => !previous.has(id));

  // Never notify the user about their own write (covers the edge case
  // of a schedulable owner/manager assigning themselves).
  const recipients = newlyAssigned.filter((id) => id && id !== actorUserId);

  if (recipients.length === 0) return;

  // 2026-04-21 Phase 2: per-user notification preferences — single source
  // of truth for eligibility. Batch-fetch once per emit; missing rows are
  // treated as "all categories enabled" (preserves Phase 1 behavior for
  // every existing user with zero backfill). If every recipient has opted
  // out we early-return; no notification row, no push, no CPU wasted.
  //
  // Design rule for v1 (per approved audit): a single toggle governs both
  // the durable `notifications` row AND the push delivery. No split between
  // in-app and push at this layer — adapters never decide eligibility.
  const prefs = await notificationPreferencesRepository.loadForUsers(companyId, recipients);
  const eligible = recipients.filter((userId) => {
    const p = prefs.get(userId);
    return p ? p.visitAssignmentsEnabled : true; // row-absent = permissive
  });

  if (eligible.length === 0) return;

  // Notification body content. Kept intentionally minimal — we have
  // jobNumber + scheduledStart without an extra DB hit. Client name
  // could be added later if the orchestrator starts projecting it.
  const type: NotificationType = "visit_assigned";
  const title = "New visit assigned";
  const body = scheduledStart
    ? `Job #${jobNumber} — ${formatVisitWhen(scheduledStart)}`
    : `Job #${jobNumber} has been assigned to you.`;
  const linkUrl = `/tech/visit/${visitId}`;

  // 2026-04-21 Phase 1.1: dedupe key is anchored on the post-write visit
  // version — the optimistic-lock counter the orchestrator bumps on every
  // successful assign-crew mutation. Properties this gives us:
  //
  //   - DIFFERENT meaningful mutations (reassign A→B→A same day) each
  //     produce a unique key → each user gets a separate notification.
  //   - SAME mutation retried by the client (double-click, network retry)
  //     has the same version — the orchestrator's version guard already
  //     rejects the duplicate write with 409, so this function is not
  //     called a second time. If it ever were (e.g. an at-least-once
  //     emit layer we don't have today), the (user_id, dedupe_key) unique
  //     index would ON CONFLICT DO NOTHING the duplicate row.
  //   - The `userId` segment makes the key self-scoping per recipient;
  //     the DB unique index is `(user_id, dedupe_key)`, so embedding
  //     userId here is redundant but harmless — keeps the key readable
  //     in audit queries and matches the agreed canonical shape.
  //
  // Format: visit.assigned:<visitId>:<userId>:<visitVersion>
  const dedupeKeyFor = (userId: string) =>
    `visit.assigned:${visitId}:${userId}:${visitVersion}`;

  const pushPayload: PushPayload = {
    title,
    body,
    type,
    data: {
      linkUrl,
      entityType: "visit",
      entityId: visitId,
      jobId,
    },
    // Collapse tag: if two assignments to the same visit land within the
    // OS's cache window, the second replaces the first in the tray rather
    // than stacking. Matches the "visit is the unit of work" model.
    tag: `visit-assigned-${visitId}`,
  };

  // Fan out to each eligible recipient. Create the durable record first,
  // then push. We await all in parallel so a slow push provider doesn't
  // serialize the work, but individual failures are isolated.
  await Promise.all(
    eligible.map(async (userId) => {
      try {
        await notificationRepository.createNotification({
          companyId,
          userId,
          type,
          title,
          body,
          linkUrl,
          dedupeKey: dedupeKeyFor(userId),
          relatedEntityType: "visit",
          relatedEntityId: visitId,
        });
      } catch (err) {
        // Log loudly — the durable record is the user-visible contract.
        // Do NOT throw; push may still succeed and is additive.
        console.error("[emitVisitAssignmentChange] createNotification failed", {
          companyId,
          userId,
          visitId,
          err,
        });
      }

      try {
        await pushDeliveryService.dispatchToUser(companyId, userId, pushPayload);
      } catch (err) {
        // Best-effort. Push failures never propagate.
        console.error("[emitVisitAssignmentChange] push dispatch failed", {
          companyId,
          userId,
          visitId,
          err,
        });
      }
    }),
  );
}

/** Small helper so the notification body shows a readable time. */
function formatVisitWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "scheduled";
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// 2026-04-21 Phase 2 — Visit schedule change notifications
// ---------------------------------------------------------------------------

/**
 * Params for emitVisitScheduleChange. Route handler supplies pre/post
 * datetime state plus the POST-write crew (who the assigned techs are
 * right now). This service owns the delta check, preference gate,
 * recipient filtering, persistent notification row, and best-effort push.
 */
interface VisitScheduleChangeParams {
  companyId: string;
  visitId: string;
  jobId: string;
  jobNumber: number;
  /** Post-write visit version — monotonic, anchors the dedupe key. */
  visitVersion: number;
  /** Visit datetime state BEFORE the write. */
  previousScheduledStart: string | null;
  previousScheduledEnd: string | null;
  previousIsAllDay: boolean;
  /** Visit datetime state AFTER the write. */
  currentScheduledStart: string | null;
  currentScheduledEnd: string | null;
  currentIsAllDay: boolean;
  /** Post-write crew on the visit (set notified). */
  currentAssignedTechnicianIds: string[];
  /** User who performed the write — excluded from recipients. */
  actorUserId: string | null;
}

/** Normalize an ISO/null timestamp to a millisecond epoch (or null). */
function toMsOrNull(value: string | null): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return isNaN(ms) ? null : ms;
}

/**
 * Relative-day label for the notification body: "Today 2:00 PM" /
 * "Tomorrow 4:00 PM" / "Fri, Apr 25 9:00 AM" / "Today" (all-day).
 * Falls back to "Unscheduled" when no datetime is present.
 */
function formatScheduleLabel(iso: string | null, isAllDay: boolean): string {
  if (!iso) return "Unscheduled";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "Unscheduled";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  const dayLabel =
    diffDays === 0 ? "Today"
    : diffDays === 1 ? "Tomorrow"
    : diffDays === -1 ? "Yesterday"
    : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  if (isAllDay) return dayLabel;

  const timeLabel = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${dayLabel} ${timeLabel}`;
}

/**
 * 2026-04-21 Phase 2 — Visit reschedule → notify currently-assigned techs.
 *
 * Rules (mirror emitVisitAssignmentChange architecture):
 *   1. Meaningful-datetime delta only — no-op when scheduledStart/End/
 *      isAllDay are all unchanged (filters out notes-only and crew-only
 *      saves without involving the route in delta logic).
 *   2. Actor is always excluded (schedulable user rescheduling their own
 *      visit doesn't get pushed).
 *   3. Per-user preference check against visitScheduleChangesEnabled —
 *      single source of truth. Row-absent = permissive.
 *   4. Dedupe key `visit.schedule_changed:<visitId>:<userId>:<visitVersion>`.
 *      visitVersion is the orchestrator's monotonic lock counter, so every
 *      meaningful reschedule write gets a distinct notification but retries/
 *      double-clicks are idempotent at the DB level.
 *   5. Persistent notification row FIRST (durable), push second (best-effort).
 *      Push failure never propagates.
 */
export async function emitVisitScheduleChange(
  params: VisitScheduleChangeParams,
): Promise<void> {
  const {
    companyId,
    visitId,
    jobId,
    jobNumber,
    visitVersion,
    previousScheduledStart,
    previousScheduledEnd,
    previousIsAllDay,
    currentScheduledStart,
    currentScheduledEnd,
    currentIsAllDay,
    currentAssignedTechnicianIds,
    actorUserId,
  } = params;

  // 1) Meaningful delta. Compare as millisecond epochs so timezone/ISO
  // formatting drift doesn't produce false positives.
  const startChanged = toMsOrNull(previousScheduledStart) !== toMsOrNull(currentScheduledStart);
  const endChanged = toMsOrNull(previousScheduledEnd) !== toMsOrNull(currentScheduledEnd);
  const allDayChanged = previousIsAllDay !== currentIsAllDay;
  if (!startChanged && !endChanged && !allDayChanged) return;

  // 2) Recipients = post-write crew minus the actor.
  const recipients = currentAssignedTechnicianIds.filter((id) => id && id !== actorUserId);
  if (recipients.length === 0) return;

  // 3) Preference gate — visitScheduleChangesEnabled (row-absent = permissive).
  const prefs = await notificationPreferencesRepository.loadForUsers(companyId, recipients);
  const eligible = recipients.filter((userId) => {
    const p = prefs.get(userId);
    return p ? p.visitScheduleChangesEnabled : true;
  });
  if (eligible.length === 0) return;

  // 4) Notification content: "Visit rescheduled" + "Job #123 · Today 2:00 PM → Tomorrow 4:00 PM"
  const type: NotificationType = "visit_schedule_changed";
  const title = "Visit rescheduled";
  const fromLabel = formatScheduleLabel(previousScheduledStart, previousIsAllDay);
  const toLabel = formatScheduleLabel(currentScheduledStart, currentIsAllDay);
  const body = `Job #${jobNumber} · ${fromLabel} → ${toLabel}`;
  const linkUrl = `/tech/visit/${visitId}`;

  const dedupeKeyFor = (userId: string) =>
    `visit.schedule_changed:${visitId}:${userId}:${visitVersion}`;

  const pushPayload: PushPayload = {
    title,
    body,
    type,
    data: {
      linkUrl,
      entityType: "visit",
      entityId: visitId,
      jobId,
    },
    // Collapse tag per visit — successive reschedules replace the prior
    // notification in the tray instead of stacking.
    tag: `visit-schedule-${visitId}`,
  };

  await Promise.all(
    eligible.map(async (userId) => {
      try {
        await notificationRepository.createNotification({
          companyId,
          userId,
          type,
          title,
          body,
          linkUrl,
          dedupeKey: dedupeKeyFor(userId),
          relatedEntityType: "visit",
          relatedEntityId: visitId,
        });
      } catch (err) {
        console.error("[emitVisitScheduleChange] createNotification failed", {
          companyId,
          userId,
          visitId,
          err,
        });
      }

      try {
        await pushDeliveryService.dispatchToUser(companyId, userId, pushPayload);
      } catch (err) {
        console.error("[emitVisitScheduleChange] push dispatch failed", {
          companyId,
          userId,
          visitId,
          err,
        });
      }
    }),
  );
}

// ============================================================================
// Export Service Object
// ============================================================================

export const notificationService = {
  emitQuoteStatusChange,
  emitJobScheduled,
  emitQboFailureNotification,
  emitVisitAssignmentChange,
  emitVisitScheduleChange,
};
