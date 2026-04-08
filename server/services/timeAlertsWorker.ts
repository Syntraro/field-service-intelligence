/**
 * Time Alerts Worker (Phase 7)
 *
 * Daily/on-demand job that detects time-tracking exceptions and creates notifications:
 * 1. Unassigned time entries (jobId IS NULL) over configurable threshold
 * 2. Untracked time (worked - tracked) over configurable threshold
 * 3. Long running entries (endAt IS NULL) over configurable threshold
 * 4. Missing clock-out (open work session) over configurable threshold
 *
 * Phase 7 additions:
 * - Configurable thresholds per company (DB-backed)
 * - Snooze support (users can mute notification types)
 * - Escalation logic (repeat issues trigger critical alerts)
 * - Weekly digest notifications
 *
 * IDEMPOTENCY: Uses dedupeKey unique constraint on notifications table.
 * Reruns will not create duplicate notifications.
 */

import type { NotificationType } from "@shared/schema";
import { notificationRepository } from "../storage/notifications";
import { timeAlertSettingsRepository, type TimeAlertSettingsWithDefaults } from "../storage/timeAlertSettings";
import { notificationSnoozesRepository } from "../storage/notificationSnoozes";
import { timeAlertQueryRepository } from "../storage/timeAlertQueries";
import { RESTRICTED_MANAGER_ROLES } from "../auth/roles";

// ============================================================================
// Types
// ============================================================================

export interface TimeAlertsWorkerResult {
  processed: {
    unassignedTimeChecks: number;
    untrackedTimeChecks: number;
    longRunningChecks: number;
    missingClockOutChecks: number;
  };
  notifications: {
    unassignedTime: number;
    untrackedTime: number;
    longRunningEntry: number;
    missingClockOut: number;
    weeklyDigest: number;
  };
  escalations: number;
  skippedDuplicate: number;
  skippedSnoozed: number;
  errors: Array<{ type: string; companyId?: string; technicianId?: string; error: string }>;
}

export interface WeeklyDigestResult {
  sent: number;
  skipped: number;
  errors: Array<{ companyId: string; error: string }>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get yesterday's date string (YYYY-MM-DD) for daily checks
 */
function getYesterday(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().split("T")[0];
}

/**
 * Get the Monday of the current week
 */
function getCurrentWeekMonday(): string {
  const date = new Date();
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  return date.toISOString().split("T")[0];
}

/**
 * Get the Monday of last week
 */
function getLastWeekMonday(): string {
  const date = new Date();
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1) - 7;
  date.setDate(diff);
  return date.toISOString().split("T")[0];
}

/**
 * Format minutes as human-readable duration
 */
function formatMinutes(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Get managers for a company (users with manager roles)
 */
async function getCompanyManagers(companyId: string): Promise<string[]> {
  const managers = await notificationRepository.getUsersByRole(
    companyId,
    [...RESTRICTED_MANAGER_ROLES]
  );
  return managers.map((m) => m.id);
}

/**
 * Check if an issue has been escalated (repeated N days)
 * Returns the number of consecutive days this issue has occurred
 */
async function checkEscalation(
  companyId: string,
  type: NotificationType,
  technicianId: string,
  daysToCheck: number
): Promise<number> {
  return timeAlertQueryRepository.countRecentAlerts(companyId, type, technicianId, daysToCheck);
}

/**
 * Create notifications for users, respecting snoozes
 */
async function createNotificationsWithSnoozeCheck(
  companyId: string,
  userIds: string[],
  type: NotificationType,
  payload: {
    title: string;
    body: string;
    linkUrl: string;
    dedupeKey: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
  },
  result: TimeAlertsWorkerResult
): Promise<number> {
  // Filter out snoozed users
  const nonSnoozedUsers = await notificationSnoozesRepository.filterSnoozedUsers(
    companyId,
    userIds,
    type
  );

  const snoozedCount = userIds.length - nonSnoozedUsers.length;
  result.skippedSnoozed += snoozedCount;

  if (nonSnoozedUsers.length === 0) {
    return 0;
  }

  const created = await notificationRepository.createNotificationsForUsers(
    companyId,
    nonSnoozedUsers,
    {
      type,
      title: payload.title,
      body: payload.body,
      linkUrl: payload.linkUrl,
      dedupeKey: payload.dedupeKey,
      relatedEntityType: payload.relatedEntityType,
      relatedEntityId: payload.relatedEntityId,
    }
  );

  return created;
}

// ============================================================================
// Alert Detection Functions
// ============================================================================

/**
 * Check for unassigned time entries per technician for a given date
 * Creates notifications when total unassigned time >= threshold
 */
async function checkUnassignedTime(
  companyId: string,
  dateStr: string,
  settings: TimeAlertSettingsWithDefaults,
  result: TimeAlertsWorkerResult
): Promise<void> {
  // Aggregate unassigned time by technician for the date
  const unassignedByTech = await timeAlertQueryRepository.getUnassignedTimeByTechnician(companyId, dateStr);

  result.processed.unassignedTimeChecks += unassignedByTech.length;

  for (const tech of unassignedByTech) {
    if (tech.totalMinutes >= settings.unassignedThresholdMinutes) {
      const dedupeKey = `unassigned_time:${tech.technicianId}:${dateStr}`;

      // Get managers to notify
      const managerIds = await getCompanyManagers(companyId);
      if (managerIds.length === 0) continue;

      // Check for escalation
      const repeatCount = await checkEscalation(
        companyId,
        "unassigned_time",
        tech.technicianId,
        settings.repeatDaysToEscalate
      );
      const isEscalated = repeatCount >= settings.repeatDaysToEscalate;

      if (isEscalated) {
        result.escalations++;
      }

      const title = isEscalated
        ? `ESCALATED: Unassigned Time - ${tech.technicianName || "Technician"}`
        : `Unassigned Time: ${tech.technicianName || "Technician"}`;

      const body = isEscalated
        ? `${formatMinutes(tech.totalMinutes)} of unassigned time on ${dateStr}. This issue has occurred ${repeatCount + 1} days in a row.`
        : `${formatMinutes(tech.totalMinutes)} of unassigned time on ${dateStr}. Please review and assign to jobs.`;

      const created = await createNotificationsWithSnoozeCheck(
        companyId,
        managerIds,
        "unassigned_time",
        {
          title,
          body,
          linkUrl: `/settings/unassigned-time?date=${dateStr}&technicianId=${tech.technicianId}`,
          dedupeKey,
          relatedEntityType: "time_entry",
        },
        result
      );

      if (created > 0) {
        result.notifications.unassignedTime++;
        console.log(
          `[TimeAlertsWorker] Created unassigned_time notification for tech ${tech.technicianId} on ${dateStr} (${formatMinutes(tech.totalMinutes)})${isEscalated ? " [ESCALATED]" : ""}`
        );
      } else {
        result.skippedDuplicate++;
      }
    }
  }
}

/**
 * Check for untracked time (worked - tracked) per technician for a given date
 */
async function checkUntrackedTime(
  companyId: string,
  dateStr: string,
  settings: TimeAlertSettingsWithDefaults,
  result: TimeAlertsWorkerResult
): Promise<void> {
  // Get worked minutes from work sessions (closed only)
  const workedByTech = await timeAlertQueryRepository.getClosedSessionsByDate(companyId, dateStr);

  // Get tracked minutes from time entries
  const trackedByTech = await timeAlertQueryRepository.getTrackedTimeByTechnician(companyId, dateStr);

  const trackedMap = new Map<string, number>();
  for (const t of trackedByTech) {
    trackedMap.set(t.technicianId, t.totalMinutes);
  }

  const workedMap = new Map<string, { workedMinutes: number; technicianName: string | null }>();
  for (const ws of workedByTech) {
    if (!ws.clockOutAt) continue;

    const clockIn = new Date(ws.clockInAt).getTime();
    const clockOut = new Date(ws.clockOutAt).getTime();
    const totalMs = clockOut - clockIn;
    const workedMinutes = Math.floor(totalMs / 60000) - (ws.breakMinutes ?? 0);

    const existing = workedMap.get(ws.technicianId) ?? { workedMinutes: 0, technicianName: ws.technicianName };
    existing.workedMinutes += Math.max(0, workedMinutes);
    workedMap.set(ws.technicianId, existing);
  }

  result.processed.untrackedTimeChecks += workedMap.size;

  for (const [techId, data] of Array.from(workedMap.entries())) {
    const trackedMinutes = trackedMap.get(techId) ?? 0;
    const untrackedMinutes = data.workedMinutes - trackedMinutes;

    if (untrackedMinutes >= settings.untrackedThresholdMinutes) {
      const dedupeKey = `untracked_time:${techId}:${dateStr}`;

      const managerIds = await getCompanyManagers(companyId);
      if (managerIds.length === 0) continue;

      // Check for escalation
      const repeatCount = await checkEscalation(
        companyId,
        "untracked_time",
        techId,
        settings.repeatDaysToEscalate
      );
      const isEscalated = repeatCount >= settings.repeatDaysToEscalate;

      if (isEscalated) {
        result.escalations++;
      }

      const title = isEscalated
        ? `ESCALATED: Untracked Time - ${data.technicianName || "Technician"}`
        : `Untracked Time: ${data.technicianName || "Technician"}`;

      const body = isEscalated
        ? `${formatMinutes(untrackedMinutes)} untracked on ${dateStr}. Issue repeated ${repeatCount + 1} days.`
        : `${formatMinutes(untrackedMinutes)} of untracked time on ${dateStr} (worked ${formatMinutes(data.workedMinutes)}, tracked ${formatMinutes(trackedMinutes)}).`;

      const created = await createNotificationsWithSnoozeCheck(
        companyId,
        managerIds,
        "untracked_time",
        {
          title,
          body,
          linkUrl: `/settings/payroll?weekStart=${dateStr}`,
          dedupeKey,
          relatedEntityType: "work_session",
        },
        result
      );

      if (created > 0) {
        result.notifications.untrackedTime++;
        console.log(
          `[TimeAlertsWorker] Created untracked_time notification for tech ${techId} on ${dateStr} (${formatMinutes(untrackedMinutes)})${isEscalated ? " [ESCALATED]" : ""}`
        );
      } else {
        result.skippedDuplicate++;
      }
    }
  }
}

/**
 * Check for long-running time entries
 */
async function checkLongRunningEntries(
  companyId: string,
  settings: TimeAlertSettingsWithDefaults,
  result: TimeAlertsWorkerResult
): Promise<void> {
  const cutoff = new Date();
  cutoff.setMinutes(cutoff.getMinutes() - settings.longRunningThresholdMinutes);

  const longRunning = await timeAlertQueryRepository.getLongRunningEntries(companyId, cutoff);

  result.processed.longRunningChecks += longRunning.length;

  for (const entry of longRunning) {
    const dedupeKey = `long_running_entry:${entry.id}`;
    const durationHours = Math.round((Date.now() - new Date(entry.startAt).getTime()) / 3600000);

    const managerIds = await getCompanyManagers(companyId);
    const allRecipients = Array.from(new Set([...managerIds, entry.technicianId]));
    if (allRecipients.length === 0) continue;

    const created = await createNotificationsWithSnoozeCheck(
      companyId,
      allRecipients,
      "long_running_entry",
      {
        title: `Long Running Time Entry`,
        body: `${entry.technicianName || "Technician"} has a "${entry.type}" entry running for ${durationHours}+ hours. Please check if it needs to be stopped.`,
        linkUrl: `/settings/payroll`,
        dedupeKey,
        relatedEntityType: "time_entry",
        relatedEntityId: entry.id,
      },
      result
    );

    if (created > 0) {
      result.notifications.longRunningEntry++;
      console.log(
        `[TimeAlertsWorker] Created long_running_entry notification for entry ${entry.id} (${durationHours}h)`
      );
    } else {
      result.skippedDuplicate++;
    }
  }
}

/**
 * Check for missing clock-out
 */
async function checkMissingClockOut(
  companyId: string,
  settings: TimeAlertSettingsWithDefaults,
  result: TimeAlertsWorkerResult
): Promise<void> {
  const cutoff = new Date();
  cutoff.setMinutes(cutoff.getMinutes() - settings.missingClockOutThresholdMinutes);

  const openSessions = await timeAlertQueryRepository.getOpenSessions(companyId, cutoff);

  result.processed.missingClockOutChecks += openSessions.length;

  for (const session of openSessions) {
    const dedupeKey = `missing_clock_out:${session.id}`;
    const durationHours = Math.round((Date.now() - new Date(session.clockInAt).getTime()) / 3600000);

    const managerIds = await getCompanyManagers(companyId);
    const allRecipients = Array.from(new Set([...managerIds, session.technicianId]));
    if (allRecipients.length === 0) continue;

    const created = await createNotificationsWithSnoozeCheck(
      companyId,
      allRecipients,
      "missing_clock_out",
      {
        title: `Missing Clock-Out`,
        body: `${session.technicianName || "Technician"} has been clocked in for ${durationHours}+ hours since ${session.workDate}. Please verify and clock out.`,
        linkUrl: `/settings/payroll`,
        dedupeKey,
        relatedEntityType: "work_session",
        relatedEntityId: session.id,
      },
      result
    );

    if (created > 0) {
      result.notifications.missingClockOut++;
      console.log(
        `[TimeAlertsWorker] Created missing_clock_out notification for session ${session.id} (${durationHours}h)`
      );
    } else {
      result.skippedDuplicate++;
    }
  }
}

// ============================================================================
// Weekly Digest
// ============================================================================

/**
 * Generate weekly digest metrics for a company
 */
async function getWeeklyDigestMetrics(
  companyId: string,
  weekStart: string
): Promise<{
  totalUnassignedMinutes: number;
  totalUntrackedMinutes: number;
  totalWorkedMinutes: number;
  totalBillableMinutes: number;
  billablePct: number;
  previousBillablePct: number;
  topLeakageTechs: Array<{ name: string; untrackedMinutes: number }>;
}> {
  const weekStartDate = new Date(weekStart + "T00:00:00Z");
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setDate(weekEndDate.getDate() + 7);

  const prevWeekStart = new Date(weekStartDate);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const prevWeekEnd = weekStartDate;

  // Current week work sessions
  const currentWeekSessions = await timeAlertQueryRepository.getWeekSessions(
    companyId, weekStart, weekEndDate.toISOString().split("T")[0]
  );

  // Current week time entries
  const currentWeekEntries = await timeAlertQueryRepository.getWeekTimeEntries(
    companyId, weekStartDate, weekEndDate
  );

  // Previous week time entries for billable comparison
  const prevWeekEntries = await timeAlertQueryRepository.getTimeEntriesForRange(
    companyId, prevWeekStart, prevWeekEnd
  );

  // Calculate worked minutes by technician
  const workedByTech = new Map<string, { name: string; minutes: number }>();
  for (const ws of currentWeekSessions) {
    if (!ws.clockOutAt) continue;
    const clockIn = new Date(ws.clockInAt).getTime();
    const clockOut = new Date(ws.clockOutAt).getTime();
    const minutes = Math.floor((clockOut - clockIn) / 60000) - (ws.breakMinutes ?? 0);

    const existing = workedByTech.get(ws.technicianId) ?? { name: ws.technicianName ?? "Unknown", minutes: 0 };
    existing.minutes += Math.max(0, minutes);
    workedByTech.set(ws.technicianId, existing);
  }

  // Calculate tracked/billable/unassigned minutes by technician
  const trackedByTech = new Map<string, { name: string; minutes: number }>();
  let totalBillableMinutes = 0;
  let totalUnassignedMinutes = 0;
  let totalTrackedMinutes = 0;

  for (const entry of currentWeekEntries) {
    const duration = entry.durationMinutes ?? 0;
    totalTrackedMinutes += duration;

    if (entry.billable) {
      totalBillableMinutes += duration;
    }

    if (!entry.jobId) {
      totalUnassignedMinutes += duration;
    }

    const existing = trackedByTech.get(entry.technicianId) ?? { name: entry.technicianName ?? "Unknown", minutes: 0 };
    existing.minutes += duration;
    trackedByTech.set(entry.technicianId, existing);
  }

  // Calculate total worked minutes
  let totalWorkedMinutes = 0;
  for (const data of Array.from(workedByTech.values())) {
    totalWorkedMinutes += data.minutes;
  }

  // Calculate untracked by technician
  const untrackedByTech: Array<{ name: string; untrackedMinutes: number }> = [];
  for (const [techId, worked] of Array.from(workedByTech.entries())) {
    const tracked = trackedByTech.get(techId)?.minutes ?? 0;
    const untracked = worked.minutes - tracked;
    if (untracked > 0) {
      untrackedByTech.push({ name: worked.name, untrackedMinutes: untracked });
    }
  }

  // Sort by untracked minutes and take top 3
  untrackedByTech.sort((a, b) => b.untrackedMinutes - a.untrackedMinutes);
  const topLeakageTechs = untrackedByTech.slice(0, 3);

  // Calculate total untracked
  const totalUntrackedMinutes = totalWorkedMinutes - totalTrackedMinutes;

  // Calculate billable percentages
  const billablePct = totalTrackedMinutes > 0 ? Math.round((totalBillableMinutes / totalTrackedMinutes) * 100) : 0;

  // Previous week billable
  let prevTotalTracked = 0;
  let prevTotalBillable = 0;
  for (const entry of prevWeekEntries) {
    const duration = entry.durationMinutes ?? 0;
    prevTotalTracked += duration;
    if (entry.billable) {
      prevTotalBillable += duration;
    }
  }
  const previousBillablePct = prevTotalTracked > 0 ? Math.round((prevTotalBillable / prevTotalTracked) * 100) : 0;

  return {
    totalUnassignedMinutes,
    totalUntrackedMinutes: Math.max(0, totalUntrackedMinutes),
    totalWorkedMinutes,
    totalBillableMinutes,
    billablePct,
    previousBillablePct,
    topLeakageTechs,
  };
}

/**
 * Run weekly digest for a company
 */
export async function runWeeklyDigestForCompany(
  companyId: string,
  weekStart: string
): Promise<{ sent: number; skippedDuplicate: number; skippedSnoozed: number }> {
  const settings = await timeAlertSettingsRepository.getSettings(companyId);

  if (!settings.digestEnabled) {
    console.log(`[TimeAlertsWorker] Digest disabled for company ${companyId}`);
    return { sent: 0, skippedDuplicate: 0, skippedSnoozed: 0 };
  }

  const metrics = await getWeeklyDigestMetrics(companyId, weekStart);
  const managerIds = await getCompanyManagers(companyId);

  if (managerIds.length === 0) {
    return { sent: 0, skippedDuplicate: 0, skippedSnoozed: 0 };
  }

  // Filter snoozed users
  const nonSnoozedUsers = await notificationSnoozesRepository.filterSnoozedUsers(
    companyId,
    managerIds,
    "weekly_time_digest"
  );

  const skippedSnoozed = managerIds.length - nonSnoozedUsers.length;

  if (nonSnoozedUsers.length === 0) {
    return { sent: 0, skippedDuplicate: 0, skippedSnoozed };
  }

  // Build digest body
  const trendIcon = metrics.billablePct >= metrics.previousBillablePct ? "+" : "";
  const trendDiff = metrics.billablePct - metrics.previousBillablePct;

  let body = `Week of ${weekStart}:\n`;
  body += `- Unassigned: ${formatMinutes(metrics.totalUnassignedMinutes)}\n`;
  body += `- Untracked: ${formatMinutes(metrics.totalUntrackedMinutes)}\n`;
  body += `- Billable: ${metrics.billablePct}% (${trendIcon}${trendDiff}% vs last week)\n`;

  if (metrics.topLeakageTechs.length > 0) {
    body += `Top leakage: ${metrics.topLeakageTechs.map((t) => `${t.name} (${formatMinutes(t.untrackedMinutes)})`).join(", ")}`;
  }

  const dedupeKey = `weekly_digest:${weekStart}`;

  const created = await notificationRepository.createNotificationsForUsers(
    companyId,
    nonSnoozedUsers,
    {
      type: "weekly_time_digest",
      title: `Weekly Time Digest`,
      body,
      linkUrl: `/settings/time-analytics?weekStart=${weekStart}`,
      dedupeKey,
      relatedEntityType: "digest",
    }
  );

  console.log(
    `[TimeAlertsWorker] Created weekly digest for company ${companyId}, week ${weekStart} (${created} sent, ${skippedSnoozed} snoozed)`
  );

  return {
    sent: created > 0 ? 1 : 0,
    skippedDuplicate: created === 0 ? 1 : 0,
    skippedSnoozed,
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Run time alerts worker for a single company
 */
export async function runTimeAlertsForCompany(
  companyId: string,
  options: { dateOverride?: string; runDigest?: boolean } = {}
): Promise<TimeAlertsWorkerResult> {
  const dateStr = options.dateOverride ?? getYesterday();
  const settings = await timeAlertSettingsRepository.getSettings(companyId);

  console.log(`[TimeAlertsWorker] Processing company ${companyId} for date ${dateStr}`);

  const result: TimeAlertsWorkerResult = {
    processed: {
      unassignedTimeChecks: 0,
      untrackedTimeChecks: 0,
      longRunningChecks: 0,
      missingClockOutChecks: 0,
    },
    notifications: {
      unassignedTime: 0,
      untrackedTime: 0,
      longRunningEntry: 0,
      missingClockOut: 0,
      weeklyDigest: 0,
    },
    escalations: 0,
    skippedDuplicate: 0,
    skippedSnoozed: 0,
    errors: [],
  };

  try {
    await checkUnassignedTime(companyId, dateStr, settings, result);
  } catch (error: any) {
    console.error(`[TimeAlertsWorker] Error checking unassigned time:`, error);
    result.errors.push({ type: "unassigned_time", companyId, error: error.message });
  }

  try {
    await checkUntrackedTime(companyId, dateStr, settings, result);
  } catch (error: any) {
    console.error(`[TimeAlertsWorker] Error checking untracked time:`, error);
    result.errors.push({ type: "untracked_time", companyId, error: error.message });
  }

  try {
    await checkLongRunningEntries(companyId, settings, result);
  } catch (error: any) {
    console.error(`[TimeAlertsWorker] Error checking long-running entries:`, error);
    result.errors.push({ type: "long_running_entry", companyId, error: error.message });
  }

  try {
    await checkMissingClockOut(companyId, settings, result);
  } catch (error: any) {
    console.error(`[TimeAlertsWorker] Error checking missing clock-out:`, error);
    result.errors.push({ type: "missing_clock_out", companyId, error: error.message });
  }

  // Run weekly digest if requested
  if (options.runDigest) {
    try {
      const weekStart = getLastWeekMonday();
      const digestResult = await runWeeklyDigestForCompany(companyId, weekStart);
      result.notifications.weeklyDigest += digestResult.sent;
      result.skippedDuplicate += digestResult.skippedDuplicate;
      result.skippedSnoozed += digestResult.skippedSnoozed;
    } catch (error: any) {
      console.error(`[TimeAlertsWorker] Error generating weekly digest:`, error);
      result.errors.push({ type: "weekly_digest", companyId, error: error.message });
    }
  }

  return result;
}

/**
 * Run time alerts worker for all companies
 */
export async function runTimeAlertsWorker(
  options: { dateOverride?: string; runDigest?: boolean } = {}
): Promise<{
  companiesProcessed: number;
  totalNotifications: number;
  totalEscalations: number;
  totalSkippedDuplicate: number;
  totalSkippedSnoozed: number;
  errors: TimeAlertsWorkerResult["errors"];
}> {
  console.log("[TimeAlertsWorker] Starting daily time alerts processing...");
  const startTime = Date.now();

  const allCompanies = await timeAlertQueryRepository.getAllCompanies();

  let companiesProcessed = 0;
  let totalNotifications = 0;
  let totalEscalations = 0;
  let totalSkippedDuplicate = 0;
  let totalSkippedSnoozed = 0;
  const allErrors: TimeAlertsWorkerResult["errors"] = [];

  for (const company of allCompanies) {
    try {
      const result = await runTimeAlertsForCompany(company.id, options);

      companiesProcessed++;
      totalNotifications +=
        result.notifications.unassignedTime +
        result.notifications.untrackedTime +
        result.notifications.longRunningEntry +
        result.notifications.missingClockOut +
        result.notifications.weeklyDigest;
      totalEscalations += result.escalations;
      totalSkippedDuplicate += result.skippedDuplicate;
      totalSkippedSnoozed += result.skippedSnoozed;
      allErrors.push(...result.errors);
    } catch (error: any) {
      console.error(`[TimeAlertsWorker] Fatal error for company ${company.id}:`, error);
      allErrors.push({ type: "fatal", companyId: company.id, error: error.message });
    }
  }

  const duration = Date.now() - startTime;
  console.log(
    `[TimeAlertsWorker] Completed in ${duration}ms. ` +
      `Companies: ${companiesProcessed}, Notifications: ${totalNotifications}, ` +
      `Escalations: ${totalEscalations}, Snoozed: ${totalSkippedSnoozed}, ` +
      `Skipped: ${totalSkippedDuplicate}, Errors: ${allErrors.length}`
  );

  return {
    companiesProcessed,
    totalNotifications,
    totalEscalations,
    totalSkippedDuplicate,
    totalSkippedSnoozed,
    errors: allErrors,
  };
}

/**
 * Run weekly digest for all companies
 * Should be called on the configured digest day (default: Monday)
 */
export async function runWeeklyDigestWorker(): Promise<WeeklyDigestResult> {
  console.log("[TimeAlertsWorker] Starting weekly digest processing...");
  const startTime = Date.now();
  const weekStart = getLastWeekMonday();
  const today = new Date().getDay(); // 0 = Sunday, 1 = Monday, etc.

  const allCompanies = await timeAlertQueryRepository.getAllCompanyIds();

  let sent = 0;
  let skipped = 0;
  const errors: Array<{ companyId: string; error: string }> = [];

  for (const company of allCompanies) {
    try {
      const settings = await timeAlertSettingsRepository.getSettings(company.id);

      // Check if today is the digest day for this company
      // digestDayOfWeek: 1=Monday, 7=Sunday
      // JS getDay(): 0=Sunday, 1=Monday
      const jsDay = settings.digestDayOfWeek === 7 ? 0 : settings.digestDayOfWeek;
      if (today !== jsDay) {
        skipped++;
        continue;
      }

      const result = await runWeeklyDigestForCompany(company.id, weekStart);
      sent += result.sent;
      skipped += result.skippedDuplicate;
    } catch (error: any) {
      console.error(`[TimeAlertsWorker] Error running digest for company ${company.id}:`, error);
      errors.push({ companyId: company.id, error: error.message });
    }
  }

  const duration = Date.now() - startTime;
  console.log(
    `[TimeAlertsWorker] Weekly digest completed in ${duration}ms. Sent: ${sent}, Skipped: ${skipped}, Errors: ${errors.length}`
  );

  return { sent, skipped, errors };
}

/**
 * Get current thresholds for a company
 */
export async function getAlertThresholds(companyId?: string) {
  if (companyId) {
    const settings = await timeAlertSettingsRepository.getSettings(companyId);
    return {
      unassignedTimeMinutes: settings.unassignedThresholdMinutes,
      untrackedTimeMinutes: settings.untrackedThresholdMinutes,
      longRunningEntryMinutes: settings.longRunningThresholdMinutes,
      missingClockOutMinutes: settings.missingClockOutThresholdMinutes,
      repeatDaysToEscalate: settings.repeatDaysToEscalate,
      digestDayOfWeek: settings.digestDayOfWeek,
      digestEnabled: settings.digestEnabled,
      isDefault: settings.isDefault,
    };
  }

  // Return static defaults for backward compatibility
  return {
    unassignedTimeMinutes: 30,
    untrackedTimeMinutes: 60,
    longRunningEntryMinutes: 360,
    missingClockOutMinutes: 720,
    repeatDaysToEscalate: 3,
    digestDayOfWeek: 1,
    digestEnabled: true,
    isDefault: true,
  };
}
