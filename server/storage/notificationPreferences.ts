/**
 * Notification Preferences Repository (2026-04-21 Phase 2, v1)
 *
 * User-level notification policy storage. Sibling to:
 *   - server/storage/notifications.ts         (what to say)
 *   - server/storage/notificationTargets.ts   (where to send)
 *
 * Row absence is semantically "all defaults true". Callers never have to
 * check for null — `loadForUser` / `loadForUsers` fill defaults inline.
 * This preserves Phase 1 behavior for every existing user with zero
 * backfill and keeps the write path lazy (a row is only created on the
 * first PATCH).
 */

import { db } from "../db";
import { and, eq, inArray } from "drizzle-orm";
import {
  notificationPreferences,
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
} from "@shared/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Resolved preferences — what a caller consumes. Carries only the boolean
 * columns. The DB row's id/timestamps/tenantId/userId are intentionally
 * excluded so callers can't accidentally echo them into PATCH bodies.
 */
export interface ResolvedPreferences {
  visitAssignmentsEnabled: boolean;
  visitScheduleChangesEnabled: boolean;
  visitCancellationsEnabled: boolean;
  visitRemindersEnabled: boolean;
}

/**
 * Partial shape for upsertPreferences — every field optional. Missing
 * fields preserve whatever is currently in the row (or the column default
 * if no row exists yet).
 */
export interface PreferencesPatch {
  visitAssignmentsEnabled?: boolean;
  visitScheduleChangesEnabled?: boolean;
  visitCancellationsEnabled?: boolean;
  visitRemindersEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToResolved(row: NotificationPreferences): ResolvedPreferences {
  return {
    visitAssignmentsEnabled: row.visitAssignmentsEnabled,
    visitScheduleChangesEnabled: row.visitScheduleChangesEnabled,
    visitCancellationsEnabled: row.visitCancellationsEnabled,
    visitRemindersEnabled: row.visitRemindersEnabled,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Resolve preferences for a single user. Missing row → defaults (all true).
 * Never returns null.
 */
export async function loadForUser(
  tenantId: string,
  userId: string,
): Promise<ResolvedPreferences> {
  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.tenantId, tenantId),
        eq(notificationPreferences.userId, userId),
      ),
    )
    .limit(1);

  return row ? rowToResolved(row) : { ...DEFAULT_NOTIFICATION_PREFERENCES };
}

/**
 * Batch resolver used by the notification service to fan-out-check many
 * recipients in one query. Missing rows are filled with defaults so the
 * returned Map always has a value for every requested userId.
 */
export async function loadForUsers(
  tenantId: string,
  userIds: string[],
): Promise<Map<string, ResolvedPreferences>> {
  const result = new Map<string, ResolvedPreferences>();
  if (userIds.length === 0) return result;

  // Pre-fill defaults for every requested user so the caller can blindly
  // .get(userId) without defensive null checks.
  for (const userId of userIds) {
    result.set(userId, { ...DEFAULT_NOTIFICATION_PREFERENCES });
  }

  const rows = await db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.tenantId, tenantId),
        inArray(notificationPreferences.userId, userIds),
      ),
    );

  for (const row of rows) {
    result.set(row.userId, rowToResolved(row));
  }

  return result;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Upsert preferences for a user. On-conflict (tenant_id, user_id) merges
 * the patch with the existing row; on first write creates a fresh row
 * where unspecified columns take the schema defaults (all true).
 * Returns the post-write resolved shape.
 */
export async function upsertPreferences(
  tenantId: string,
  userId: string,
  patch: PreferencesPatch,
): Promise<ResolvedPreferences> {
  // Build INSERT values: explicit patch values, otherwise column defaults
  // (the column NOT NULL DEFAULT TRUE fires if we omit a field).
  const insertValues = {
    tenantId,
    userId,
    ...("visitAssignmentsEnabled" in patch && patch.visitAssignmentsEnabled !== undefined
      ? { visitAssignmentsEnabled: patch.visitAssignmentsEnabled }
      : {}),
    ...("visitScheduleChangesEnabled" in patch && patch.visitScheduleChangesEnabled !== undefined
      ? { visitScheduleChangesEnabled: patch.visitScheduleChangesEnabled }
      : {}),
    ...("visitCancellationsEnabled" in patch && patch.visitCancellationsEnabled !== undefined
      ? { visitCancellationsEnabled: patch.visitCancellationsEnabled }
      : {}),
    ...("visitRemindersEnabled" in patch && patch.visitRemindersEnabled !== undefined
      ? { visitRemindersEnabled: patch.visitRemindersEnabled }
      : {}),
  };

  // ON CONFLICT update set: only columns the caller actually passed. Fields
  // omitted from the patch are left untouched on the existing row.
  const updateSet: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.visitAssignmentsEnabled !== undefined) {
    updateSet.visitAssignmentsEnabled = patch.visitAssignmentsEnabled;
  }
  if (patch.visitScheduleChangesEnabled !== undefined) {
    updateSet.visitScheduleChangesEnabled = patch.visitScheduleChangesEnabled;
  }
  if (patch.visitCancellationsEnabled !== undefined) {
    updateSet.visitCancellationsEnabled = patch.visitCancellationsEnabled;
  }
  if (patch.visitRemindersEnabled !== undefined) {
    updateSet.visitRemindersEnabled = patch.visitRemindersEnabled;
  }

  const [row] = await db
    .insert(notificationPreferences)
    .values(insertValues)
    .onConflictDoUpdate({
      target: [notificationPreferences.tenantId, notificationPreferences.userId],
      set: updateSet,
    })
    .returning();

  return rowToResolved(row);
}

// ---------------------------------------------------------------------------
// Exported repository object
// ---------------------------------------------------------------------------

export const notificationPreferencesRepository = {
  loadForUser,
  loadForUsers,
  upsertPreferences,
};
