/**
 * Time Alert Settings Storage
 *
 * Repository for managing company-specific time alert thresholds and configuration.
 * Provides default fallback values for companies without explicit settings.
 */

import { db } from "../db";
import { eq } from "drizzle-orm";
import {
  timeAlertSettings,
  DEFAULT_TIME_ALERT_SETTINGS,
  type TimeAlertSettings,
  type UpdateTimeAlertSettings,
} from "@shared/schema";

// ============================================================================
// Types
// ============================================================================

export interface TimeAlertSettingsWithDefaults {
  id: string | null;
  companyId: string;
  unassignedThresholdMinutes: number;
  untrackedThresholdMinutes: number;
  longRunningThresholdMinutes: number;
  missingClockOutThresholdMinutes: number;
  repeatDaysToEscalate: number;
  digestDayOfWeek: number;
  digestEnabled: boolean;
  isDefault: boolean; // True if using defaults (no row exists)
}

// ============================================================================
// Repository
// ============================================================================

export const timeAlertSettingsRepository = {
  /**
   * Get settings for a company, returning defaults if none exist
   */
  async getSettings(companyId: string): Promise<TimeAlertSettingsWithDefaults> {
    const [row] = await db
      .select()
      .from(timeAlertSettings)
      .where(eq(timeAlertSettings.companyId, companyId))
      .limit(1);

    if (row) {
      return {
        id: row.id,
        companyId: row.companyId,
        unassignedThresholdMinutes: row.unassignedThresholdMinutes,
        untrackedThresholdMinutes: row.untrackedThresholdMinutes,
        longRunningThresholdMinutes: row.longRunningThresholdMinutes,
        missingClockOutThresholdMinutes: row.missingClockOutThresholdMinutes,
        repeatDaysToEscalate: row.repeatDaysToEscalate,
        digestDayOfWeek: row.digestDayOfWeek,
        digestEnabled: row.digestEnabled,
        isDefault: false,
      };
    }

    // Return defaults
    return {
      id: null,
      companyId,
      ...DEFAULT_TIME_ALERT_SETTINGS,
      isDefault: true,
    };
  },

  /**
   * Upsert settings for a company
   * Creates new row if none exists, updates existing otherwise
   */
  async upsertSettings(
    companyId: string,
    patch: UpdateTimeAlertSettings
  ): Promise<TimeAlertSettingsWithDefaults> {
    // Check if row exists
    const [existing] = await db
      .select()
      .from(timeAlertSettings)
      .where(eq(timeAlertSettings.companyId, companyId))
      .limit(1);

    if (existing) {
      // Update existing row
      const [updated] = await db
        .update(timeAlertSettings)
        .set({
          ...patch,
          updatedAt: new Date(),
        })
        .where(eq(timeAlertSettings.id, existing.id))
        .returning();

      return {
        id: updated.id,
        companyId: updated.companyId,
        unassignedThresholdMinutes: updated.unassignedThresholdMinutes,
        untrackedThresholdMinutes: updated.untrackedThresholdMinutes,
        longRunningThresholdMinutes: updated.longRunningThresholdMinutes,
        missingClockOutThresholdMinutes: updated.missingClockOutThresholdMinutes,
        repeatDaysToEscalate: updated.repeatDaysToEscalate,
        digestDayOfWeek: updated.digestDayOfWeek,
        digestEnabled: updated.digestEnabled,
        isDefault: false,
      };
    }

    // Create new row with defaults + patch
    const [created] = await db
      .insert(timeAlertSettings)
      .values({
        companyId,
        unassignedThresholdMinutes: patch.unassignedThresholdMinutes ?? DEFAULT_TIME_ALERT_SETTINGS.unassignedThresholdMinutes,
        untrackedThresholdMinutes: patch.untrackedThresholdMinutes ?? DEFAULT_TIME_ALERT_SETTINGS.untrackedThresholdMinutes,
        longRunningThresholdMinutes: patch.longRunningThresholdMinutes ?? DEFAULT_TIME_ALERT_SETTINGS.longRunningThresholdMinutes,
        missingClockOutThresholdMinutes: patch.missingClockOutThresholdMinutes ?? DEFAULT_TIME_ALERT_SETTINGS.missingClockOutThresholdMinutes,
        repeatDaysToEscalate: patch.repeatDaysToEscalate ?? DEFAULT_TIME_ALERT_SETTINGS.repeatDaysToEscalate,
        digestDayOfWeek: patch.digestDayOfWeek ?? DEFAULT_TIME_ALERT_SETTINGS.digestDayOfWeek,
        digestEnabled: patch.digestEnabled ?? DEFAULT_TIME_ALERT_SETTINGS.digestEnabled,
      })
      .returning();

    return {
      id: created.id,
      companyId: created.companyId,
      unassignedThresholdMinutes: created.unassignedThresholdMinutes,
      untrackedThresholdMinutes: created.untrackedThresholdMinutes,
      longRunningThresholdMinutes: created.longRunningThresholdMinutes,
      missingClockOutThresholdMinutes: created.missingClockOutThresholdMinutes,
      repeatDaysToEscalate: created.repeatDaysToEscalate,
      digestDayOfWeek: created.digestDayOfWeek,
      digestEnabled: created.digestEnabled,
      isDefault: false,
    };
  },

  /**
   * Delete settings for a company (revert to defaults)
   */
  async deleteSettings(companyId: string): Promise<boolean> {
    const result = await db
      .delete(timeAlertSettings)
      .where(eq(timeAlertSettings.companyId, companyId))
      .returning({ id: timeAlertSettings.id });

    return result.length > 0;
  },
};
