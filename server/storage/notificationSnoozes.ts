/**
 * Notification Snoozes Storage
 *
 * Repository for managing user notification snoozes.
 * Allows users to temporarily mute specific notification types.
 */

import { db } from "../db";
import { eq, and, gt, lt } from "drizzle-orm";
import {
  notificationSnoozes,
  type NotificationSnooze,
  type NotificationType,
} from "@shared/schema";

// ============================================================================
// Types
// ============================================================================

export interface ActiveSnooze {
  type: NotificationType;
  snoozeUntil: Date;
  remainingHours: number;
}

// ============================================================================
// Repository
// ============================================================================

export const notificationSnoozesRepository = {
  /**
   * Get active snooze for a specific user and notification type
   * Returns null if no active snooze exists
   */
  async getSnooze(
    companyId: string,
    userId: string,
    type: NotificationType
  ): Promise<NotificationSnooze | null> {
    const now = new Date();

    const [snooze] = await db
      .select()
      .from(notificationSnoozes)
      .where(
        and(
          eq(notificationSnoozes.companyId, companyId),
          eq(notificationSnoozes.userId, userId),
          eq(notificationSnoozes.type, type),
          gt(notificationSnoozes.snoozeUntil, now) // Only active snoozes
        )
      )
      .limit(1);

    return snooze ?? null;
  },

  /**
   * Check if a notification type is snoozed for a user
   */
  async isSnoozed(
    companyId: string,
    userId: string,
    type: NotificationType
  ): Promise<boolean> {
    const snooze = await this.getSnooze(companyId, userId, type);
    return snooze !== null;
  },

  /**
   * Set or update a snooze for a user and notification type
   */
  async setSnooze(
    companyId: string,
    userId: string,
    type: NotificationType,
    snoozeUntil: Date
  ): Promise<NotificationSnooze> {
    // Try to find existing snooze
    const [existing] = await db
      .select()
      .from(notificationSnoozes)
      .where(
        and(
          eq(notificationSnoozes.companyId, companyId),
          eq(notificationSnoozes.userId, userId),
          eq(notificationSnoozes.type, type)
        )
      )
      .limit(1);

    if (existing) {
      // Update existing snooze
      const [updated] = await db
        .update(notificationSnoozes)
        .set({
          snoozeUntil,
          updatedAt: new Date(),
        })
        .where(eq(notificationSnoozes.id, existing.id))
        .returning();

      return updated;
    }

    // Create new snooze
    const [created] = await db
      .insert(notificationSnoozes)
      .values({
        companyId,
        userId,
        type,
        snoozeUntil,
      })
      .returning();

    return created;
  },

  /**
   * Clear a snooze for a user and notification type
   */
  async clearSnooze(
    companyId: string,
    userId: string,
    type: NotificationType
  ): Promise<boolean> {
    const result = await db
      .delete(notificationSnoozes)
      .where(
        and(
          eq(notificationSnoozes.companyId, companyId),
          eq(notificationSnoozes.userId, userId),
          eq(notificationSnoozes.type, type)
        )
      )
      .returning({ id: notificationSnoozes.id });

    return result.length > 0;
  },

  /**
   * Get all active snoozes for a user
   */
  async getActiveSnoozes(
    companyId: string,
    userId: string
  ): Promise<ActiveSnooze[]> {
    const now = new Date();

    const snoozes = await db
      .select()
      .from(notificationSnoozes)
      .where(
        and(
          eq(notificationSnoozes.companyId, companyId),
          eq(notificationSnoozes.userId, userId),
          gt(notificationSnoozes.snoozeUntil, now)
        )
      );

    return snoozes.map((s) => ({
      type: s.type as NotificationType,
      snoozeUntil: s.snoozeUntil,
      remainingHours: Math.ceil(
        (s.snoozeUntil.getTime() - now.getTime()) / (1000 * 60 * 60)
      ),
    }));
  },

  /**
   * Clear all snoozes for a user
   */
  async clearAllSnoozes(
    companyId: string,
    userId: string
  ): Promise<number> {
    const result = await db
      .delete(notificationSnoozes)
      .where(
        and(
          eq(notificationSnoozes.companyId, companyId),
          eq(notificationSnoozes.userId, userId)
        )
      )
      .returning({ id: notificationSnoozes.id });

    return result.length;
  },

  /**
   * Clean up expired snoozes (maintenance job)
   */
  async cleanupExpiredSnoozes(): Promise<number> {
    // Delete snoozes that expired more than 24 hours ago
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const result = await db
      .delete(notificationSnoozes)
      .where(lt(notificationSnoozes.snoozeUntil, cutoff))
      .returning({ id: notificationSnoozes.id });

    return result.length;
  },

  /**
   * Filter a list of user IDs, removing those who have snoozed a specific type
   */
  async filterSnoozedUsers(
    companyId: string,
    userIds: string[],
    type: NotificationType
  ): Promise<string[]> {
    if (userIds.length === 0) return [];

    const now = new Date();

    // Get all active snoozes for this type
    const snoozedUserIds = await db
      .select({ userId: notificationSnoozes.userId })
      .from(notificationSnoozes)
      .where(
        and(
          eq(notificationSnoozes.companyId, companyId),
          eq(notificationSnoozes.type, type),
          gt(notificationSnoozes.snoozeUntil, now)
        )
      );

    const snoozedSet = new Set(snoozedUserIds.map((s) => s.userId));

    // Return only users who are not snoozed
    return userIds.filter((id) => !snoozedSet.has(id));
  },
};
