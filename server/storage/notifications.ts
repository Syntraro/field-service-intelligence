/**
 * Notifications Repository
 *
 * Handles CRUD operations for in-app notifications.
 * Tenant-isolated and user-scoped.
 */

import { db } from "../db";
import { eq, and, desc, sql, isNull, count } from "drizzle-orm";
import { notifications, users, type InsertNotification, type Notification, type NotificationType } from "@shared/schema";
// 2026-05-04: tenant-user containment predicate.
import { nonPlatformUserPredicate } from "./tenantUserPredicate";

// ============================================================================
// Types
// ============================================================================

export interface NotificationWithMeta extends Notification {
  timeAgo: string;
}

export interface CreateNotificationParams {
  companyId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  linkUrl?: string;
  dedupeKey?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// ============================================================================
// Repository Functions
// ============================================================================

/**
 * Get notifications for a user
 */
export async function getNotifications(
  companyId: string,
  userId: string,
  options: { limit?: number; unreadOnly?: boolean } = {}
): Promise<NotificationWithMeta[]> {
  const { limit = 20, unreadOnly = false } = options;

  const conditions = [
    eq(notifications.companyId, companyId),
    eq(notifications.userId, userId),
  ];

  if (unreadOnly) {
    conditions.push(eq(notifications.status, "unread"));
  }

  const rows = await db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    timeAgo: formatTimeAgo(row.createdAt),
  }));
}

/**
 * Get unread notification count for a user
 */
export async function getUnreadCount(companyId: string, userId: string): Promise<number> {
  const result = await db
    .select({ count: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.companyId, companyId),
        eq(notifications.userId, userId),
        eq(notifications.status, "unread")
      )
    );

  return result[0]?.count || 0;
}

/**
 * Mark a single notification as read
 */
export async function markAsRead(
  companyId: string,
  userId: string,
  notificationId: string
): Promise<Notification | null> {
  const [updated] = await db
    .update(notifications)
    .set({
      status: "read",
      readAt: new Date(),
    })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.companyId, companyId),
        eq(notifications.userId, userId)
      )
    )
    .returning();

  return updated ?? null;
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllAsRead(companyId: string, userId: string): Promise<number> {
  const result = await db
    .update(notifications)
    .set({
      status: "read",
      readAt: new Date(),
    })
    .where(
      and(
        eq(notifications.companyId, companyId),
        eq(notifications.userId, userId),
        eq(notifications.status, "unread")
      )
    );

  return result.rowCount || 0;
}

/**
 * Create a notification
 * Uses ON CONFLICT DO NOTHING for deduplication
 */
export async function createNotification(params: CreateNotificationParams): Promise<Notification | null> {
  const {
    companyId,
    userId,
    type,
    title,
    body,
    linkUrl,
    dedupeKey,
    relatedEntityType,
    relatedEntityId,
  } = params;

  // If dedupeKey is provided, use upsert with ON CONFLICT DO NOTHING
  if (dedupeKey) {
    const result = await db.execute(sql`
      INSERT INTO notifications (
        company_id, user_id, type, title, body, link_url,
        dedupe_key, related_entity_type, related_entity_id, status
      )
      VALUES (
        ${companyId}, ${userId}, ${type}, ${title}, ${body || null}, ${linkUrl || null},
        ${dedupeKey}, ${relatedEntityType || null}, ${relatedEntityId || null}, 'unread'
      )
      ON CONFLICT (user_id, dedupe_key) DO NOTHING
      RETURNING *
    `);

    // The raw result needs to be cast
    const rows = result.rows as unknown as Notification[];
    return rows[0] ?? null;
  }

  // No dedupeKey, just insert
  const [created] = await db
    .insert(notifications)
    .values({
      companyId,
      userId,
      type,
      title,
      body: body || null,
      linkUrl: linkUrl || null,
      dedupeKey: null,
      relatedEntityType: relatedEntityType || null,
      relatedEntityId: relatedEntityId || null,
      status: "unread",
    })
    .returning();

  return created;
}

/**
 * Create notifications for multiple users (batch)
 */
export async function createNotificationsForUsers(
  companyId: string,
  userIds: string[],
  params: Omit<CreateNotificationParams, "companyId" | "userId">
): Promise<number> {
  if (userIds.length === 0) return 0;

  const { type, title, body, linkUrl, dedupeKey, relatedEntityType, relatedEntityId } = params;

  // Build values for batch insert
  const values = userIds.map((userId) => ({
    companyId,
    userId,
    type,
    title,
    body: body || null,
    linkUrl: linkUrl || null,
    dedupeKey: dedupeKey ? `${dedupeKey}:${userId}` : null, // Make dedupe key unique per user
    relatedEntityType: relatedEntityType || null,
    relatedEntityId: relatedEntityId || null,
    status: "unread" as const,
  }));

  if (dedupeKey) {
    // Use raw SQL for ON CONFLICT DO NOTHING with batch insert
    let inserted = 0;
    for (const value of values) {
      const result = await db.execute(sql`
        INSERT INTO notifications (
          company_id, user_id, type, title, body, link_url,
          dedupe_key, related_entity_type, related_entity_id, status
        )
        VALUES (
          ${value.companyId}, ${value.userId}, ${value.type}, ${value.title},
          ${value.body}, ${value.linkUrl}, ${value.dedupeKey},
          ${value.relatedEntityType}, ${value.relatedEntityId}, ${value.status}
        )
        ON CONFLICT (user_id, dedupe_key) DO NOTHING
      `);
      if (result.rowCount && result.rowCount > 0) inserted++;
    }
    return inserted;
  }

  // No dedupeKey, batch insert normally
  await db.insert(notifications).values(values);
  return values.length;
}

/**
 * Get users by role for a company (for targeting notifications)
 */
export async function getUsersByRole(
  companyId: string,
  roles: string[]
): Promise<Array<{ id: string; email: string; role: string }>> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .where(
      and(
        eq(users.companyId, companyId),
        sql`${users.role} = ANY(${roles})`,
        eq(users.status, "active"),
        isNull(users.deletedAt),
        // 2026-05-04: notification recipients must be tenant users only.
        // The `roles` argument here is a tenant-role allow-list, but
        // composing the canonical predicate keeps the contract uniform
        // with every other tenant user query AND defends against a
        // caller passing a list that accidentally includes a platform role.
        nonPlatformUserPredicate(),
      )
    );

  return rows;
}

/**
 * Delete old notifications (cleanup job)
 */
export async function deleteOldNotifications(olderThanDays: number = 30): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);

  const result = await db
    .delete(notifications)
    .where(sql`${notifications.createdAt} < ${cutoff}`);

  return result.rowCount || 0;
}

// ============================================================================
// Export Repository Object
// ============================================================================

export const notificationRepository = {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  createNotification,
  createNotificationsForUsers,
  getUsersByRole,
  deleteOldNotifications,
};
